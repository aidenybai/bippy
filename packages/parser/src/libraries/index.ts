import { objectValue, UNDEFINED_VALUE } from "../evaluate/values.js";
import { lazyProperties } from "../evaluate/stubs.js";
import type { LibraryValueProvider, ModeledExports, ModeledMethod } from "../types.js";
import { AXIOS_PACKAGES, axiosValue } from "./axios.js";
import { DEEPMERGE_PACKAGES, deepmergeValue } from "./deepmerge.js";
import { EMOTION_PACKAGES, emotionValue } from "./emotion.js";
import { ES_SHIM_PACKAGES, esShimValue } from "./es-shims.js";
import { FOREIGN_RENDERER_PACKAGES, foreignRendererValue } from "./foreign-renderers.js";
import {
  FRAMER_MOTION_MODELED_EXPORTS,
  FRAMER_MOTION_PACKAGES,
  framerMotionValue,
} from "./framer-motion.js";
import {
  HOIST_NON_REACT_STATICS_PACKAGES,
  hoistNonReactStaticsValue,
} from "./hoist-non-react-statics.js";
import { IMMER_PACKAGES, immerValue } from "./immer.js";
import { JED_PACKAGES, jedValue } from "./jed.js";
import { JOTAI_MODELED_EXPORTS, JOTAI_PACKAGES, jotaiValue } from "./jotai.js";
import { KEA_PACKAGES, keaValue } from "./kea.js";
import { LINARIA_PACKAGES, linariaValue } from "./linaria.js";
import { LINGUI_PACKAGES, linguiValue } from "./lingui.js";
import { LODASH_MODELED_EXPORTS, LODASH_PACKAGES, lodashValue } from "./lodash.js";
import { MOBX_PACKAGES, mobxValue } from "./mobx.js";
import { NODE_FS_PACKAGES, nodeFsValue } from "./node-fs.js";
import { REACT_HOOK_FORM_PACKAGES, reactHookFormValue } from "./react-hook-form.js";
import {
  REACT_INLINESVG_MODELED_EXPORTS,
  REACT_INLINESVG_PACKAGES,
  reactInlineSvgValue,
} from "./react-inlinesvg.js";
import {
  REACT_LIFECYCLES_COMPAT_PACKAGES,
  reactLifecyclesCompatValue,
} from "./react-lifecycles-compat.js";
import {
  REDUX_PERSIST_MODELED_EXPORTS,
  REDUX_PERSIST_PACKAGES,
  reduxPersistValue,
} from "./redux-persist.js";
import {
  REDUX_MODELED_EXPORTS,
  REDUX_PACKAGES,
  REDUX_THUNK_PACKAGES,
  REDUX_TOOLKIT_PACKAGES,
  reduxThunkValue,
  reduxToolkitValue,
  reduxValue,
} from "./redux-toolkit.js";
import { REFLUX_PACKAGES, refluxValue } from "./reflux.js";
import { SENTRY_PACKAGES, sentryValue } from "./sentry.js";
import { STYLED_COMPONENTS_PACKAGES, styledComponentsValue } from "./styled-components.js";
import { STYLEX_PACKAGES, stylexValue } from "./stylex.js";
import {
  TANSTACK_QUERY_MODELED_EXPORTS,
  TANSTACK_QUERY_MODELED_METHODS,
  TANSTACK_QUERY_PACKAGES,
  tanstackQueryValue,
} from "./tanstack-query.js";
import { TANSTACK_STORE_PACKAGES, tanstackStoreValue } from "./tanstack-store.js";
import {
  USE_SYNC_EXTERNAL_STORE_PACKAGES,
  useSyncExternalStoreValue,
} from "./use-sync-external-store.js";
import { VITE_PACKAGES, viteValue } from "./vite.js";

// Libraries the harness models instead of analyzing: their runtime output
// depends on a build-time transform (macros) or on data only present at runtime,
// so interpreting the shipped source would only produce unknowns. A modeled
// package is never resolved to its files unless the model lists the exports it
// covers per specifier, in which case the rest of the package is still analyzed.
// A model may also replace single prototype methods of classes the analyzed
// source defines, where only that method's outcome depends on runtime data.
// The packages one model lists are a single library (a facade re-exporting its
// core): allowing any of them for analysis allows them all.

interface LibraryModel {
  packages: readonly string[];
  getValue: LibraryValueProvider;
  modeledExports?: ModeledExports;
  modeledMethods?: readonly ModeledMethod[];
}

