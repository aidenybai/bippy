import { getDisplayName, getType, isValidElement } from "bippy";
import * as React from "react";
import { createPortal } from "react-dom";
import { describe, expect, it } from "vite-plus/test";

const Component = (): null => null;

// Portions adapted from ReactJSXTransformIntegration-test.js. See ../NOTICE and ../upstream.json.
describe("React element identity", () => {
  it("identifies valid elements", () => {
    const values = [
      <div />,
      <Component />,
      null,
      true,
      {},
      "string",
      Component,
      { type: "div", props: {} },
    ];
    for (const value of values) {
      expect(isValidElement(value)).toBe(React.isValidElement(value));
    }
  });

  it("matches React for exotic elements and non-elements", () => {
    const Forwarded = React.forwardRef(Component);
    const Memoized = React.memo(Component);
    const Lazy = React.lazy(async () => ({ default: Component }));
    for (const value of [
      undefined,
      false,
      0,
      1n,
      Symbol.for("react.element"),
      [],
      <React.Fragment />,
      <React.StrictMode />,
      <React.Suspense />,
      <Forwarded />,
      <Memoized />,
      <Lazy />,
      React.createElement("span"),
      React.cloneElement(<div />),
      { $$typeof: Symbol.for("react.portal") },
      createPortal(<div />, document.createElement("div")),
    ]) {
      expect(isValidElement(value)).toBe(React.isValidElement(value));
    }
  });

  it("rejects string, local-symbol, and coercible identity forgeries", () => {
    for (const marker of [
      "Symbol(react.transitional.element)",
      "Symbol(react.element)",
      Symbol("react.transitional.element"),
      Symbol("react.element"),
      { toString: () => "Symbol(react.transitional.element)" },
      {
        toString: () => {
          throw new Error("must not coerce");
        },
      },
    ]) {
      expect(isValidElement({ $$typeof: marker })).toBe(false);
    }
  });

  it("deliberately accepts the global legacy element symbol across React versions", () => {
    expect(isValidElement({ $$typeof: Symbol.for("react.element") })).toBe(true);
  });
});

describe("component type attacks", () => {
  it("unwraps nested memo and forwardRef without rendering", () => {
    const Wrapped = React.memo(React.memo(React.forwardRef(Component)));
    expect(getType(Wrapped)).toBe(Component);
    expect(getDisplayName(Wrapped)).toBe("Component");
  });

  it("terminates on cyclic wrapper objects", () => {
    const wrapper: { type?: unknown } = {};
    wrapper.type = wrapper;
    expect(getType(wrapper)).toBeNull();
    expect(getDisplayName(wrapper)).toBeNull();
    const secondWrapper = { render: wrapper };
    wrapper.type = secondWrapper;
    expect(getType(wrapper)).toBeNull();
  });

  it("handles deeply nested wrappers without overflowing the call stack", () => {
    let wrapper: unknown = Component;
    for (let depth = 0; depth < 20000; depth++) wrapper = { type: wrapper };
    expect(getType(wrapper)).toBe(Component);
  });

  it("does not initialize lazy components to obtain a name or type", () => {
    let initializationCount = 0;
    const Lazy = React.lazy(async () => {
      initializationCount++;
      return { default: Component };
    });
    expect(getType(Lazy)).toBeNull();
    expect(getDisplayName(Lazy)).toBeNull();
    expect(initializationCount).toBe(0);
  });
});
