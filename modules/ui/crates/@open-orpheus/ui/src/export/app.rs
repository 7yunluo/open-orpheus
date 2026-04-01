use std::{ffi::c_void, sync::Arc};

use libuv_sys2::{
    uv_close, uv_handle, uv_handle_get_data, uv_handle_set_data, uv_handle_t, uv_timer_init,
    uv_timer_start, uv_timer_stop, uv_timer_t,
};
use neon::{
    event::Channel,
    handle::{Handle, Root},
    object::Object,
    prelude::{Context, Cx},
    result::JsResult,
    types::{JsArray, JsBuffer, JsFunction, JsObject, JsPromise, buffer::TypedArray},
};
use winit::platform::pump_events::PumpStatus;

use crate::{
    app::{App, AppEventLoop},
    napi,
    resource::ResourceHandler,
};

type CloseData = (Box<App>, Box<AppEventLoop>);

/// Bridges a JS async function (`(path: string) => Promise<Buffer>`) to a
/// `Send + Sync` Rust closure that returns a `Send` future.
///
/// Thread-safety notes:
///   - `Root<JsFunction>` is `Send + Sync`: it is a persistent V8 reference
///     that can be shared across threads; actual use only happens on the JS
///     thread inside `channel.send()`.
///   - `Channel` is `Clone + Send + Sync`: it is the safe door back to the JS
///     thread.
///   - `JsPromise::to_future` registers a native continuation and returns a
///     `JoinHandle<O>` that resolves when the Promise settles. It is `Send`,
///     so it is safe to await from any thread.
fn js_pack_handler(
    func: Arc<Root<JsFunction>>,
    channel: Channel,
) -> impl Fn(&str) -> std::pin::Pin<Box<dyn Future<Output = Vec<u8>> + Send>> + Send + Sync + 'static
{
    move |path: &str| {
        let path = path.to_owned();
        let func = func.clone();
        let channel = channel.clone();
        Box::pin(async move {
            // Schedule on the JS thread: call the JS function and attach a
            // native continuation via `to_future`. `channel.send` returns a
            // `JoinHandle` for the closure's return value, giving us a
            // `JoinHandle<JoinHandle<Vec<u8>>>` that we double-await.
            let outer = channel.send(move |mut cx| {
                let func = func.to_inner(&mut cx);
                let path_arg = cx.string(&path);
                let promise = func
                    .call_with(&cx)
                    .arg(path_arg)
                    .apply::<JsPromise, _>(&mut cx)?;
                promise.to_future(&mut cx, |mut cx, result| {
                    let bytes = match result {
                        Ok(val) => val
                            .downcast::<JsBuffer, _>(&mut cx)
                            .map(|b| TypedArray::as_slice(&*b, &cx).to_vec())
                            .unwrap_or_default(),
                        Err(_) => Vec::new(),
                    };
                    Ok(bytes)
                })
            });
            match outer.await {
                Ok(inner) => inner.await.unwrap_or_default(),
                Err(_) => Vec::new(),
            }
        })
    }
}

unsafe extern "C" fn on_timer(handle: *mut uv_timer_t) {
    let event_loop_ptr = unsafe { uv_handle_get_data(uv_handle!(handle)) } as *mut AppEventLoop;
    if event_loop_ptr.is_null() {
        return;
    }
    let event_loop = unsafe { &mut *event_loop_ptr };

    if let PumpStatus::Exit(_) = event_loop.pump_events() {
        // Stop the timer; the handle will be closed and cleaned up in `destroy_app`.
        unsafe { uv_timer_stop(handle) };
    }
}

unsafe extern "C" fn on_close(handle: *mut uv_handle_t) {
    // Release App and AppEventLoop stored in handle data.
    let data = unsafe { uv_handle_get_data(handle) } as *mut CloseData;
    if !data.is_null() {
        let (app, app_event_loop) = *unsafe { Box::from_raw(data) };
        drop(app);
        drop(app_event_loop);
        unsafe { uv_handle_set_data(handle, std::ptr::null_mut()) };
    }

    // The uv_timer_t is a uv_handle_t; free the handle allocation.
    let timer = handle as *mut uv_timer_t;
    drop(unsafe { Box::from_raw(timer) });
}

