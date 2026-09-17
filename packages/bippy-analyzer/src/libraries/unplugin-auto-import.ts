import path from "node:path";
import { globSync } from "tinyglobby";
import { nativeFunction } from "../evaluate/stubs.js";
import {
  getObjectProperty,
  hasDefiniteItems,
  isKnownString,
  isNullish,
  objectFromRecord,
  primitiveValue,
  UNDEFINED_VALUE,
} from "../evaluate/values.js";
import type { ModuleGraph } from "../graph/module-graph.js";
import type { AutoImport, LibraryValueProvider, ProjectContext, StaticValue } from "../types.js";

// unplugin-auto-import's Vite plugin adds imports for the free identifiers it is
// configured with (`imports` presets and maps, `dirs` of local exports) to every
// module it transforms; the plugin object only carries its options to the Vite
// config reader, which resolves the names unimport would inject.

export const UNPLUGIN_AUTO_IMPORT_PACKAGES = ["unplugin-auto-import"];

const PLUGIN_NAME = "unplugin-auto-import";
const VITE_SPECIFIER = "unplugin-auto-import/vite";
const DIR_FILE_PATTERN = "*.{tsx,jsx,ts,js,mjs,cjs,mts,cts}";
const SCRIPT_FILE = /\.[cm]?[jt]sx?$/;
const DECLARATION_FILE = /\.d\.[cm]?ts$/;
const DEFAULT_INCLUDE = [/\.[jt]sx?$/, /\.vue$/, /\.vue\?vue/, /\.svelte$/];
const DEFAULT_EXCLUDE = [/[\\/]node_modules[\\/]/, /[\\/]\.git[\\/]/];
const NEEDS_CAMEL_CASE = /[-_.]/;
const CASE_SPLITTERS = new Set(["-", "_", "/", "."]);

const REACT_HOOKS = [
  "useState",
  "useCallback",
  "useMemo",
  "useEffect",
  "useRef",
  "useContext",
  "useReducer",
  "useImperativeHandle",
  "useDebugValue",
  "useDeferredValue",
  "useLayoutEffect",
  "useTransition",
  "startTransition",
  "useSyncExternalStore",
  "useInsertionEffect",
  "useId",
  "lazy",
  "memo",
  "createRef",
  "forwardRef",
];

const REACT_ROUTER_HOOKS = [
  "useOutletContext",
  "useHref",
  "useInRouterContext",
  "useLocation",
  "useNavigationType",
  "useNavigate",
  "useOutlet",
  "useParams",
  "useResolvedPath",
  "useRoutes",
];

/** The React-side presets of `src/presets/*`, keyed as `imports` names them. */
const PRESETS: Record<string, Record<string, readonly string[]>> = {
  react: { react: REACT_HOOKS },
  preact: { "preact/hooks": REACT_HOOKS.slice(0, 7) },
  "react-router": { "react-router": REACT_ROUTER_HOOKS },
  "react-router-dom": {
    "react-router-dom": [
      ...REACT_ROUTER_HOOKS,
      "useLinkClickHandler",
      "useSearchParams",
      "Link",
      "NavLink",
      "Navigate",
      "Outlet",
      "Route",
      "Routes",
    ],
  },
  "react-i18next": { "react-i18next": ["useTranslation"] },
  "mobx-react-lite": { "mobx-react-lite": ["observer", "Observer", "useLocalObservable"] },
  jotai: { jotai: ["atom", "useAtom", "useAtomValue", "useSetAtom"] },
  "jotai/utils": {
    "jotai/utils": [
      "atomWithReset",
      "useResetAtom",
      "useReducerAtom",
      "atomWithReducer",
      "atomFamily",
      "selectAtom",
      "useAtomCallback",
      "freezeAtom",
      "freezeAtomCreator",
      "splitAtom",
      "atomWithDefault",
      "waitForAll",
      "atomWithStorage",
      "atomWithHash",
      "createJSONStorage",
      "atomWithObservable",
      "useHydrateAtoms",
      "loadable",
    ],
  },
  recoil: {
    recoil: [
      "atom",
      "selector",
      "useRecoilState",
      "useRecoilValue",
      "useSetRecoilState",
      "useResetRecoilState",
      "useRecoilStateLoadable",
      "useRecoilValueLoadable",
      "isRecoilValue",
      "useRecoilCallback",
    ],
  },
};

const pluginOptions = new WeakMap<StaticValue, StaticValue>();

export const unpluginAutoImportValue: LibraryValueProvider = (specifier, importedName) => {
  if (specifier !== VITE_SPECIFIER || importedName !== "default") return null;
  return nativeFunction(PLUGIN_NAME, ([options = UNDEFINED_VALUE]) => {
    const plugin = objectFromRecord({
      name: primitiveValue(PLUGIN_NAME),
      enforce: primitiveValue("post"),
    });
    pluginOptions.set(plugin, options);
    return plugin;
  });
};

export const getAutoImportPluginOptions = (plugin: StaticValue): StaticValue | null =>
  pluginOptions.get(plugin) ?? null;

interface NamedAutoImport extends AutoImport {
  as: string;
}

/** `toArray`: the option as the plugin lists it, or null when its items are not statically known. */
const readList = (value: StaticValue): StaticValue[] | null => {
  if (isNullish(value) === true) return [];
  if (value.kind !== "list") return [value];
  return hasDefiniteItems(value) ? value.items : null;
};

const readStrings = (value: StaticValue): string[] | null => {
  const items = readList(value);
  if (items === null) return null;
  const strings: string[] = [];
  for (const item of items) {
    if (!isKnownString(item)) return null;
    strings.push(item.value);
  }
  return strings;
};

