/// <reference types="vite/client" />
declare module "svgcanvas" {
  export class Context {
    constructor(opts: { width: number; height: number });
    getSerializedSvg(fixNamedEntities?: boolean): string;
  }
}
