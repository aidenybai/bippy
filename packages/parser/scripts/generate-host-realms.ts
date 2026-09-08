import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { HostDeclarationIndex } from "../src/host/declaration-index.js";
import {
  getRealmTablePath,
  HOST_PLATFORMS,
  type HostPlatform,
  REALMS_DIRECTORY,
} from "../src/host/host-realm.js";
import { encodeHostRealmTable } from "../src/host/realm-table.js";
import { StaleGeneratedFileError } from "../src/errors.js";

const require = createRequire(import.meta.url);

const TYPESCRIPT_LIB_DIRECTORY = path.join(
  path.dirname(require.resolve("typescript/package.json")),
  "lib",
);

const getTypescriptLib = (name: string): string =>
  path.join(TYPESCRIPT_LIB_DIRECTORY, `lib.${name}.d.ts`);

/**
 * Globals `react-native/Libraries/Core/setUp*.js` installs before any app code
 * runs and that `src/types/globals.d.ts` leaves undeclared (`InitializeCore.js`
 * lists the files: setUpGlobals, setUpNavigator, setUpTimers, setUpPerformance,
 * setUpAlert).
 */
const REACT_NATIVE_RUNTIME_GLOBALS = `
declare var global: typeof globalThis;
declare var window: typeof globalThis;
declare var self: typeof globalThis;
interface ReactNativeNavigator {
  product: string;
}
declare var navigator: ReactNativeNavigator;
interface ReactNativeProcessEnv {
  NODE_ENV: string;
}
interface ReactNativeProcess {
  env: ReactNativeProcessEnv;
}
declare var process: ReactNativeProcess;
declare function queueMicrotask(callback: () => void): void;
declare function requestIdleCallback(callback: () => void): number;
declare function cancelIdleCallback(handle: number): void;
interface ReactNativePerformance {
  now(): number;
}
declare var performance: ReactNativePerformance;
declare function alert(text: string): void;
`;

const buildIndex = (platform: HostPlatform): HostDeclarationIndex => {
  const declarations = new HostDeclarationIndex(TYPESCRIPT_LIB_DIRECTORY);
  declarations.addFile(getTypescriptLib("esnext"));
  switch (platform) {
    case "ecmascript":
      break;
    case "browser":
      declarations.addFile(getTypescriptLib("dom"));
      declarations.addFile(getTypescriptLib("dom.iterable"));
      declarations.addFile(getTypescriptLib("dom.asynciterable"));
      break;
    case "node":
      declarations.addFile(require.resolve("@types/node/index.d.ts"));
      break;
    case "react-native":
      declarations.addFile(
        path.join(
          path.dirname(require.resolve("react-native/package.json")),
          "src",
          "types",
          "globals.d.ts",
        ),
      );
      declarations.addSource("react-native-runtime.d.ts", REACT_NATIVE_RUNTIME_GLOBALS);
      break;
  }
  return declarations;
};

const renderTable = (platform: HostPlatform): string =>
  `${JSON.stringify(encodeHostRealmTable(buildIndex(platform).toTable()))}\n`;

const isCheckMode = process.argv.includes("--check");

mkdirSync(REALMS_DIRECTORY, { recursive: true });
for (const platform of HOST_PLATFORMS) {
  const tablePath = getRealmTablePath(platform);
  const rendered = renderTable(platform);
  if (isCheckMode) {
    const existing = existsSync(tablePath) ? readFileSync(tablePath, "utf8") : null;
    if (existing !== rendered) throw new StaleGeneratedFileError(tablePath);
  } else {
    writeFileSync(tablePath, rendered);
  }
}
