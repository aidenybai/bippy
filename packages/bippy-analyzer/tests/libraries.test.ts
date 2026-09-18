import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { formatPattern, getRenderPattern } from "../src/harness/index.js";
import { createStaticRenderer } from "../src/index.js";
import { isPurePackage } from "../src/libraries/pure-packages.js";

const LINARIA_SOURCE = `
import { styled } from "@linaria/react";
import { css } from "@linaria/core";

const Card = styled.section\`
  padding: 8px;
\`;

const Box = styled.div<{ gap?: number }>\`
  gap: \${(props) => props.gap ?? 0}px;
\`;

const Row = styled(Box)\`
  display: flex;
\`;

const emphasis = css\`
  font-style: italic;
\`;

export default () => (
  <Card>
    <Row gap={4}>
      <Box as="span" className={emphasis}>left</Box>
    </Row>
  </Card>
);
`;

const AXIOS_SOURCE = `
import axios from "axios";
import { useEffect, useState } from "react";

interface Item {
  id: string;
}

const api = axios.create({ baseURL: "https://example.test", timeout: 500 });
api.interceptors.request.use((config) => {
  config.headers.Authorization = "Bearer token";
  return config;
});
api.interceptors.response.use(
  (response) => response.data,
  (error) => Promise.reject(error),
);

export default function Items() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [hasFailed, setHasFailed] = useState(false);
  useEffect(() => {
    api
      .get<Item[]>("/items")
      .then((loaded) => setItems(loaded))
      .catch(() => setHasFailed(true));
  }, []);
  if (hasFailed) return <p>failed</p>;
  if (!items?.length) return <p>loading</p>;
  return (
    <ul>
      {items.map((item) => (
        <li key={item.id}>
          <span>item</span>
        </li>
      ))}
    </ul>
  );
}
`;

const AXIOS_ASYNC_SOURCE = `
import axios from "axios";
import { useEffect, useState } from "react";

const Loading = () => <p>loading</p>;
const Failed = () => <p>failed</p>;
const Ready = () => <p>ready</p>;

const Status = () => {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const check = async () => {
      try {
        await axios.get("/status");
      } catch {
        setError("failed");
      } finally {
        setIsLoading(false);
      }
    };
    check();
  }, []);
  if (isLoading) return <Loading />;
  if (error) return <Failed />;
  return <Ready />;
};

export default Status;
`;

const OPAQUE_RENDER_PROP_SOURCE = `
import { Highlight } from "prism-react-renderer";

export default () => (
  <section>
    <Highlight code={"const count = 1;\\ncount++;"} language="tsx">
      {({ className, style, tokens, getLineProps, getTokenProps }) => (
        <pre className={className} style={style}>
          {tokens.map((line, lineIndex) => (
            <div {...getLineProps({ line })} key={lineIndex}>
              {line.map((token, tokenIndex) => (
                <span {...getTokenProps({ token })} key={tokenIndex} />
              ))}
            </div>
          ))}
        </pre>
      )}
    </Highlight>
  </section>
);
`;

const ZUSTAND_SOURCE = `
import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import { useShallow } from "zustand/shallow";
import { useEffect } from "react";

interface CounterState {
  count: number;
  label: string;
  increment: () => void;
}

const useCounter = create<CounterState>()(
  subscribeWithSelector((set) => ({
    count: 2,
    label: "ready",
    increment: () => set((state) => ({ count: state.count + 1 })),
  })),
);

useCounter.getState().increment();

export default () => {
  const selection = useCounter(
    useShallow((state) => ({ count: state.count, label: state.label })),
  );
  useEffect(() => useCounter.getState().increment(), []);
  return <main>{selection.label}<strong />{selection.count}<span /></main>;
};
`;

const ZUSTAND_MIDDLEWARE_SOURCE = `
import { create } from "zustand";
import { redux } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";

const useImmerStore = create(
  immer((set) => ({
    count: 1,
    increment: () => set((state) => {
      state.count += 1;
    }),
  })),
);
useImmerStore.getState().increment();

const useReduxStore = create(
  redux((state, action) => ({ count: state.count + action.amount }), { count: 3 }),
);
useReduxStore.getState().dispatch({ type: "increment", amount: 2 });

export default () => (
  <main>
    {useImmerStore.getState().count}
    <strong />
    {useReduxStore.getState().count}
    <span />
  </main>
);
`;

