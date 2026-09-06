import type { LibraryValueProvider } from "../types.js";
import { EMOTION_PACKAGES, emotionValue } from "./emotion.js";
import {
  FRAMER_MOTION_MODELED_EXPORTS,
  FRAMER_MOTION_PACKAGES,
  framerMotionValue,
} from "./framer-motion.js";
import { JED_PACKAGES, jedValue } from "./jed.js";
import { LINGUI_PACKAGES, linguiValue } from "./lingui.js";
import { LODASH_PACKAGES, lodashValue } from "./lodash.js";
import { REFLUX_PACKAGES, refluxValue } from "./reflux.js";
import { SENTRY_PACKAGES, sentryValue } from "./sentry.js";
import {
  TANSTACK_QUERY_MODELED_EXPORTS,
  TANSTACK_QUERY_PACKAGES,
  tanstackQueryValue,
} from "./tanstack-query.js";

// Libraries the harness models instead of analyzing: their runtime output
// depends on a build-time transform (macros) or on data only present at runtime,
// so interpreting the shipped source would only produce unknowns. A modeled
// package is never resolved to its files unless the model lists the exports it
// covers, in which case the rest of the package is still analyzed.

interface LibraryModel {
  packages: readonly string[];
  getValue: LibraryValueProvider;
  modeledExports?: readonly string[];
}

const LIBRARY_MODELS: readonly LibraryModel[] = [
  { packages: EMOTION_PACKAGES, getValue: emotionValue },
  {
    packages: FRAMER_MOTION_PACKAGES,
    getValue: framerMotionValue,
    modeledExports: FRAMER_MOTION_MODELED_EXPORTS,
  },
  { packages: JED_PACKAGES, getValue: jedValue },
  { packages: LINGUI_PACKAGES, getValue: linguiValue },
  { packages: LODASH_PACKAGES, getValue: lodashValue },
  { packages: REFLUX_PACKAGES, getValue: refluxValue },
  { packages: SENTRY_PACKAGES, getValue: sentryValue },
  {
    packages: TANSTACK_QUERY_PACKAGES,
    getValue: tanstackQueryValue,
    modeledExports: TANSTACK_QUERY_MODELED_EXPORTS,
  },
];

const MODELED_PACKAGES: ReadonlySet<string> = new Set(
  LIBRARY_MODELS.filter((model) => !model.modeledExports).flatMap((model) => model.packages),
);

const MODELED_EXPORTS: ReadonlyMap<string, ReadonlySet<string>> = new Map(
  LIBRARY_MODELS.flatMap((model) =>
    model.modeledExports
      ? model.packages.map((packageName): [string, ReadonlySet<string>] => [
          packageName,
          new Set(model.modeledExports),
        ])
      : [],
  ),
);

export const isModeledLibraryPackage = (packageName: string): boolean =>
  MODELED_PACKAGES.has(packageName);

/** A named export modeled while the rest of its package is analyzed from source. */
export const isModeledLibraryExport = (packageName: string, importedName: string): boolean =>
  MODELED_EXPORTS.get(packageName)?.has(importedName) ?? false;

export const getLibraryValue: LibraryValueProvider = (specifier, importedName, project) => {
  for (const model of LIBRARY_MODELS) {
    const value = model.getValue(specifier, importedName, project);
    if (value) return value;
  }
  return null;
};
