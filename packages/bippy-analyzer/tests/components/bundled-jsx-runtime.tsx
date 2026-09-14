import { Suspense, type ReactNode } from "react";

// A library bundle that inlined `react/jsx-runtime`: elements are plain
// `{ $$typeof, type, key, ref, props }` literals and `Fragment` is React's
// registered symbol rather than the `react` export.

const REACT_ELEMENT_TYPE = Symbol.for("react.transitional.element");
const REACT_FRAGMENT_TYPE = Symbol.for("react.fragment");
const REACT_SUSPENSE_TYPE = Symbol.for("react.suspense");
const RESERVED_PROPS: Record<string, boolean> = {
  key: true,
  ref: true,
  __self: true,
  __source: true,
};

const bundledJsx = (type: unknown, config: Record<string, unknown>, maybeKey?: string) => {
  const props: Record<string, unknown> = {};
  let key: string | null = null;
  if (maybeKey !== undefined) key = `${maybeKey}`;
  if (config.key !== undefined) key = `${config.key}`;
  for (const propName in config) {
    if (Object.prototype.hasOwnProperty.call(config, propName) && !RESERVED_PROPS[propName]) {
      props[propName] = config[propName];
    }
  }
  return { $$typeof: REACT_ELEMENT_TYPE, type, key, ref: null, props, _owner: null };
};

const Row = ({ label, children }: { label: string; children?: ReactNode }) =>
  bundledJsx(REACT_FRAGMENT_TYPE, {
    children: [
      bundledJsx("dt", { children: label }, "term"),
      bundledJsx("dd", { children }, "detail"),
    ],
  });

const Lazy = () =>
  bundledJsx(REACT_SUSPENSE_TYPE, {
    fallback: null,
    children: bundledJsx("output", { children: "ready" }),
  });

export default function BundledJsxRuntime() {
  return (
    <dl>
      <Row label="first">one</Row>
      <Row label="second">
        <Lazy />
      </Row>
      <Suspense fallback={null}>
        {bundledJsx(REACT_FRAGMENT_TYPE, { children: <b>tail</b> })}
      </Suspense>
    </dl>
  );
}

export const isExact = true;
