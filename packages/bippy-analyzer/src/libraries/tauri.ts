import { resolvedPromiseValue } from "../evaluate/promises.js";
import { recordInputSource } from "../evaluate/predicates.js";
import { nativeFunction } from "../evaluate/stubs.js";
import { objectValue, primitiveValue, unknownValue } from "../evaluate/values.js";
import type { LibraryValueProvider, ModeledExports, StaticValue } from "../types.js";

export const TAURI_PACKAGES = ["@tauri-apps/api/app", "@tauri-apps/api/core"];
export const TAURI_MODELED_EXPORTS: ModeledExports = {
  "@tauri-apps/api/app": ["getVersion"],
  "@tauri-apps/api/core": ["invoke"],
};

const getVersion = (): StaticValue =>
  nativeFunction("getVersion", () => resolvedPromiseValue(primitiveValue("0.0.0")));

const invoke = (): StaticValue =>
  nativeFunction("invoke", ([command]) =>
    resolvedPromiseValue(
      command?.kind === "primitive" && command.value === "load_settings"
        ? objectValue()
        : recordInputSource(unknownValue("result returned by a Tauri command"), "unknown"),
    ),
  );

export const tauriValue: LibraryValueProvider = (specifier, importedName) =>
  specifier === "@tauri-apps/api/app" && importedName === "getVersion"
    ? getVersion()
    : specifier === "@tauri-apps/api/core" && importedName === "invoke"
      ? invoke()
      : null;
