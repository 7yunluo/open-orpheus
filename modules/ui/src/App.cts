import {
  createApp,
  createWindow,
  destroyApp,
  loadMenuSkin,
} from "./module.cjs";
import { registerFinalizer } from "@open-orpheus/lifecycle";

export default class App {
  private _ptr: number;
  private _timerPtr: number;

  private constructor(ptr: number, timerPtr: number) {
    this._ptr = ptr;
    this._timerPtr = timerPtr;
  }

  static async create(options: Parameters<typeof createApp>[0]): Promise<App> {
    const [ptr, timerPtr] = createApp(options);
    const app = new App(ptr, timerPtr);
    registerFinalizer(app, [ptr, timerPtr] as [number, number], (ptrs) =>
      destroyApp(...(ptrs as [number, number]))
    );
    return app;
  }

  loadMenuSkin(path: string) {
    return loadMenuSkin(this._ptr, path);
  }

  createWindow() {
    createWindow(this._ptr);
  }
}
