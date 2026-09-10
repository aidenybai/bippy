import type { BenchmarkContext } from "./harness.js";
import { createDistinctHookComponent } from "./distinct-hook-fixture.js";

export interface HookFixtureConfiguration {
  count: number;
  kind: "state" | "custom" | "distinct";
}

export const createHookComponent = (
  React: BenchmarkContext["React"],
  { count, kind }: HookFixtureConfiguration,
) => {
  if (kind === "distinct") return createDistinctHookComponent(React, count);
  const useCustomValue = (index: number): number => {
    const [value] = React.useState(index);
    React.useRef(value);
    return React.useMemo(() => value, [value]);
  };
  return () => {
    for (let index = 0; index < count; index++) {
      if (kind === "custom") useCustomValue(index);
      else React.useState(index);
    }
    return null;
  };
};
