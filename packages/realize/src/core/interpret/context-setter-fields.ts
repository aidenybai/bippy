import type { ComponentAnalysis, ContextSetterFields } from "../types";

const isSameSetterFields = (left: Map<string, string>, right: Map<string, string>): boolean =>
  left.size === right.size &&
  [...left].every(([setterName, stateField]) => right.get(setterName) === stateField);

export const collectContextSetterFields = (analyses: ComponentAnalysis[]): ContextSetterFields => {
  const setterFieldsByContext: ContextSetterFields = new Map();
  const conflictingContextKeys = new Set<string>();
  const providedContexts = analyses.flatMap((analysis) => analysis.providedContexts);
  for (const providedContext of providedContexts) {
    if (providedContext.value.kind !== "ObjectExpression") continue;
    const setterFields = new Map<string, string>();
    for (const property of providedContext.value.properties) {
      if (property.value.kind !== "Setter") continue;
      const binding = property.value.binding;
      const stateProperty = providedContext.value.properties.find(
        (candidate) =>
          candidate.value.kind === "Binding" &&
          candidate.value.binding === binding &&
          candidate.value.path.length === 0,
      );
      if (stateProperty) setterFields.set(property.key, stateProperty.key);
    }
    const existingSetterFields = setterFieldsByContext.get(providedContext.contextKey);
    if (existingSetterFields && !isSameSetterFields(existingSetterFields, setterFields)) {
      conflictingContextKeys.add(providedContext.contextKey);
      continue;
    }
    setterFieldsByContext.set(providedContext.contextKey, setterFields);
  }
  for (const [contextKey, setterFields] of setterFieldsByContext)
    if (conflictingContextKeys.has(contextKey) || setterFields.size === 0)
      setterFieldsByContext.delete(contextKey);
  return setterFieldsByContext;
};
