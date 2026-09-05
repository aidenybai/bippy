import { useFiber } from "../../../bippy/src/index.js";
import type { Fiber } from "../../../bippy/src/react-internals/index.js";
import { transformSync } from "@babel/core";
import { cleanup, fireEvent, render } from "@testing-library/react";
import React from "react";
import * as compilerRuntime from "react/compiler-runtime";
import { afterEach, expect, it } from "vite-plus/test";
import { checkCallingFiber, createFiberRootRegistry, matchByProps } from "./use-fiber-oracle.js";

interface CompiledProbeProps {
  onRender: (fiber: Fiber | undefined, props: CompiledProbeProps) => void;
  revision: number;
}

interface CompiledProbeFactory {
  (
    cache: unknown,
    react: typeof React,
    useFiberHook: typeof useFiber,
  ): React.ComponentType<CompiledProbeProps>;
}

const compilerRuntimeCache: unknown = Reflect.get(compilerRuntime, "c");

const probeSource = `
  export function CompiledProbe(props) {
    const fiber = useFiber();
    const [count, setCount] = React.useState(0);
    const label = "count:" + count + ":" + props.revision;
    const handleClick = () => setCount(count + 1);
    props.onRender(fiber, props);
    return React.createElement("button", { onClick: handleClick }, label);
  }
`;

const compileProbe = (): CompiledProbeFactory => {
  const result = transformSync(probeSource, {
    babelrc: false,
    configFile: false,
    filename: "compiled-probe.jsx",
    plugins: [["babel-plugin-react-compiler", { target: "19" }]],
  });
  const compiled = result?.code;
  if (!compiled?.includes("_c(")) throw new Error("React Compiler did not memoize the probe");
  const body = compiled
    .replace(/import \{ c as _c \} from "react\/compiler-runtime";/, "")
    .replace("export function CompiledProbe", "function CompiledProbe");
  return new Function(
    "_c",
    "React",
    "useFiber",
    `${body}\nreturn CompiledProbe;`,
  ) as CompiledProbeFactory;
};

afterEach(cleanup);

it("returns the exact fiber from React Compiler output", () => {
  const CompiledProbe = compileProbe()(compilerRuntimeCache, React, useFiber);
  const registry = createFiberRootRegistry();
  const container = document.createElement("div");
  document.body.appendChild(container);
  registry.addContainer(container);
  const mismatches: unknown[] = [];
  const onRender = (fiber: Fiber | undefined, props: CompiledProbeProps) => {
    mismatches.push(checkCallingFiber(registry, matchByProps(CompiledProbe, props), fiber, true));
  };

  const rendered = render(<CompiledProbe onRender={onRender} revision={1} />, { container });
  rendered.rerender(<CompiledProbe onRender={onRender} revision={2} />);
  fireEvent.click(rendered.getByRole("button"));
  rendered.rerender(<CompiledProbe onRender={onRender} revision={2} />);

  expect(mismatches.length).toBeGreaterThanOrEqual(3);
  expect(mismatches).toEqual(mismatches.map(() => null));
});
