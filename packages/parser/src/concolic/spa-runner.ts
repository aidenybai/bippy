import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { FrameworkTargetError } from "../errors.js";
import type { EntryRunner } from "./explore.js";
import type { ConcolicRealm } from "./realm.js";

// A single-page app boots itself: the served `index.html` names the module
// script, which calls `createRoot().render()` on the app's own react-dom. The
// runner only writes the page shell and loads that module.

export interface SpaTarget {
  servedDirectory: string;
  /** Entry module; the page shell's module script when null. */
  entry: string | null;
  /** Export of `entry` mounted by the boot code when the root render call is not literal. */
  rootComponent: string | null;
  /** `path#export` functions called before mounting, in order. */
  bootstrap: string[];
}

const MODULE_SCRIPT_PATTERN =
  /<script\b[^>]*\btype\s*=\s*["']module["'][^>]*\bsrc\s*=\s*["']([^"']+)["']/i;

const readPageShell = (servedDirectory: string): string | null => {
  const indexPath = path.join(servedDirectory, "index.html");
  return existsSync(indexPath) ? readFileSync(indexPath, "utf8") : null;
};

/** The module script the page loads, resolved against the served root. */
const findPageEntry = (shell: string | null, servedDirectory: string): string | null => {
  const match = shell?.match(MODULE_SCRIPT_PATTERN);
  if (!match) return null;
  const source = match[1];
  if (/^[a-z]+:/i.test(source)) return null;
  return path.join(servedDirectory, source.replace(/^\//, ""));
};

const callBootstrap = async (
  realm: ConcolicRealm,
  reference: string,
  rootDirectory: string,
): Promise<void> => {
  const [modulePath, exportName] = reference.split("#");
  const filePath = path.resolve(rootDirectory, modulePath);
  const moduleExports: unknown = realm.load(filePath);
  const record: Record<string, unknown> = Object(moduleExports);
  const callback = exportName === undefined ? record.default : record[exportName];
  if (typeof callback !== "function") {
    throw new FrameworkTargetError(`bootstrap ${reference} is not a function`);
  }
  await Reflect.apply(callback, undefined, []);
};

export const createSpaRunner = (target: SpaTarget, rootDirectory: string): EntryRunner => {
  const shell = readPageShell(target.servedDirectory);
  const entryFile =
    target.entry !== null
      ? path.resolve(rootDirectory, target.entry)
      : findPageEntry(shell, target.servedDirectory);
  if (entryFile === null) {
    throw new FrameworkTargetError(
      "spa concolic rendering needs an entry module or a page shell naming one",
    );
  }
  return {
    run: async (realm) => {
      if (shell !== null) realm.window.document.write(shell);
      for (const reference of target.bootstrap)
        await callBootstrap(realm, reference, rootDirectory);
      if (target.rootComponent === null) {
        realm.load(entryFile);
        return;
      }
      const moduleExports: Record<string, unknown> = Object(realm.load(entryFile));
      const component = moduleExports[target.rootComponent];
      const react: Record<string, unknown> = Object(realm.require("react", entryFile));
      const client: Record<string, unknown> = Object(realm.require("react-dom/client", entryFile));
      if (typeof react.createElement !== "function" || typeof client.createRoot !== "function") {
        throw new FrameworkTargetError(
          "react and react-dom/client must resolve from the entry module",
        );
      }
      const container = realm.window.document.createElement("div");
      realm.window.document.body.appendChild(container);
      const root: Record<string, unknown> = Object(client.createRoot(container));
      if (typeof root.render !== "function")
        throw new FrameworkTargetError("createRoot() returned no root");
      root.render(react.createElement(component));
    },
  };
};
