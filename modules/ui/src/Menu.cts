import App from "./App.cjs";
import {
  createMenu,
  destroyMenu,
  showMenu,
  setMenuOnClick,
  updateMenuItem,
} from "./module.cjs";
import { registerFinalizer } from "@open-orpheus/lifecycle";

export default class Menu {
  private _ptr: number;

  constructor(app: App, menuData: unknown) {
    this._ptr = createMenu((app as unknown as { _ptr: number })._ptr, menuData);
    registerFinalizer(this, this._ptr, (ptr) => destroyMenu(ptr as number));
  }

  show(): void {
    showMenu(this._ptr);
  }

  onClick(callback: (id: string) => void): void {
    setMenuOnClick(this._ptr, callback);
  }

  updateItem(item: unknown): void {
    updateMenuItem(this._ptr, item);
  }
}
