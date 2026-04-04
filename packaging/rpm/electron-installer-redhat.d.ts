declare module "electron-installer-redhat" {
  export class Installer {
    get contentFunctions(): string[];
    get specPath(): string;
    get stagingDir(): string;
    get options(): Record<string, unknown>;

    constructor(options: object);

    generateDefaults(): Promise<unknown>;
    generateOptions(): Promise<unknown>;
    generateScripts(): Promise<unknown>;
    createStagingDir(): Promise<unknown>;
    createContents(): Promise<unknown>;
    createPackage(): Promise<unknown>;
    movePackage(): Promise<unknown>;

    copyLinuxIcons(): Promise<void>;
    createBinarySymlink(): Promise<void>;
    createCopyright(): Promise<void>;
    createDesktopFile(): Promise<void>;
    createSpec(): Promise<void>;

    [key: string]: unknown;
  }
}
