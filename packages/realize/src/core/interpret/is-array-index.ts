const ARRAY_INDEX_PATTERN = /^(?:0|[1-9]\d*)$/;

const MAX_ARRAY_INDEX = 2 ** 32 - 2;

export const isArrayIndex = (key: string): boolean =>
  ARRAY_INDEX_PATTERN.test(key) && Number(key) <= MAX_ARRAY_INDEX;
