import { unknownValue } from "../evaluate/values.js";
import { nativeFunction } from "../frameworks/stubs.js";
import type { ExternalValueProvider, StaticValue, StubRenderTools } from "../types.js";

export const USE_SYNC_EXTERNAL_STORE_PACKAGES = ["use-sync-external-store"];

const readSnapshot = (
  getSnapshot: StaticValue | undefined,
  select: (snapshot: StaticValue) => StaticValue,
  tools: StubRenderTools,
): StaticValue =>
  getSnapshot ? select(tools.call(getSnapshot, [])) : unknownValue("external store snapshot");

export const useSyncExternalStoreValue: ExternalValueProvider = (specifier, importedName) => {
  const [packageName] = USE_SYNC_EXTERNAL_STORE_PACKAGES;
  if (specifier !== packageName && !specifier.startsWith(`${packageName}/`)) return null;
  switch (importedName) {
    case "useSyncExternalStore":
      return nativeFunction(importedName, ([, getSnapshot], tools) =>
        readSnapshot(getSnapshot, (snapshot) => snapshot, tools),
      );
    case "useSyncExternalStoreWithSelector":
      return nativeFunction(importedName, ([, getSnapshot, , selector], tools) =>
        readSnapshot(
          getSnapshot,
          (snapshot) => (selector ? tools.call(selector, [snapshot]) : snapshot),
          tools,
        ),
      );
    default:
      return null;
  }
};
