import {
  Fragment,
  jsxDEV as jsxDEVImpl,
  type JSXSource,
} from 'react/jsx-dev-runtime';

export * from 'react/jsx-dev-runtime';

export { Fragment };

export const jsxDEV = (
  type: React.ElementType,
  originalProps: unknown,
  key: React.Key | undefined,
  isStatic: boolean,
  source?: JSXSource,
  self?: unknown
) => {
  let props = originalProps;
  try {
    if (
      originalProps &&
      typeof originalProps === 'object' &&
      source &&
      String(type) !== 'Symbol(react.fragment)'
    ) {
      props = {
        ...originalProps,
        _source: `${source.fileName}:${source.lineNumber}:${source.columnNumber}`,
      };
    }
  } catch {}
  return jsxDEVImpl(type, props, key, isStatic, source, self);
};
