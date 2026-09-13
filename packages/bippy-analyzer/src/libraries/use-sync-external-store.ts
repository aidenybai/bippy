import { UNDEFINED_VALUE } from "../evaluate/values.js";
import { nativeFunction } from "../evaluate/stubs.js";
import type { ExternalValueProvider, StaticValue, StubRenderTools } from "../types.js";

export const USE_SYNC_EXTERNAL_STORE_PACKAGES = ["use-sync-external-store"];

const USE_SYNC_EXTERNAL_STORE: StaticValue = { kind: "react-api", api: "useSyncExternalStore" };

/** The shim is React's own `useSyncExternalStore` on React 18+; `withSelector` selects from the subscribed snapshot. */
export const subscribeToExternalStore = (
  subscribe: StaticValue | undefined,
  getSnapshot: StaticValue | undefined,
  selector: StaticValue | undefined,
  tools: StubRenderTools,
): StaticValue => {
  const snapshot = tools.call(
    USE_SYNC_EXTERNAL_STORE,
    [subscribe, getSnapshot].map((argument) => argument ?? UNDEFINED_VALUE),
  );
  return selector ? tools.call(selector, [snapshot]) : snapshot;
};

export const useSyncExternalStoreValue: ExternalValueProvider = (specifier, importedName) => {
  const [packageName] = USE_SYNC_EXTERNAL_STORE_PACKAGES;
  if (specifier !== packageName && !specifier.startsWith(`${packageName}/`)) return null;
  switch (importedName) {
    case "useSyncExternalStore":
      return nativeFunction(importedName, ([subscribe, getSnapshot], tools) =>
        subscribeToExternalStore(subscribe, getSnapshot, undefined, tools),
      );
    case "useSyncExternalStoreWithSelector":
      return nativeFunction(importedName, ([subscribe, getSnapshot, , selector], tools) =>
        subscribeToExternalStore(subscribe, getSnapshot, selector, tools),
      );
    default:
      return null;
  }
};
