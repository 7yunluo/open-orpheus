import { resolve } from "node:path";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

import { Installer } from "electron-installer-redhat";
import { MakerRpmConfig, rpmArch } from "@electron-forge/maker-rpm";

import { MakerBase, MakerOptions } from "@electron-forge/maker-base";
import { ForgePlatform } from "@electron-forge/shared-types";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";

const execFile = promisify(execFileCb);

export default class MakerSRpm extends MakerBase<MakerRpmConfig> {
  name = "srpm";

  defaultPlatforms: ForgePlatform[] = ["linux"];

  requiredExternalBinaries: string[] = ["rpmbuild"];

  isSupportedOnCurrentPlatform(): boolean {
    return this.isInstalled("electron-installer-redhat");
  }

  async make({ dir, makeDir, targetArch }: MakerOptions): Promise<string[]> {
    const outDir = resolve(makeDir, "srpm", targetArch);

    await this.ensureDirectory(outDir);
    const installer = new Installer({
      ...this.config,
      logger: () => {}, // Suppress logs from electron-installer-redhat
      arch: rpmArch(targetArch),
      src: dir,
      dest: outDir,
    });

    await installer.generateDefaults();
    await installer.generateOptions();
    await installer.generateScripts();
    await installer.createStagingDir();
    await installer.createContents();

    await cp(installer.stagingDir, outDir, { recursive: true });

    const { name, version } = installer.options as { name: string; version: string };
    const sourcesDir = resolve(outDir, "SOURCES");
    const srpmsDir = resolve(outDir, "SRPMS");
    const tarballName = `${name}-${version}.tar.gz`;
    const tarballPath = resolve(sourcesDir, tarballName);
    const specPath = resolve(outDir, "SPECS", `${name}.spec`);

    await mkdir(sourcesDir, { recursive: true });
    await mkdir(srpmsDir, { recursive: true });

    // Bundle the installed file tree into the source tarball
    await execFile("tar", [
      "czf",
      tarballPath,
      "-C",
      resolve(outDir, "BUILD"),
      ".",
    ]);

    // Patch the spec: add Source0 and rewrite %install to extract from the tarball
    let spec = await readFile(specPath, "utf-8");
    spec = spec.replace(/^(URL:.*)$/m, `$1\nSource0: ${tarballName}`);
    spec = spec.replace(
      /(%install\n)[\s\S]*?(\n%)/,
      `$1mkdir -p %{buildroot}\ntar xf %{SOURCE0} -C %{buildroot}\n$2`
    );
    await writeFile(specPath, spec);

    await execFile("rpmbuild", [
      "--define",
      `_topdir ${outDir}`,
      "-bs",
      specPath,
    ]);

    const srpms = await readdir(srpmsDir);

    // Move SRPMs up one level into outDir
    await Promise.all(
      srpms.map((f) => cp(resolve(srpmsDir, f), resolve(outDir, f)))
    );

    // Remove everything except the SRPMs just moved up
    const entries = await readdir(outDir);
    await Promise.all(
      entries
        .filter((e) => !srpms.includes(e))
        .map((e) => rm(resolve(outDir, e), { recursive: true, force: true }))
    );

    return srpms.map((f) => resolve(outDir, f));
  }
}
