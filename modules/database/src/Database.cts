// The Rust addon.
import * as addon from "./load.cjs";
import {
  registerFinalizer,
  unregisterFinalizer,
  type FinalizerToken,
} from "@open-orpheus/lifecycle";

// Use this declaration to assign types to the addon's exports,
// which otherwise by default are `any`.
declare module "./load.cjs" {
  function createConnection(path: string): number;
  function executeSql(
    ptr: number,
    sql: string
  ): [number, Record<string, string>[], [number, number, number]];
  function executeTransaction(
    ptr: number,
    sql: string
  ): [number, Record<string, string>[], [number, number, number]];
  function executeSqls(
    ptr: number,
    sqls: string[]
  ): {
    value: unknown[] | undefined;
  };
  function closeConnection(ptr: number): boolean;
}

export default class Database {
  private _ptr: number;
  private _finalizerToken: FinalizerToken | null = null;

  constructor(path: string) {
    this._ptr = addon.createConnection(path);
    if (this._ptr === 0) {
      throw new Error(`Failed to create database connection for path: ${path}`);
    }
    this._finalizerToken = registerFinalizer(this, this._ptr, (ptr) =>
      addon.closeConnection(ptr as number)
    );
  }

  executeSql(sql: string): ReturnType<typeof addon.executeSql> {
    if (this._ptr === 0) {
      throw new Error("Database connection is closed.");
    }
    return addon.executeSql(this._ptr, sql);
  }

  executeTransaction(sql: string): ReturnType<typeof addon.executeTransaction> {
    if (this._ptr === 0) {
      throw new Error("Database connection is closed.");
    }
    return addon.executeTransaction(this._ptr, sql);
  }

  executeSqls(sqls: string[]): ReturnType<typeof addon.executeSqls> {
    if (this._ptr === 0) {
      throw new Error("Database connection is closed.");
    }
    return addon.executeSqls(this._ptr, sqls);
  }

  close(): boolean {
    if (this._finalizerToken !== null) {
      unregisterFinalizer(this._finalizerToken);
      this._finalizerToken = null;
    }
    const result = addon.closeConnection(this._ptr);
    this._ptr = 0; // Invalidate the pointer after closing
    return result;
  }
}
