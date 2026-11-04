const PREVIEW_COUNT = 6;
const LONG_PREVIEW_COUNT = 3;
const LONG_VALUE = 24;

export const isLongDomain = (values: string[]): boolean =>
  values.some((value) => value.length > LONG_VALUE);

export const getPreviewCount = (values: string[]): number => {
  const preview = isLongDomain(values) ? LONG_PREVIEW_COUNT : PREVIEW_COUNT;
  return values.length - preview > 1 ? preview : values.length;
};

export const shortenType = (value: string): string => value.replace(/<[\s\S]*>$/, "<…>");
