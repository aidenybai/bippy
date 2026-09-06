import type { BenchmarkContext } from "./harness.js";

export const createHookComponent = (
  React: BenchmarkContext["React"],
  count: number,
  kind: string,
) => {
  const useCustomValue = (index: number): number => {
    const [value] = React.useState(index);
    React.useRef(value);
    return React.useMemo(() => value, [value]);
  };
  const useStateGroup = (offset: number): void => {
    React.useState(offset);
    React.useState(offset + 1);
    React.useState(offset + 2);
    React.useState(offset + 3);
    React.useState(offset + 4);
    React.useState(offset + 5);
    React.useState(offset + 6);
    React.useState(offset + 7);
    React.useState(offset + 8);
    React.useState(offset + 9);
    React.useState(offset + 10);
    React.useState(offset + 11);
    React.useState(offset + 12);
    React.useState(offset + 13);
    React.useState(offset + 14);
    React.useState(offset + 15);
  };
  return () => {
    if (kind === "multi-site" && count >= 16) {
      for (let offset = 0; offset < count; offset += 16) useStateGroup(offset);
    } else {
      for (let index = 0; index < count; index++) {
        if (kind === "custom") useCustomValue(index);
        else React.useState(index);
      }
    }
    return null;
  };
};
