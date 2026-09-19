import { resolvedPromiseValue } from "../evaluate/promises.js";
import { recordInputSource } from "../evaluate/predicates.js";
import { nativeFunction } from "../evaluate/stubs.js";
import { objectValue, unknownValue } from "../evaluate/values.js";
import type { LibraryValueProvider, ModeledExports, StaticValue } from "../types.js";

export const TAURI_PACKAGES = ["@tauri-apps/api/core"];
export const TAURI_MODELED_EXPORTS: ModeledExports = {
  "@tauri-apps/api/core": ["invoke"],
};

const invoke = (): StaticValue =>
  nativeFunction("invoke", ([command]) =>
    resolvedPromiseValue(
      command?.kind === "primitive" && command.value === "load_settings"
        ? objectValue()
        : recordInputSource(unknownValue("result returned by a Tauri command"), "unknown"),
    ),
  );

export const tauriValue: LibraryValueProvider = (specifier, importedName) =>
  specifier === "@tauri-apps/api/core" && importedName === "invoke" ? invoke() : null;
