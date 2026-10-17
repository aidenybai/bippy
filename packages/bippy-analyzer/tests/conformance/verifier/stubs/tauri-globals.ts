const TAURI_OS_INTERNALS = {
  arch: "x86_64",
  eol: "\n",
  exe_extension: "",
  family: "unix",
  os_type: "linux",
  platform: "linux",
  version: "6.0.0",
};

if (Reflect.get(globalThis, "__TAURI_OS_PLUGIN_INTERNALS__") === undefined)
  Reflect.set(globalThis, "__TAURI_OS_PLUGIN_INTERNALS__", TAURI_OS_INTERNALS);
