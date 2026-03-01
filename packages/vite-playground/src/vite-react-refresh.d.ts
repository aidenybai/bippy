declare module '/@react-refresh' {
  interface ViteReactRefreshFamily {
    current: unknown;
  }

  interface ViteReactRefreshUpdate {
    staleFamilies: Set<ViteReactRefreshFamily>;
    updatedFamilies: Set<ViteReactRefreshFamily>;
  }

  interface ViteReactRefreshRuntime {
    getFamilyByID: (familyId: string) => ViteReactRefreshFamily | undefined;
    performReactRefresh: () => ViteReactRefreshUpdate | null;
    register: (componentType: unknown, familyId: string) => void;
  }

  const viteReactRefreshRuntime: ViteReactRefreshRuntime;

  export default viteReactRefreshRuntime;
}
