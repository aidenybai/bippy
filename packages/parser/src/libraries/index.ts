import { objectValue, UNDEFINED_VALUE } from "../evaluate/values.js";
import { lazyProperties } from "../frameworks/stubs.js";
import type { LibraryValueProvider, ModeledExports } from "../types.js";
import { EMOTION_PACKAGES, emotionValue } from "./emotion.js";
import {
  FRAMER_MOTION_MODELED_EXPORTS,
  FRAMER_MOTION_PACKAGES,
  framerMotionValue,
} from "./framer-motion.js";
import { JED_PACKAGES, jedValue } from "./jed.js";
import { KEA_PACKAGES, keaValue } from "./kea.js";
import { LINGUI_PACKAGES, linguiValue } from "./lingui.js";
import { LODASH_PACKAGES, lodashValue } from "./lodash.js";
import { NODE_FS_PACKAGES, nodeFsValue } from "./node-fs.js";
import {
  REACT_INLINESVG_MODELED_EXPORTS,
  REACT_INLINESVG_PACKAGES,
  reactInlineSvgValue,
} from "./react-inlinesvg.js";
import { REFLUX_PACKAGES, refluxValue } from "./reflux.js";
import { SENTRY_PACKAGES, sentryValue } from "./sentry.js";
import {
  TANSTACK_QUERY_MODELED_EXPORTS,
  TANSTACK_QUERY_PACKAGES,
  tanstackQueryValue,
} from "./tanstack-query.js";
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
  {
    packages: FRAMER_MOTION_PACKAGES,
    getValue: framerMotionValue,
    modeledExports: FRAMER_MOTION_MODELED_EXPORTS,
  },
  { packages: JED_PACKAGES, getValue: jedValue },
  { packages: KEA_PACKAGES, getValue: keaValue },
  { packages: LINGUI_PACKAGES, getValue: linguiValue },
  { packages: LODASH_PACKAGES, getValue: lodashValue },
  { packages: NODE_FS_PACKAGES, getValue: nodeFsValue },
  {
    packages: REACT_INLINESVG_PACKAGES,
    getValue: reactInlineSvgValue,
    modeledExports: REACT_INLINESVG_MODELED_EXPORTS,
  },
  { packages: REFLUX_PACKAGES, getValue: refluxValue },
  { packages: SENTRY_PACKAGES, getValue: sentryValue },
  {
    packages: TANSTACK_QUERY_PACKAGES,
    getValue: tanstackQueryValue,
    modeledExports: TANSTACK_QUERY_MODELED_EXPORTS,
  },
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
  MODELED_PACKAGES.has(packageName);

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
