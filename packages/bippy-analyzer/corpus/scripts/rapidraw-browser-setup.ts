import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const shimSource = `interface TauriCallback {
  (...arguments_: unknown[]): void;
}

const callbacks = new Map<number, TauriCallback>();
let nextCallbackId = 1;

const getInvokeResult = (command: string): unknown => {
  switch (command) {
    case "load_settings":
      return {};
    case "get_supported_file_types":
      return { extensions: [], mimeTypes: [] };
    case "load_presets":
    case "get_albums":
    case "get_pinned_folder_trees":
      return [];
    case "check_ai_connector_status":
    case "plugin:window|is_fullscreen":
    case "plugin:window|is_maximized":
      return false;
    case "plugin:app|version":
      return "0.0.0";
    case "plugin:event|listen":
      return 1;
    default:
      return undefined;
  }
};

const transformCallback = (callback: TauriCallback): number => {
  const callbackId = nextCallbackId++;
  callbacks.set(callbackId, callback);
  return callbackId;
};

const unregisterCallback = (callbackId: number): void => {
  callbacks.delete(callbackId);
};

const runCallback = (callbackId: number, ...arguments_: unknown[]): void => {
  callbacks.get(callbackId)?.(...arguments_);
};

Object.assign(window, {
  __TAURI_INTERNALS__: {
    __TAURI_PATTERN__: { pattern: "brownfield" },
    plugins: { path: { sep: "/", delimiter: ":" } },
    metadata: {
      currentWindow: { label: "main" },
      currentWebview: { label: "main" },
    },
    callbacks,
    invoke: (command: string) => Promise.resolve(getInvokeResult(command)),
    convertFileSrc: (filePath: string) => filePath,
    ipc: () => undefined,
    postMessage: () => undefined,
    runCallback,
    transformCallback,
    unregisterCallback,
  },
  __TAURI_EVENT_PLUGIN_INTERNALS__: {
    unregisterListener: () => undefined,
  },
  __TAURI_OS_PLUGIN_INTERNALS__: {
    arch: "x86_64",
    eol: "\\n",
    exe_extension: "",
    family: "unix",
    os_type: "linux",
    platform: "linux",
    version: "6.8.0",
  },
});
`;

const shimDirectory = path.join("src", "__browser__");
const shimPath = path.join(shimDirectory, "tauri-shim.ts");
mkdirSync(shimDirectory, { recursive: true });
writeFileSync(shimPath, shimSource);

const indexPath = "index.html";
const indexSource = readFileSync(indexPath, "utf8");
const mainScript = '<script type="module" src="/src/main.jsx"></script>';
const shimScript = '<script type="module" src="/src/__browser__/tauri-shim.ts"></script>';
if (!indexSource.includes(shimScript)) {
  writeFileSync(indexPath, indexSource.replace(mainScript, `${shimScript}\n    ${mainScript}`));
}
