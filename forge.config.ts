import type { ForgeConfig } from "@electron-forge/shared-types";
import { MakerSquirrel } from "@electron-forge/maker-squirrel";
import { MakerZIP } from "@electron-forge/maker-zip";
import { MakerDeb } from "@electron-forge/maker-deb";
import { MakerRpm } from "@electron-forge/maker-rpm";
import { VitePlugin } from "@electron-forge/plugin-vite";
import { FusesPlugin } from "@electron-forge/plugin-fuses";
import { FuseV1Options, FuseVersion } from "@electron/fuses";

import { AutoUnpackNativesPlugin } from "@electron-forge/plugin-auto-unpack-natives"; // TODO: Remove in Electron Forge 8

import options from "./packaging/options.json";

import MakerSRpm from "./packaging/rpm/MakerSRpm.mjs";

const config: ForgeConfig = {
  packagerConfig: {
    asar: {
      unpack: "**/*.{so*,dylib,dll}",
    },
    derefSymlinks: true, // TODO: Remove in Electron Forge 8
    // Override Vite Plugin's preferences, and with our preferences
    ignore: (file: string) => {
      if (!file) return;

      return (
        file.startsWith("/node_modules/.") ||
        file.startsWith("/node_modules/electron/") ||
        file.startsWith("/node_modules/electron-nightly/") ||
        (!file.startsWith("/package.json") &&
          !file.startsWith("/.vite") &&
          !file.startsWith("/node_modules"))
      );
    },
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel(options.squirrel),
    new MakerZIP({}, ["darwin"]),
    new MakerRpm({
      options: options.rpm as unknown,
    }),
    new MakerSRpm({
      options: options.rpm as unknown,
    }),
    new MakerDeb({
      options: options.deb as unknown,
    }),
  ],
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new VitePlugin({
      // `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
      // If you are familiar with Vite configuration, it will look really familiar.
      build: [
        {
          // `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
          entry: "src/main.ts",
          config: "vite.main.config.ts",
          target: "main",
        },
        {
          entry: "src/preload.ts",
          config: "vite.preload.config.ts",
          target: "preload",
        },
        {
          entry: "src/windows/package-download.ts",
          config: "vite.preload.config.ts",
          target: "preload",
        },
        {
          entry: "src/windows/desktop-lyrics.ts",
          config: "vite.preload.config.ts",
          target: "preload",
        },
        {
          entry: "src/windows/desktop-lyrics-preview.ts",
          config: "vite.preload.config.ts",
          target: "preload",
        },
      ],
      renderer: [
        {
          name: "gui",
          config: "vite.renderer.config.ts",
        },
      ],
    }),
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
