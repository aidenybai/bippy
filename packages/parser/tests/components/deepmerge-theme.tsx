import deepmerge, { type Options } from "deepmerge";

interface Theme {
  button: { defaultProps: { color: string; ripple: boolean }; sizes: string[] };
  card: { shadow: boolean; radius?: string };
  breakpoints: number[];
  createdAt: Date;
  pattern: RegExp;
}

const defaultTheme: Theme = {
  button: { defaultProps: { color: "blue", ripple: true }, sizes: ["sm", "md"] },
  card: { shadow: true },
  breakpoints: [640, 768],
  createdAt: new Date(0),
  pattern: /default/,
};

/** Material Tailwind's `combineMerge`: merge by index, append unseen items. */
const combineMerge = (target: object[], source: object[], options: Options): object[] => {
  const destination = target.slice();
  source.forEach((item, index) => {
    if (typeof destination[index] === "undefined") {
      destination[index] = options.cloneUnlessOtherwiseSpecified(item, options);
    } else if (options.isMergeableObject(item)) {
      destination[index] = deepmerge(target[index], item, options);
    } else if (target.indexOf(item) === -1) {
      destination.push(item);
    }
  });
  return destination;
};

const override = {
  button: { defaultProps: { color: "red" }, sizes: ["lg", "sm"] },
  card: { radius: "xl" },
  breakpoints: [1024],
  createdAt: new Date(86_400_000),
  pattern: /override/i,
};

const combined = deepmerge(defaultTheme, override, { arrayMerge: combineMerge });
const concatenated = deepmerge(defaultTheme, override);
const overwritten = deepmerge(defaultTheme, override, {
  arrayMerge: (_target, source) => source,
});
const customized = deepmerge(defaultTheme, override, {
  customMerge: (key) => (key === "button" ? (_target, source) => source : undefined),
});
const everything = deepmerge.all<Theme>([defaultTheme, override, { card: { shadow: false } }]);
const shared = deepmerge({ nested: defaultTheme.card }, { other: 1 }, { clone: false });
const replaced = deepmerge<{ list: unknown }>({ list: [1, 2] }, { list: { first: 1 } });
const mergesLists = deepmerge(defaultTheme.breakpoints, override.breakpoints);

const describe = (theme: Theme): string =>
  [
    theme.button.defaultProps.color,
    String(theme.button.defaultProps.ripple),
    theme.button.sizes.join("+"),
    String(theme.card.shadow),
    theme.card.radius ?? "none",
    theme.breakpoints.join("+"),
    String(theme.createdAt.getTime()),
    String(theme.pattern),
  ].join(" ");

export default function DeepmergeTheme() {
  return (
    <dl>
      <dt>combined</dt>
      <dd>{describe(combined)}</dd>
      <dt>concatenated</dt>
      <dd>{describe(concatenated)}</dd>
      <dt>overwritten</dt>
      <dd>{describe(overwritten)}</dd>
      <dt>customized</dt>
      <dd>{describe(customized)}</dd>
      <dt>everything</dt>
      <dd>{describe(everything)}</dd>
      <dt>identity</dt>
      <dd>
        {String(shared.nested === defaultTheme.card)} {String(combined.card === defaultTheme.card)}{" "}
        {String(combined.createdAt === override.createdAt)}
      </dd>
      <dt>replaced</dt>
      <dd>{JSON.stringify(replaced)}</dd>
      <dt>lists</dt>
      <dd>{mergesLists.join("+")}</dd>
    </dl>
  );
}

export const isExact = true;
