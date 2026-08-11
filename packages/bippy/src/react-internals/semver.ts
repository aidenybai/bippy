interface SemanticVersion {
  major: string;
  minor: string;
  patch: string;
  prerelease: string[];
}

const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const NUMERIC_IDENTIFIER_PATTERN = /^\d+$/;

const parseSemver = (version: string): SemanticVersion | null => {
  const match = SEMVER_PATTERN.exec(version);
  if (!match) return null;
  const prerelease = match[4]?.split(".") ?? [];
  if (
    prerelease.some(
      (identifier) =>
        NUMERIC_IDENTIFIER_PATTERN.test(identifier) &&
        identifier.length > 1 &&
        identifier.startsWith("0"),
    )
  ) {
    return null;
  }
  return {
    major: match[1],
    minor: match[2],
    patch: match[3],
    prerelease,
  };
};

const compareNumericIdentifiers = (left: string, right: string): -1 | 0 | 1 => {
  if (left.length !== right.length) return left.length < right.length ? -1 : 1;
  if (left === right) return 0;
  return left < right ? -1 : 1;
};

const comparePrereleaseIdentifiers = (left: string, right: string): -1 | 0 | 1 => {
  const isLeftNumeric = NUMERIC_IDENTIFIER_PATTERN.test(left);
  const isRightNumeric = NUMERIC_IDENTIFIER_PATTERN.test(right);
  if (isLeftNumeric && isRightNumeric) return compareNumericIdentifiers(left, right);
  if (isLeftNumeric !== isRightNumeric) return isLeftNumeric ? -1 : 1;
  if (left === right) return 0;
  return left < right ? -1 : 1;
};

const comparePrerelease = (left: string[], right: string[]): -1 | 0 | 1 => {
  if (left.length === 0 || right.length === 0) {
    if (left.length === right.length) return 0;
    return left.length === 0 ? 1 : -1;
  }
  const identifierCount = Math.max(left.length, right.length);
  for (let identifierIndex = 0; identifierIndex < identifierCount; identifierIndex++) {
    const leftIdentifier = left[identifierIndex];
    const rightIdentifier = right[identifierIndex];
    if (leftIdentifier === undefined || rightIdentifier === undefined) {
      return leftIdentifier === undefined ? -1 : 1;
    }
    const comparison = comparePrereleaseIdentifiers(leftIdentifier, rightIdentifier);
    if (comparison !== 0) return comparison;
  }
  return 0;
};

export const compareSemver = (leftVersion: string, rightVersion: string): -1 | 0 | 1 | null => {
  const left = parseSemver(leftVersion);
  const right = parseSemver(rightVersion);
  if (!left || !right) return null;
  const majorComparison = compareNumericIdentifiers(left.major, right.major);
  if (majorComparison !== 0) return majorComparison;
  const minorComparison = compareNumericIdentifiers(left.minor, right.minor);
  if (minorComparison !== 0) return minorComparison;
  const patchComparison = compareNumericIdentifiers(left.patch, right.patch);
  if (patchComparison !== 0) return patchComparison;
  return comparePrerelease(left.prerelease, right.prerelease);
};
