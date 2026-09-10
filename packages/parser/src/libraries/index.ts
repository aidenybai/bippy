import { objectValue, TRUE_VALUE } from "../evaluate/values.js";
import { lazyProperties } from "../evaluate/stubs.js";
import type { LibraryValueProvider, ModeledExports, StaticValue } from "../types.js";
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
  REDUX_TOOLKIT_PACKAGES,
  reduxToolkitValue,
  reduxValue,
} from "./redux-toolkit.js";
import { REFLUX_PACKAGES, refluxValue } from "./reflux.js";
import { SCHEDULER_PACKAGES, schedulerValue } from "./scheduler.js";
import { SENTRY_PACKAGES, sentryValue } from "./sentry.js";
import { STYLED_COMPONENTS_PACKAGES, styledComponentsValue } from "./styled-components.js";
import { STYLEX_PACKAGES, stylexValue } from "./stylex.js";
import {
  TANSTACK_QUERY_MODELED_EXPORTS,
  TANSTACK_QUERY_PACKAGES,
  tanstackQueryValue,
} from "./tanstack-query.js";
import { SWR_PACKAGES, swrValue } from "./swr.js";
import { TANSTACK_STORE_PACKAGES, tanstackStoreValue } from "./tanstack-store.js";
import { UNPLUGIN_AUTO_IMPORT_PACKAGES, unpluginAutoImportValue } from "./unplugin-auto-import.js";
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

interface LibraryModel {
  packages: readonly string[];
  getValue: LibraryValueProvider;
  modeledExports?: ModeledExports;
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
  { packages: REDUX_TOOLKIT_PACKAGES, getValue: reduxToolkitValue },
  { packages: REFLUX_PACKAGES, getValue: refluxValue },
  { packages: SCHEDULER_PACKAGES, getValue: schedulerValue },
  { packages: SENTRY_PACKAGES, getValue: sentryValue },
  { packages: STYLED_COMPONENTS_PACKAGES, getValue: styledComponentsValue },
  { packages: STYLEX_PACKAGES, getValue: stylexValue },
  { packages: SWR_PACKAGES, getValue: swrValue },
  {
    packages: TANSTACK_QUERY_PACKAGES,
    getValue: tanstackQueryValue,
    modeledExports: TANSTACK_QUERY_MODELED_EXPORTS,
  },
  { packages: TANSTACK_STORE_PACKAGES, getValue: tanstackStoreValue },
  { packages: UNPLUGIN_AUTO_IMPORT_PACKAGES, getValue: unpluginAutoImportValue },
  { packages: USE_SYNC_EXTERNAL_STORE_PACKAGES, getValue: useSyncExternalStoreValue },
  { packages: VITE_PACKAGES, getValue: viteValue },
];

const MODELED_PACKAGES: ReadonlySet<string> = new Set(
  LIBRARY_MODELS.filter((model) => !model.modeledExports).flatMap((model) => model.packages),
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

export const isModeledLibraryPackage = (packageName: string): boolean =>
  MODELED_PACKAGES.has(packageName);

/** An export modeled while the rest of its package is analyzed from source. */
export const isModeledLibraryExport = (specifier: string, exportName: string): boolean =>
  MODELED_EXPORTS.get(specifier)?.has(exportName) ?? false;

export const getLibraryValue: LibraryValueProvider = (specifier, importedName, run) => {
  for (const model of LIBRARY_MODELS) {
    const value = model.getValue(specifier, importedName, run);
    if (value) return value;
  }
  if (importedName !== "*" || !MODELED_PACKAGES.has(specifier)) return null;
  const defaultExport = getLibraryValue(specifier, "default", run);
  const unmodeledExport = (key: string): StaticValue => ({
    kind: "external",
    packageName: specifier,
    specifier,
    importedName: key,
    origin: "binding",
  });
  return lazyProperties(
    defaultExport?.kind === "native-function" || defaultExport?.kind === "function"
      ? defaultExport
      : objectValue(),
    (key) =>
      key === "__esModule" && defaultExport
        ? TRUE_VALUE
        : (getLibraryValue(specifier, key, run) ?? unmodeledExport(key)),
  );
};
