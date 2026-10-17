type SearchParamValue = string | string[] | undefined;

interface Parser {
  parseServerSide: (value: SearchParamValue) => unknown;
}

interface CacheOptions {
  urlKeys?: Record<string, string>;
}

export const createSearchParamsCache = (
  parsers: Record<string, Parser>,
  { urlKeys = {} }: CacheOptions = {},
) => {
  const load = (input: Record<string, SearchParamValue>): Record<string, unknown> =>
    Object.fromEntries(
      Object.entries(parsers).map(([key, parser]) => [
        key,
        parser.parseServerSide(input[urlKeys[key] ?? key]),
      ]),
    );
  let searchParams = load({});
  const parseSync = (input: Record<string, SearchParamValue>) => {
    searchParams = load(input);
    return searchParams;
  };
  return {
    parse: (input: Record<string, SearchParamValue> | Promise<Record<string, SearchParamValue>>) =>
      input instanceof Promise ? input.then(parseSync) : parseSync(input),
    get: (key: string) => searchParams[key],
    all: () => searchParams,
  };
};
