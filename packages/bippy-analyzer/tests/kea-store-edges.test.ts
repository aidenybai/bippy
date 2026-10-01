import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { readKeaStores } from "../src/harness/kea-store.js";

const viteModuleUrl = "../../tests/kea-module-stubs/.vite/deps/kea.js";
const indexModuleUrl = "../../tests/kea-module-stubs/kea/lib/index.js";
const namespaceModuleUrl = "../../tests/kea-module-stubs/kea/lib/index.esm.js";
const missingModuleUrl = "../../tests/kea-module-stubs/missing/kea/lib/index.js";

const createStore = (name: string) => ({
  getState: () => ({ name }),
  subscribe: () => () => {},
});

const withResourceUrls = async (urls: string[]) => {
  vi.stubGlobal("performance", {
    getEntriesByType: () => urls.map((name) => ({ name })),
  });
  try {
    return await readKeaStores();
  } finally {
    vi.unstubAllGlobals();
  }
};

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(globalThis, "__bippyKeaThrow");
  Reflect.deleteProperty(globalThis, "__bippyKeaVite");
  Reflect.deleteProperty(globalThis, "__bippyKeaIndex");
});

describe("kea store discovery", () => {
  it("returns no stores when performance is absent", async () => {
    vi.stubGlobal("performance", undefined);
    await expect(readKeaStores()).resolves.toEqual([]);
  });

  it("imports each distinct kea module url and keeps distinct stores", async () => {
    const viteStore = createStore("vite");
    const indexStore = createStore("index");
    Reflect.set(globalThis, "__bippyKeaVite", { store: viteStore });
    Reflect.set(globalThis, "__bippyKeaIndex", { store: indexStore });
    const stores = await withResourceUrls([
      "https://cdn.example/react.js",
      viteModuleUrl,
      viteModuleUrl,
      `${viteModuleUrl}?t=1`,
      indexModuleUrl,
      namespaceModuleUrl,
      missingModuleUrl,
    ]);
    expect(stores).toEqual([viteStore, indexStore]);
  });

  it("keeps one copy when two kea modules share a store", async () => {
    const sharedStore = createStore("shared");
    Reflect.set(globalThis, "__bippyKeaVite", { store: sharedStore });
    Reflect.set(globalThis, "__bippyKeaIndex", { store: sharedStore });
    const stores = await withResourceUrls([viteModuleUrl, indexModuleUrl]);
    expect(stores).toEqual([sharedStore]);
  });

  it("skips a kea module whose context is not a redux store", async () => {
    Reflect.set(globalThis, "__bippyKeaVite", null);
    Reflect.set(globalThis, "__bippyKeaIndex", 1);
    const withoutContext = await withResourceUrls([
      viteModuleUrl,
      indexModuleUrl,
      namespaceModuleUrl,
    ]);
    expect(withoutContext).toEqual([]);
    Reflect.set(globalThis, "__bippyKeaVite", { store: { getState: () => ({}) } });
    const withoutSubscribe = await withResourceUrls([viteModuleUrl]);
    expect(withoutSubscribe).toEqual([]);
    Reflect.set(globalThis, "__bippyKeaThrow", true);
    const thrown = await withResourceUrls([viteModuleUrl, indexModuleUrl]);
    expect(thrown).toEqual([]);
  });
});