const AUTO_IMPORT_PROJECT: Record<string, string> = {
  "vite.config.ts": `
import autoImport from "unplugin-auto-import/vite";
export default {
  plugins: [autoImport({ imports: ["react"], dirs: ["src/hooks", "src/components/**"] })],
};
`,
  "src/hooks/use-counter.ts": "export const useCounter = () => useState(2);\n",
  "src/components/Badge/index.tsx": `
export default function Badge({ count }: { count: number }) {
  return count === 2 ? <b>{count}</b> : <i>{count}</i>;
}
`,
  "src/components/status-pill.tsx":
    "export default (count: number) => (count > 1 ? 'many' : 'one');\n",
  "src/app.tsx": `
export default function App() {
  const [count] = useCounter();
  const label = useMemo(() => statusPill(count), [count]);
  return (
    <section>
      <Badge count={count} />
      {label === "many" ? <p>{label}</p> : <em>{label}</em>}
    </section>
  );
}
`,
};

const PURE_CLASS_INSTANCE_PROJECT: Record<string, string> = {
  "node_modules/values.js/package.json": JSON.stringify({
    name: "values.js",
    version: "2.0.0",
    main: "index.cjs",
  }),
  "node_modules/values.js/index.cjs": `
class Color {
  constructor(rgb, weight) {
    this.rgb = rgb;
    this.weight = weight;
  }

  get hex() {
    return "4747a4";
  }
}

class Values {
  all() {
    return [new Color([71, 71, 164], 100)];
  }
}

module.exports = Values;
`,
  "app.tsx": `
import Values from "values.js";

interface SwatchProps {
  hexColor: string;
  weight: number;
}

const Swatch = ({ hexColor, weight }: SwatchProps) => <p>{weight}% {hexColor}</p>;
const colors = new Values("#4747a4").all(10);

export default () => (
  <section>
    {colors.map((color) => (
      <Swatch {...color} hexColor={color.hex} />
    ))}
  </section>
);
`,
};

const STYLETRON_PROJECT: Record<string, string> = {
  "node_modules/styletron-react/package.json": JSON.stringify({
    name: "styletron-react",
    version: "6.1.0",
    main: "index.js",
  }),
  "node_modules/styletron-react/index.js": "exports.createStyled = () => null;\n",
  "app.tsx": `
import { createContext, forwardRef } from "react";
import { createStyled } from "styletron-react";

const ThemeContext = createContext({});
const wrapper = (StyledComponent) =>
  forwardRef((props, ref) => (
    <ThemeContext.Consumer>
      {(theme) => <StyledComponent {...props} ref={ref} $theme={theme} />}
    </ThemeContext.Consumer>
  ));
const styled = createStyled({ wrapper });
const Icon = styled("svg", {});
Icon.displayName = "Icon";

export default () => (
  <Icon viewBox="0 0 24 24">
    <path />
  </Icon>
);
`,
};

const renderProject = async (
  files: Record<string, string>,
  entryFileName: string,
): Promise<string> => {
  const rootDirectory = mkdtempSync(join(tmpdir(), "bippy-parser-library-"));
  for (const [fileName, source] of Object.entries(files)) {
    const filePath = join(rootDirectory, fileName);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, source);
  }
  const renderer = await createStaticRenderer({ rootDirectory });
  const result = await renderer.renderComponent(join(rootDirectory, entryFileName), {
    exportName: "default",
  });
  expect(result.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  expect(result.stats.unknownCount).toBe(0);
  return formatPattern(getRenderPattern(result)).replaceAll(`${rootDirectory}/`, "");
};

const renderSource = (source: string): Promise<string> =>
  renderProject({ "app.tsx": source }, "app.tsx");

