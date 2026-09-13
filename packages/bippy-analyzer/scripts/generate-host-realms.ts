import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { HostDeclarationIndex, type ResolutionGap } from "../src/host/declaration-index.js";
import {
  getRealmGapReportPath,
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
 * Globals `react-native/Libraries/Core/setUp*.js` and
 * `src/private/setup/setUpDOM.js` install before any app code runs and that
 * `src/types/globals.d.ts` leaves undeclared (`setUpDefaultReactNativeEnvironment.js`
 * lists the files: setUpGlobals, setUpDOM, setUpPerformance, setUpTimers,
 * setUpAlert, setUpNavigator). The DOM classes are React Native's read-only
 * subset, so only their inheritance is declared; there is no `document`.
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
declare class DOMRectReadOnly {}
declare class DOMRect extends DOMRectReadOnly {}
declare class DOMRectList {}
declare class HTMLCollection {}
declare class NodeList {}
declare class Node {}
declare class Document extends Node {}
declare class CharacterData extends Node {}
declare class Text extends CharacterData {}
declare class Element extends Node {}
declare class HTMLElement extends Element {}
`;

const PARSER_DIRECTORY = path.resolve(import.meta.dirname, "..");

const buildIndex = (platform: HostPlatform): HostDeclarationIndex => {
  const declarations = new HostDeclarationIndex(TYPESCRIPT_LIB_DIRECTORY, PARSER_DIRECTORY);
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
      declarations.addSource(
        path.join(PARSER_DIRECTORY, "react-native-runtime.d.ts"),
        REACT_NATIVE_RUNTIME_GLOBALS,
      );
      break;
  }
  return declarations;
};

const countBy = <Item>(items: Item[], getKey: (item: Item) => string): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const item of items) counts[getKey(item)] = (counts[getKey(item)] ?? 0) + 1;
  return counts;
};

const renderGapReport = (gaps: ResolutionGap[]): string =>
  `${JSON.stringify({ total: gaps.length, byReason: countBy(gaps, (gap) => gap.reason), gaps }, null, 2)}\n`;

const writeGenerated = (filePath: string, rendered: string, isCheckMode: boolean): void => {
  if (!isCheckMode) {
    writeFileSync(filePath, rendered);
    return;
  }
  const existing = existsSync(filePath) ? readFileSync(filePath, "utf8") : null;
  if (existing !== rendered) throw new StaleGeneratedFileError(filePath);
};

const isCheckMode = process.argv.includes("--check");

mkdirSync(REALMS_DIRECTORY, { recursive: true });
for (const platform of HOST_PLATFORMS) {
  const { table, gaps } = buildIndex(platform).build();
  writeGenerated(
    getRealmTablePath(platform),
    `${JSON.stringify(encodeHostRealmTable(table))}\n`,
    isCheckMode,
  );
  writeGenerated(getRealmGapReportPath(platform), renderGapReport(gaps), isCheckMode);
  const memberCount = Object.values(table.interfaces).reduce(
    (total, record) => total + Object.keys(record.members).length,
    0,
  );
  console.log(
    `${platform}: ${Object.keys(table.interfaces).length} interfaces, ${memberCount} members, ${gaps.length} gaps ${JSON.stringify(countBy(gaps, (gap) => gap.reason))}`,
  );
}
