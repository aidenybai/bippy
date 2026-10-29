import type { ComponentAnalysis, ContextSetterFields } from "../types";

const isSameSetterFields = (left: Map<string, string>, right: Map<string, string>): boolean =>
  left.size === right.size &&
  [...left].every(([setterName, stateField]) => right.get(setterName) === stateField);

export const collectContextSetterFields = (analyses: ComponentAnalysis[]): ContextSetterFields => {
  const setterFieldsByContext: ContextSetterFields = new Map();
  const conflictingContextKeys = new Set<string>();
  const providedContexts = analyses.flatMap((analysis) => analysis.providedContexts);
  for (const { contextKey, value } of providedContexts) {
    if (value.kind !== "ObjectExpression") continue;
    const setterFields = new Map<string, string>();
    for (const property of value.properties) {
      if (property.value.kind !== "Setter") continue;
      const { binding } = property.value;
      const stateProperty = value.properties.find(
        (candidate) =>
          candidate.value.kind === "Binding" &&
          candidate.value.binding === binding &&
          candidate.value.path.length === 0,
      );
      if (stateProperty) setterFields.set(property.key, stateProperty.key);
    }
    const existingSetterFields = setterFieldsByContext.get(contextKey);
    if (existingSetterFields && !isSameSetterFields(existingSetterFields, setterFields)) {
      conflictingContextKeys.add(contextKey);
      continue;
    }
    setterFieldsByContext.set(contextKey, setterFields);
  }
  for (const [contextKey, setterFields] of setterFieldsByContext)
    if (conflictingContextKeys.has(contextKey) || setterFields.size === 0)
      setterFieldsByContext.delete(contextKey);
  return setterFieldsByContext;
};