const toNamed = (specifier: string, name: string, as: string): NamedAutoImport => ({
  specifier,
  imported: name === "default" ? { kind: "default" } : { kind: "named", name },
  as,
});

const readImportMap = (definition: StaticValue): NamedAutoImport[] | null => {
  if (definition.kind !== "object") return null;
  const imports: NamedAutoImport[] = [];
  for (const entry of definition.entries) {
    if (entry.kind !== "property") return null;
    const specifier = entry.key;
    const names = readList(entry.value);
    if (names === null) return null;
    for (const name of names) {
      if (isKnownString(name)) {
        imports.push(toNamed(specifier, name.value, name.value));
        continue;
      }
      const pair = name.kind === "list" ? readStrings(name) : null;
      if (pair === null || pair.length !== 2) return null;
      imports.push(toNamed(specifier, pair[0], pair[1]));
    }
  }
  return imports;
};

const flattenImports = (imports: StaticValue): NamedAutoImport[] | null => {
  const definitions = readList(imports);
  if (definitions === null) return null;
  const flattened: NamedAutoImport[] = [];
  for (const definition of definitions) {
    if (isKnownString(definition)) {
      const preset = PRESETS[definition.value];
      if (preset === undefined) return null;
      for (const [specifier, names] of Object.entries(preset)) {
        flattened.push(...names.map((name) => toNamed(specifier, name, name)));
      }
      continue;
    }
    const mapped = readImportMap(definition);
    if (mapped === null) return null;
    flattened.push(...mapped);
  }
  return flattened;
};

/** scule's `camelCase`: split on `-_/.` and case changes, then join the parts capitalized but the first. */
const camelCase = (name: string): string => {
  const parts: string[] = [];
  let buffer = "";
  let wasUpper: boolean | undefined;
  let wasSplitter: boolean | undefined;
  for (const character of name) {
    if (CASE_SPLITTERS.has(character)) {
      parts.push(buffer);
      buffer = "";
      wasUpper = undefined;
      wasSplitter = true;
      continue;
    }
    const isUpper = /\d/.test(character) ? undefined : character !== character.toLowerCase();
    if (wasSplitter === false) {
      if (wasUpper === false && isUpper === true) {
        parts.push(buffer);
        buffer = character;
        wasUpper = isUpper;
        continue;
      }
      if (wasUpper === true && isUpper === false && buffer.length > 1) {
        parts.push(buffer.slice(0, -1));
        buffer = buffer.slice(-1) + character;
        wasUpper = isUpper;
        continue;
      }
    }
    buffer += character;
    wasUpper = isUpper;
    wasSplitter = false;
  }
  parts.push(buffer);
  const pascal = parts.map((part) => (part ? part[0].toUpperCase() + part.slice(1) : "")).join("");
  return pascal ? pascal[0].toLowerCase() + pascal.slice(1) : "";
};

/** unimport's name for a file's default export: its basename, `index` standing for the directory. */
const defaultExportAlias = (filePath: string): string => {
  const parsed = path.parse(filePath);
  const name = parsed.name === "index" ? path.basename(parsed.dir) : parsed.name;
  return NEEDS_CAMEL_CASE.test(name) ? camelCase(name) : name;
};

const resolveDirGlob = (root: string, glob: string): string =>
  glob.startsWith("!") ? `!${path.resolve(root, glob.slice(1))}` : path.resolve(root, glob);

const scanDirExports = (dirs: string[], root: string, graph: ModuleGraph): NamedAutoImport[] => {
  const files = dirs.flatMap((dir) =>
    globSync(
      [dir, path.join(dir, DIR_FILE_PATTERN)].map((glob) => resolveDirGlob(root, glob)),
      {
        cwd: root,
        absolute: true,
        onlyFiles: true,
        followSymbolicLinks: true,
        expandDirectories: false,
      },
    ).sort(),
  );
  const scanned: NamedAutoImport[] = [];
  for (const filePath of new Set(files)) {
    if (!SCRIPT_FILE.test(filePath) || DECLARATION_FILE.test(filePath)) continue;
    const module = graph.getModule(filePath);
    if (!module) continue;
    for (const name of graph.listExportNames(module)) {
      scanned.push(
        toNamed(filePath, name, name === "default" ? defaultExportAlias(filePath) : name),
      );
    }
  }
  return scanned;
};

const isTransformed = (filePath: string): boolean =>
  DEFAULT_INCLUDE.some((pattern) => pattern.test(filePath)) &&
  !DEFAULT_EXCLUDE.some((pattern) => pattern.test(filePath));

/**
 * The imports the plugin injects, from its options object; null when they are
 * not statically known (a custom `include`/`exclude` filter, resolvers, or a
 * preset outside the React ecosystem), in which case the identifiers it would
 * have bound stay honest unknowns.
 */
export const createAutoImportResolver = (
  options: StaticValue,
  root: string,
  graph: ModuleGraph,
): ProjectContext["findAutoImport"] | null => {
  if (options.kind !== "object") return null;
  for (const unmodeled of ["include", "exclude", "resolvers", "packagePresets"]) {
    if (isNullish(getObjectProperty(options, unmodeled)) !== true) return null;
  }
  const imports = flattenImports(getObjectProperty(options, "imports"));
  const dirs = readStrings(getObjectProperty(options, "dirs"));
  const ignored = readStrings(getObjectProperty(options, "ignore"));
  if (imports === null || dirs === null || ignored === null) return null;
  const byName = new Map<string, AutoImport>();
  for (const { as, ...autoImport } of [...imports, ...scanDirExports(dirs, root, graph)]) {
    if (!byName.has(as) && !ignored.includes(as)) byName.set(as, autoImport);
  }
  return (filePath, name) => (isTransformed(filePath) ? (byName.get(name) ?? null) : null);
};
