import { merge, mergeWith } from "lodash-es";

interface StyleProps {
  colorMode: "light" | "dark";
}

interface Theme {
  config: { initialColorMode: "light" | "dark"; useSystemColorMode: boolean };
  colors: { brand: Record<number, string>; accent: string };
  sizes: string[];
  components: {
    Button: {
      baseStyle: Record<string, string> | ((props: StyleProps) => Record<string, string>);
    };
  };
}

const baseTheme: Theme = {
  config: { initialColorMode: "light", useSystemColorMode: false },
  colors: { brand: { 500: "#3182ce" }, accent: "teal" },
  sizes: ["sm", "md", "lg"],
  components: { Button: { baseStyle: (props) => ({ color: props.colorMode }) } },
};

const isFunction = (value: unknown): value is (...args: unknown[]) => unknown =>
  typeof value === "function";

/** Chakra UI's `extendTheme` customizer: functions on either side merge lazily. */
const mergeThemeOverride = (objValue: unknown, srcValue: unknown): unknown => {
  if (isFunction(srcValue) || isFunction(objValue)) {
    return (...args: unknown[]) => {
      const source = isFunction(srcValue) ? srcValue(...args) : srcValue;
      const target = isFunction(objValue) ? objValue(...args) : objValue;
      return mergeWith({}, target, source, mergeThemeOverride);
    };
  }
  return undefined;
};

const extendTheme = (...extensions: object[]): Theme => {
  let overrides: Theme = { ...baseTheme };
  for (const extension of extensions) {
    overrides = mergeWith({}, overrides, extension, mergeThemeOverride);
  }
  return overrides;
};

const theme = extendTheme(
  { colors: { brand: { 600: "#2b6cb0" } }, sizes: ["xs"] },
  { components: { Button: { baseStyle: { fontWeight: "bold" } } }, config: { accent: undefined } },
);

const preferences = merge(
  { layout: { sidebar: "open", density: "compact" }, tags: ["a", "b"] },
  { layout: { density: "cozy", theme: undefined }, tags: ["z"] },
  null,
);

const Swatches = () => (
  <ul>
    {Object.entries(theme.colors.brand).map(([shade, color]) => (
      <li key={shade} style={{ color }}>
        {shade}
      </li>
    ))}
  </ul>
);

export default function LodashMerge() {
  const buttonStyle = isFunction(theme.components.Button.baseStyle)
    ? theme.components.Button.baseStyle({ colorMode: theme.config.initialColorMode })
    : theme.components.Button.baseStyle;
  return (
    <section>
      <Swatches />
      <p>{theme.sizes.join(",")}</p>
      <p>{theme.colors.accent}</p>
      <p>{theme.config.useSystemColorMode ? "system" : theme.config.initialColorMode}</p>
      <button style={buttonStyle}>{Object.keys(buttonStyle).join("+")}</button>
      <p>
        {preferences.layout.sidebar}/{preferences.layout.density}/
        {"theme" in preferences.layout ? "themed" : "unthemed"}
      </p>
      <p>{preferences.tags.join(",")}</p>
    </section>
  );
}

export const isExact = true;
