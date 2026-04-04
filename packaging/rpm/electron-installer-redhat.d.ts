declare module "electron-installer-redhat" {
  export class Installer {
    get specPath(): string;
    get stagingDir(): string;

    constructor(options: object);

    generateDefaults(): Promise<unknown>;
    generateOptions(): Promise<unknown>;
    generateScripts(): Promise<unknown>;
    createStagingDir(): Promise<unknown>;
    createContents(): Promise<unknown>;
    createPackage(): Promise<unknown>;
    movePackage(): Promise<unknown>;
  }
}