#[neon::export]
fn create_app<'cx>(cx: &mut Cx<'cx>, options: Handle<JsObject>) -> JsResult<'cx, JsArray> {
    #[cfg(target_os = "linux")]
    let prefer_wayland = options.prop(cx, "preferWayland").get()?;
    let read_web_pack = options
        .prop(cx, "readWebPack")
        .get::<Handle<JsFunction>>()?
        .root(cx);
    let read_skin_pack = options
        .prop(cx, "readSkinPack")
        .get::<Handle<JsFunction>>()?
        .root(cx);
    let channel = cx.channel();
    let resource_handler = ResourceHandler::new(
        js_pack_handler(Arc::new(read_web_pack), channel.clone()),
        js_pack_handler(Arc::new(read_skin_pack), channel),
    );

    let (app, event_loop) = App::new(
        #[cfg(target_os = "linux")]
        prefer_wayland,
        resource_handler,
    );
    let loop_ptr = napi::get_uv_loop_from_neon(cx).or_else(|x| cx.throw_error(x))?;
    let ptr = Box::into_raw(Box::new(app));
    let event_loop_ptr = Box::into_raw(Box::new(event_loop));
    let timer = Box::into_raw(Box::new(unsafe { std::mem::zeroed::<uv_timer_t>() }));
    unsafe { uv_handle_set_data(uv_handle!(timer), event_loop_ptr as *mut c_void) };
    let rc = unsafe { uv_timer_init(loop_ptr, timer) };
    if rc != 0 {
        unsafe {
            drop(Box::from_raw(ptr));
            drop(Box::from_raw(event_loop_ptr));
            drop(Box::from_raw(timer));
        }
        return cx.throw_error(format!("uv_timer_init failed: {rc}"));
    }
    let rc = unsafe { uv_timer_start(timer, Some(on_timer), 0, 3) };
    if rc != 0 {
        unsafe {
            drop(Box::from_raw(ptr));
            drop(Box::from_raw(event_loop_ptr));
            drop(Box::from_raw(timer));
        }
        return cx.throw_error(format!("uv_timer_start failed: {rc}"));
    }
    let ret = cx.empty_array();
    let val = cx.number(ptr as usize as f64);
    ret.set(cx, 0, val)?;
    let val = cx.number(timer as usize as f64);
    ret.set(cx, 1, val)?;
    Ok(ret)
}

#[neon::export]
fn destroy_app(app_ptr: f64, timer_ptr: f64) {
    let app_ptr = app_ptr as usize as *mut App;
    let app_event_loop_ptr = unsafe { uv_handle_get_data(uv_handle!(timer_ptr as usize as *mut uv_timer_t)) } as *mut AppEventLoop;
    let close_data: CloseData = (
        unsafe { Box::from_raw(app_ptr) },
        unsafe { Box::from_raw(app_event_loop_ptr) },
    );
    let timer_ptr = timer_ptr as usize as *mut uv_timer_t;
    unsafe {
        uv_timer_stop(timer_ptr);
        uv_handle_set_data(uv_handle!(timer_ptr), Box::into_raw(Box::new(close_data)) as *mut c_void);
        uv_close(uv_handle!(timer_ptr), Some(on_close));
    }
}

#[neon::export]
fn load_menu_skin<'cx>(cx: &mut Cx<'cx>, app_ptr: f64, path: String) -> Handle<'cx, JsPromise> {
    let (deferred, promise) = cx.promise();
    let channel = cx.channel();
    smol::spawn(async move {
        let app = unsafe { &mut *(app_ptr as usize as *mut App) };
        let result = app.load_menu_skin(&path).await;
        channel.send(|mut cx| {
            match result {
                Ok(_) => {
                    let val = cx.undefined();
                    deferred.resolve(&mut cx, val);
                }
                Err(e) => {
                    let val = cx.string(e);
                    deferred.reject(&mut cx, val);
                }
            }
            Ok(())
        });
    })
    .detach();
    promise
}
