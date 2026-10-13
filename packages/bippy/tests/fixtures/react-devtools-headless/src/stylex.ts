export interface StyleXData {
  resolvedStyles: Record<string, unknown>;
  sources: string[];
}

const getPropertyValue = (styleName: string): string | null => {
  for (const styleSheet of document.styleSheets) {
    let rules: CSSRuleList;
    try {
      rules = styleSheet.cssRules;
    } catch {
      continue;
    }
    for (const rule of rules) {
      if (!(rule instanceof CSSStyleRule) || !rule.selectorText.startsWith(`.${styleName}`)) {
        continue;
      }
      const property = /{ *([a-z-]+):/.exec(rule.cssText)?.[1];
      if (!property) return null;
      return rule.style.getPropertyValue(property);
    }
  }
  return null;
};

const crawlObject = (
  value: object,
  sources: Set<string>,
  resolvedStyles: Record<string, unknown>,
): void => {
  for (const key of Object.keys(value)) {
    const propertyValue = Reflect.get(value, key);
    if (typeof propertyValue === "string") {
      if (key === propertyValue) sources.add(key);
      else {
        const resolvedValue = getPropertyValue(propertyValue);
        if (resolvedValue !== null) resolvedStyles[key] = resolvedValue;
      }
    } else {
      const nestedStyles: Record<string, unknown> = {};
      resolvedStyles[key] = nestedStyles;
      crawlData(propertyValue, sources, nestedStyles);
    }
  }
};

const crawlData = (
  value: unknown,
  sources: Set<string>,
  resolvedStyles: Record<string, unknown>,
): void => {
  if (value === null || value === undefined || value === false) return;
  if (Array.isArray(value)) {
    for (const entry of value) crawlData(entry, sources, resolvedStyles);
    return;
  }
  if (typeof value === "object") crawlObject(value, sources, resolvedStyles);
};

export const getStyleXData = (value: unknown): StyleXData => {
  const sources = new Set<string>();
  const resolvedStyles: Record<string, unknown> = {};
  crawlData(value, sources, resolvedStyles);
  return { resolvedStyles, sources: [...sources].sort() };
};
