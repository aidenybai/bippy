const compareVersions = (left: string, right: string): number => {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index++) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference > 0 ? 1 : -1;
  }
  return 0;
};

export const satisfiesReactVersion = (version: string, range: string): boolean => {
  const match = /^(>=|<=|>|<|=)\s*(\d+(?:\.\d+){0,2})$/.exec(range.trim());
  if (!match) return false;
  const comparison = compareVersions(version, match[2]);
  if (match[1] === ">=") return comparison >= 0;
  if (match[1] === "<=") return comparison <= 0;
  if (match[1] === ">") return comparison > 0;
  if (match[1] === "<") return comparison < 0;
  return comparison === 0;
};

export const satisfyAllReactVersions = (version: string, ranges: string[]): boolean =>
  ranges.every((range) => satisfiesReactVersion(version, range));

export const evaluateGate = (value: boolean, callback: () => void): void => {
  if (value) callback();
  else expectFailure(callback);
};

const expectFailure = (callback: () => void): void => {
  let didThrow = false;
  try {
    callback();
  } catch {
    didThrow = true;
  }
  if (!didThrow) throw new Error("Gated test was expected to fail");
};
