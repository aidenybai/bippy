// `forwardRef`, `memo`, `lazy` and `createContext` return plain objects, so
// coercing one to a string reads "[object Object]" and a display-name helper
// that regexes `"" + Component` for a function name finds none and falls back.

import { createContext, forwardRef, memo } from "react";
import type { ComponentType, ForwardRefExoticComponent, MemoExoticComponent } from "react";

interface Named {
  displayName?: string;
  name?: string;
}

const getFunctionName = (value: unknown): string => {
  const match = ""
    .concat(value as string)
    .match(/^\s*function(?:\s|\s*\/\*.*\*\/\s*)+([^(\s/]*)\s*/);
  return match ? match[1] : "";
};

const getComponentName = (value: Named): string =>
  value.displayName || value.name || getFunctionName(value);

const getWrappedName = (outer: Named, inner: Named, wrapper: string): string => {
  const functionName = getComponentName(inner);
  return outer.displayName || (functionName !== "" ? `${wrapper}(${functionName})` : wrapper);
};

const getDisplayName = (
  Component: ForwardRefExoticComponent<object> | MemoExoticComponent<ComponentType<object>>,
): string => {
  if ("render" in Component) return getWrappedName(Component, Component.render, "ForwardRef");
  return getWrappedName(Component, Component.type, "memo");
};

const Inner = forwardRef<HTMLSpanElement, object>(function Inner(_props, ref) {
  return <span ref={ref}>inner</span>;
});

const Memoized = memo(Inner);
const Theme = createContext("light");

export default function WrapperDisplayNames() {
  return (
    <ul>
      <li>{getDisplayName(Inner)}</li>
      <li>{getDisplayName(Memoized)}</li>
      <li>{`${Theme}`}</li>
      <li>{String(<b />)}</li>
      <li>{"".concat(Memoized as unknown as string, "!")}</li>
    </ul>
  );
}
