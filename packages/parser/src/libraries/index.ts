import { objectValue, UNDEFINED_VALUE } from "../evaluate/values.js";
import { lazyProperties } from "../frameworks/stubs.js";
import type { LibraryValueProvider, ModeledExports } from "../types.js";
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
import { LINGUI_PACKAGES, linguiValue } from "./lingui.js";
import { LODASH_MODELED_EXPORTS, LODASH_PACKAGES, lodashValue } from "./lodash.js";
import { MOBX_PACKAGES, mobxValue } from "./mobx.js";
import { NODE_FS_PACKAGES, nodeFsValue } from "./node-fs.js";
import { isPurePackage } from "./pure-packages.js";
import { REACT_HOOK_FORM_PACKAGES, reactHookFormValue } from "./react-hook-form.js";
import {
  REACT_INLINESVG_MODELED_EXPORTS,
  REACT_INLINESVG_PACKAGES,
  reactInlineSvgValue,
} from "./react-inlinesvg.js";
import { REDUX_TOOLKIT_PACKAGES, reduxToolkitValue } from "./redux-toolkit.js";
import { REFLUX_PACKAGES, refluxValue } from "./reflux.js";
import { SENTRY_PACKAGES, sentryValue } from "./sentry.js";
import {
  TANSTACK_QUERY_MODELED_EXPORTS,
  TANSTACK_QUERY_PACKAGES,
  tanstackQueryValue,
} from "./tanstack-query.js";
import { TANSTACK_STORE_PACKAGES, tanstackStoreValue } from "./tanstack-store.js";
import {
  USE_SYNC_EXTERNAL_STORE_PACKAGES,
  useSyncExternalStoreValue,
} from "./use-sync-external-store.js";

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
  { packages: REDUX_TOOLKIT_PACKAGES, getValue: reduxToolkitValue },
  { packages: REFLUX_PACKAGES, getValue: refluxValue },
  { packages: SENTRY_PACKAGES, getValue: sentryValue },
  {
    packages: TANSTACK_QUERY_PACKAGES,
    getValue: tanstackQueryValue,
    modeledExports: TANSTACK_QUERY_MODELED_EXPORTS,
  },
  { packages: TANSTACK_STORE_PACKAGES, getValue: tanstackStoreValue },
  { packages: USE_SYNC_EXTERNAL_STORE_PACKAGES, getValue: useSyncExternalStoreValue },
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
  MODELED_PACKAGES.has(packageName) || isPurePackage(packageName);

/** An export modeled while the rest of its package is analyzed from source. */
export const isModeledLibraryExport = (specifier: string, exportName: string): boolean =>
  MODELED_EXPORTS.get(specifier)?.has(exportName) ?? false;

export const getLibraryValue: LibraryValueProvider = (specifier, importedName, project) => {
  for (const model of LIBRARY_MODELS) {
    const value = model.getValue(specifier, importedName, project);
    if (value) return value;
  }
  return importedName === "*" && MODELED_PACKAGES.has(specifier)
    ? lazyProperties(
        objectValue(),
        (key) => getLibraryValue(specifier, key, project) ?? UNDEFINED_VALUE,
      )
    : null;
};