const LIBRARY_MODELS: readonly LibraryModel[] = [
  { packages: AXIOS_PACKAGES, getValue: axiosValue },
  { packages: DEEPMERGE_PACKAGES, getValue: deepmergeValue },
  { packages: EMOTION_PACKAGES, getValue: emotionValue },
  { packages: ES_SHIM_PACKAGES, getValue: esShimValue },
  { packages: FOREIGN_RENDERER_PACKAGES, getValue: foreignRendererValue },
  {
    packages: FRAMER_MOTION_PACKAGES,
    getValue: framerMotionValue,
    modeledExports: FRAMER_MOTION_MODELED_EXPORTS,
  },
  { packages: HOIST_NON_REACT_STATICS_PACKAGES, getValue: hoistNonReactStaticsValue },
  { packages: IMMER_PACKAGES, getValue: immerValue },
  { packages: JED_PACKAGES, getValue: jedValue },
  { packages: JOTAI_PACKAGES, getValue: jotaiValue, modeledExports: JOTAI_MODELED_EXPORTS },
  { packages: KEA_PACKAGES, getValue: keaValue },
  { packages: LINARIA_PACKAGES, getValue: linariaValue },
  { packages: LINGUI_PACKAGES, getValue: linguiValue },
  {
    packages: LODASH_PACKAGES,
    getValue: lodashValue,
    modeledExports: LODASH_MODELED_EXPORTS,
  },
  { packages: MOBX_PACKAGES, getValue: mobxValue },
  { packages: NODE_FS_PACKAGES, getValue: nodeFsValue },
  { packages: REACT_HOOK_FORM_PACKAGES, getValue: reactHookFormValue },
  {
    packages: REACT_INLINESVG_PACKAGES,
    getValue: reactInlineSvgValue,
    modeledExports: REACT_INLINESVG_MODELED_EXPORTS,
  },
  { packages: REACT_LIFECYCLES_COMPAT_PACKAGES, getValue: reactLifecyclesCompatValue },
  { packages: REDUX_PACKAGES, getValue: reduxValue, modeledExports: REDUX_MODELED_EXPORTS },
  {
    packages: REDUX_PERSIST_PACKAGES,
    getValue: reduxPersistValue,
    modeledExports: REDUX_PERSIST_MODELED_EXPORTS,
  },
  { packages: REDUX_THUNK_PACKAGES, getValue: reduxThunkValue },
  { packages: REDUX_TOOLKIT_PACKAGES, getValue: reduxToolkitValue },
  { packages: REFLUX_PACKAGES, getValue: refluxValue },
  { packages: SENTRY_PACKAGES, getValue: sentryValue },
  { packages: STYLED_COMPONENTS_PACKAGES, getValue: styledComponentsValue },
  { packages: STYLEX_PACKAGES, getValue: stylexValue },
  {
    packages: TANSTACK_QUERY_PACKAGES,
    getValue: tanstackQueryValue,
    modeledExports: TANSTACK_QUERY_MODELED_EXPORTS,
    modeledMethods: TANSTACK_QUERY_MODELED_METHODS,
  },
  { packages: TANSTACK_STORE_PACKAGES, getValue: tanstackStoreValue },
  { packages: USE_SYNC_EXTERNAL_STORE_PACKAGES, getValue: useSyncExternalStoreValue },
  { packages: VITE_PACKAGES, getValue: viteValue },
];

const MODELED_PACKAGES: ReadonlySet<string> = new Set(
  LIBRARY_MODELS.filter((model) => !model.modeledExports).flatMap((model) => model.packages),
);

const LIBRARY_PACKAGES_BY_PACKAGE: ReadonlyMap<string, readonly string[]> = new Map(
  LIBRARY_MODELS.filter((model) => model.modeledExports).flatMap((model) =>
    model.packages.map((packageName): [string, readonly string[]] => [packageName, model.packages]),
  ),
);

const MODELED_EXPORTS: ReadonlyMap<string, ReadonlySet<string>> = new Map(
  LIBRARY_MODELS.flatMap((model) =>
    Object.entries(model.modeledExports ?? {}).map(
      ([specifier, exportNames]): [string, ReadonlySet<string>] => [
        specifier,
        new Set(exportNames),
      ],
    ),
  ),
);

const MODELED_METHODS: ReadonlyMap<string, ModeledMethod> = new Map(
  LIBRARY_MODELS.flatMap((model) => model.modeledMethods ?? []).map(
    (method): [string, ModeledMethod] => [
      `${method.packageName}\u0000${method.className}\u0000${method.methodName}`,
      method,
    ],
  ),
);

export const isModeledLibraryPackage = (packageName: string): boolean =>
  MODELED_PACKAGES.has(packageName);

/** The model replacing `className#methodName` of a class `packageName` defines, if any. */
export const getModeledMethod = (
  packageName: string | null,
  className: string | null,
  methodName: string,
): ModeledMethod | null =>
  packageName === null || className === null
    ? null
    : (MODELED_METHODS.get(`${packageName}\u0000${className}\u0000${methodName}`) ?? null);

/** Every package of the partially modeled library `packageName` belongs to, itself included. */
export const getModeledLibraryPackages = (packageName: string): readonly string[] =>
  LIBRARY_PACKAGES_BY_PACKAGE.get(packageName) ?? [packageName];

/** An export modeled while the rest of its package is analyzed from source. */
export const isModeledLibraryExport = (specifier: string, exportName: string): boolean =>
  MODELED_EXPORTS.get(specifier)?.has(exportName) ?? false;

export const getLibraryValue: LibraryValueProvider = (specifier, importedName, project) => {
  for (const model of LIBRARY_MODELS) {
    const value = model.getValue(specifier, importedName, project);
    if (value) return value;
  }
  if (importedName !== "*" || !MODELED_PACKAGES.has(specifier)) return null;
  const defaultExport = getLibraryValue(specifier, "default", project);
  return lazyProperties(
    defaultExport?.kind === "native-function" || defaultExport?.kind === "function"
      ? defaultExport
      : objectValue(),
    (key) => getLibraryValue(specifier, key, project) ?? UNDEFINED_VALUE,
  );
};
