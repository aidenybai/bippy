declare module '/@react-refresh' {
  interface ViteReactRefreshDefaultExport {
    injectIntoGlobalHook: (globalObject: unknown) => void;
  }

  export const __hmr_import: (module: string) => Promise<unknown>;
  export const createSignatureFunctionForTransform: () => (
    componentType: unknown,
  ) => unknown;
  export const getRefreshReg: (
    filename: string,
  ) => (componentType: unknown, registrationId: string) => void;
  export const registerExportsForReactRefresh: (
    filename: string,
    moduleExports: Record<string, unknown>,
  ) => void;
  export const validateRefreshBoundaryAndEnqueueUpdate: (
    moduleId: string,
    previousExports: Record<string, unknown>,
    nextExports: Record<string, unknown>,
  ) => string | undefined;
  const viteReactRefreshDefaultExport: ViteReactRefreshDefaultExport;

  export default viteReactRefreshDefaultExport;
}
