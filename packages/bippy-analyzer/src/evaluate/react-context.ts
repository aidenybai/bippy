import type { SourceLocation } from "../parse/source-types.js";
import type { ContextDefinition, StaticValue } from "../types.js";
import { branchValue, unknownValue } from "./values.js";

/** What a consumer of `definition` sees when `provided` is what the nearest provider supplies (null without one). */
export const providedContextValue = (
  assumeOuterProviders: boolean,
  definition: ContextDefinition,
  provided: StaticValue | null,
  location: SourceLocation | null,
): StaticValue => {
  if (provided) return provided;
  if (!assumeOuterProviders) return definition.defaultValue;
  return branchValue(
    [
      definition.defaultValue,
      unknownValue(`${definition.name} provided outside the analyzed tree`),
    ],
    `no provider for ${definition.name}`,
    location,
  );
};
