/** `CSS.supports(property, value)` asks the same question as `CSS.supports("property: value")`; both record under the declaration text. */
export const toCssSupportsKey = (conditions: readonly string[]): string =>
  conditions.length === 2 ? `${conditions[0]}: ${conditions[1]}` : conditions.join(", ");
