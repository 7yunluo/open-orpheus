import { dirname, resolve } from "node:path";
import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");

const pkg = JSON.parse(
  await readFile(resolve(projectRoot, "package.json"), "utf-8")
);
const { flatpak: flatpakOptions } = await import(
  new URL("../packaging/options.ts", import.meta.url).href
);

const electronVersion: string = pkg.devDependencies.electron;

// Create a minimal fake app dir so electron-installer-flatpak can generate
// desktop file, wrapper, metadata, and other scaffolding content.
const fakeAppDir = await mkdtemp(resolve(tmpdir(), "fake-electron-app-"));
const fakeOutputDir = await mkdtemp(resolve(tmpdir(), "flatpak-scaffold-out-"));

await writeFile(resolve(fakeAppDir, "version"), electronVersion);
await mkdir(resolve(fakeAppDir, "resources/app"), { recursive: true });
await writeFile(
  resolve(fakeAppDir, "resources/app/package.json"),
  JSON.stringify({
    name: pkg.name,
    version: pkg.version,
    description: flatpakOptions.description,
    license: flatpakOptions.license,
    homepage: flatpakOptions.homepage,
    productName: flatpakOptions.productName,
  })
);
await cp(resolve(projectRoot, "LICENSE"), resolve(fakeAppDir, "LICENSE"));
await writeFile(resolve(fakeAppDir, "chrome-sandbox"), "");

const { Installer } = await import("@malept/electron-installer-flatpak");

const installer = new Installer({
  ...flatpakOptions,
  icon: resolve(projectRoot, flatpakOptions.icon as string),
  src: fakeAppDir,
  dest: fakeOutputDir,
  arch: "noarch",
  logger: () => {},
});

await installer.generateDefaults();
await installer.generateOptions();
await installer.createStagingDir();

for (const fn of installer.contentFunctions) {
  if (fn === "copyApplication") continue;
  await (installer[fn] as () => Promise<void>)();
}

// Process the `files` option explicitly because createBundle() is not run.
for (const [src, dest] of (flatpakOptions.files ?? []) as [string, string][]) {
  const srcAbs = resolve(projectRoot, src);
  const destAbs = resolve(
    installer.stagingDir,
    installer.baseAppDir,
    dest.replace(/^\//, "")
  );
  await mkdir(dirname(destAbs), { recursive: true });
  await cp(srcAbs, destAbs);
}

await mkdir("/app", { recursive: true });
for (const entry of await readdir(installer.stagingDir)) {
  await cp(resolve(installer.stagingDir, entry), resolve("/app", entry), {
    recursive: true,
  });
}

await rm(fakeAppDir, { recursive: true, force: true });
await rm(fakeOutputDir, { recursive: true, force: true });

console.log("Flatpak scaffolding installed to /app");
