const EQUALITY = " === ";
const INEQUALITY = " !== ";

interface Comparison {
  subject: string;
  value: string;
}

const parseComparison = (condition: string, operator: string): Comparison | null => {
  const parts = condition.split(operator);
  return parts.length === 2 ? { subject: parts[0], value: parts[1] } : null;
};

const collectExclusions = (conditions: string[], decided: Set<string>): Map<string, string[]> => {
  const exclusions = new Map<string, string[]>();
  for (const condition of conditions) {
    const comparison = parseComparison(condition, INEQUALITY);
    if (!comparison || decided.has(comparison.subject)) continue;
    exclusions.set(comparison.subject, [
      ...(exclusions.get(comparison.subject) ?? []),
      comparison.value,
    ]);
  }
  return exclusions;
};

export const simplifyConditions = (conditions: string[]): string[] => {
  const decided = new Set(
    conditions.flatMap((condition) => parseComparison(condition, EQUALITY)?.subject ?? []),
  );
  const exclusions = collectExclusions(conditions, decided);
  const written = new Set<string>();
  return conditions.flatMap((condition) => {
    const comparison = parseComparison(condition, INEQUALITY);
    if (!comparison) return [condition];
    const excluded = exclusions.get(comparison.subject) ?? [];
    if (decided.has(comparison.subject) || written.has(comparison.subject)) return [];
    written.add(comparison.subject);
    return excluded.length > 1 ? [`${comparison.subject} ∉ {${excluded.join(", ")}}`] : [condition];
  });
};
