use egui::Context;
use winit::{
    event::WindowEvent,
    event_loop::EventLoop,
    platform::pump_events::{EventLoopExtPumpEvents, PumpStatus},
    window::{Window, WindowId},
};

use crate::app::{AppInner, Request};

pub struct RunUI(pub Box<dyn FnMut(&Context) + Send>);

type WindowMessageHandlerFn = Box<dyn FnMut(WindowId, &WindowEvent, &Window) -> bool + Send>;

pub struct WindowMessageHandler(pub WindowMessageHandlerFn);

impl std::fmt::Debug for RunUI {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_tuple("RunUI").finish()
    }
}

impl std::fmt::Debug for WindowMessageHandler {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_tuple("WindowMessageHandler").finish()
    }
}

pub struct AppEventLoop(EventLoop<Request>, AppInner);

impl AppEventLoop {
    pub fn new(event_loop: EventLoop<Request>, app_inner: AppInner) -> Self {
        Self(event_loop, app_inner)
    }

    pub fn pump_events(&mut self) -> PumpStatus {
        let Self(event_loop, app_inner) = self;
        event_loop.pump_app_events(Some(std::time::Duration::ZERO), app_inner)
    }
}

impl Drop for AppEventLoop {
    fn drop(&mut self) {
        let _ = self.0.create_proxy().send_event(Request::Exit); // Signal the event loop to exit so we can clean up the timer and avoid a potential use-after-free of AppInner.
        // Ensure the event loop is stopped before we drop the AppInner, which
        // may contain resources that require the event loop to be running for
        // cleanup (e.g. windows that need to be closed on the UI thread).
        while let PumpStatus::Continue = self.pump_events() {}
    }
}