describe("library models", () => {
  it("binds the free identifiers unplugin-auto-import injects imports for", async () => {
    expect(await renderProject(AUTO_IMPORT_PROJECT, "src/app.tsx")).toBe(
      ["<HostRoot>", "  <App>", "    <section>", "      <Badge>", "        <b>", "      <p>"].join(
        "\n",
      ),
    );
  });

  it("names Linaria's template-form styled components after their binding as wyw-in-js does", async () => {
    expect(await renderSource(LINARIA_SOURCE)).toBe(
      [
        "<HostRoot>",
        "  <default>",
        "    <Card>",
        "      <section>",
        "        <Row>",
        "          <Box>",
        "            <div>",
        "              <Box>",
        "                <span>",
      ].join("\n"),
    );
  });

  it("treats lodash's per-method packages like the matching lodash export", () => {
    expect(isPurePackage("lodash.mergewith")).toBe(true);
    expect(isPurePackage("lodash.isequal")).toBe(true);
    expect(isPurePackage("lodash.debounce")).toBe(false);
    expect(isPurePackage("lodash.uniqueid")).toBe(false);
    expect(isPurePackage("lodash-webpack-plugin")).toBe(false);
  });

  it("preserves enumerable fields from pure package class instances", async () => {
    expect(await renderProject(PURE_CLASS_INSTANCE_PROJECT, "app.tsx")).toBe(
      [
        "<HostRoot>",
        "  <default>",
        "    <section>",
        "      <Swatch>",
        "        <p>",
        '          "100"',
        '          "% "',
        '          "4747a4"',
      ].join("\n"),
    );
  });

  it("preserves Styletron wrapper fibers and forwarded children", async () => {
    expect(await renderProject(STYLETRON_PROJECT, "app.tsx")).toBe(
      [
        "<HostRoot>",
        "  <default>",
        "    <Icon>",
        "      <ContextConsumer>",
        "        <ForwardRef>",
        "          <svg>",
        "            <path>",
      ].join("\n"),
    );
  });

  it("keeps an Axios response pending so the request's outcomes stay enumerated", async () => {
    expect(await renderSource(AXIOS_SOURCE)).toBe(
      [
        "<HostRoot>",
        "  <Items>",
        "    ?branch(if (branch(false | true))) @ app.tsx:28:3",
        "      |0",
        "        <p>",
        "      |1 (preferred)",
        "        <p>",
        "      |2",
        "        <ul>",
        "          *repeat(0..) @ app.tsx:32:8",
        "            <li>",
        "              <span>",
      ].join("\n"),
    );
  });

  it("enumerates fulfillment and rejection through async try/catch/finally", async () => {
    const tree = await renderSource(AXIOS_ASYNC_SOURCE);
    expect(tree).toContain("<Loading>");
    expect(tree).toContain("<Failed>");
    expect(tree).toContain("<Ready>");
  });

  it("tokenizes Prism source without evaluating bundled grammar initialization", async () => {
    expect(await renderSource(OPAQUE_RENDER_PROP_SOURCE)).toBe(
      [
        "<HostRoot>",
        "  <default>",
        "    <section>",
        "      <Highlight2>",
        "        <Highlight>",
        "          <pre>",
        '            <div> key="0"',
        '              <span> key="0"',
        '              <span> key="1"',
        '              <span> key="2"',
        '              <span> key="3"',
        '              <span> key="4"',
        '              <span> key="5"',
        '              <span> key="6"',
        '            <div> key="1"',
        '              <span> key="0"',
        '              <span> key="1"',
        '              <span> key="2"',
      ].join("\n"),
    );
  });

  it("reads concrete initial and updated state from Zustand stores", async () => {
    expect(await renderSource(ZUSTAND_SOURCE)).toBe(
      [
        "<HostRoot>",
        "  <default>",
        "    <main>",
        '      "ready"',
        "      <strong>",
        '      "4"',
        "      <span>",
      ].join("\n"),
    );
  });

  it("applies Zustand Immer and Redux middleware updates", async () => {
    expect(await renderSource(ZUSTAND_MIDDLEWARE_SOURCE)).toBe(
      [
        "<HostRoot>",
        "  <default>",
        "    <main>",
        '      "2"',
        "      <strong>",
        '      "5"',
        "      <span>",
      ].join("\n"),
    );
  });
});
