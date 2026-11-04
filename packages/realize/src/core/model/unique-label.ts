export const createUniqueLabel = (
  base: string,
  used: { has: (label: string) => boolean },
  formatSuffix: (suffix: number) => string,
): string => {
  let label = base;
  for (let suffix = 2; used.has(label); suffix++) label = `${base}${formatSuffix(suffix)}`;
  return label;
};
