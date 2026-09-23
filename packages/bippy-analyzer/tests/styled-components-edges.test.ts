import { describe, expect, it } from "vite-plus/test";
import { stubValue } from "../src/evaluate/stubs.js";
import {
  FALSE_VALUE,
  TRUE_VALUE,
  UNDEFINED_VALUE,
  branchValue,
  getObjectProperty,
  isUndefinedValue,
  objectFromRecord,
  objectValue,
  primitiveValue,
  unknownPrimitiveValue,
  unknownValue,
} from "../src/evaluate/values.js";
import { ModuleResolver } from "../src/graph/module-resolver.js";
import { createProjectContext } from "../src/graph/project-context.js";
import { styledComponentsValue } from "../src/libraries/styled-components.js";
import type { ProjectContext, StaticObjectValue, StaticValue, StubRenderTools } from "../src/types.js";
import { createStubTools } from "./helpers/stub-tools.js";

const rootDirectory = "/workspace/packages/bippy-analyzer";

let contextTheme: StaticValue = UNDEFINED_VALUE;

const projectFor = (version: string | null): ProjectContext => {
  const project = createProjectContext({
    rootDirectory,
    resolver: new ModuleResolver({ rootDirectory }),
  });
  project.readPackageVersion = (packageName) =>
    packageName === "styled-components" ? version : null;
  return project;
};

const createTools = (version: string | null): StubRenderTools => {
  const tools = createStubTools(projectFor(version), (callee, args) =>
    callee.kind === "native-function" ? callee.call(args, tools) : unknownValue("stub call"),
  );
  tools.readContext = () => contextTheme;
  return tools;
};

const importStyled = (tools: StubRenderTools, name: string): StaticValue => {
  const value = styledComponentsValue("styled-components", name, { project: tools.project });
  if (value === null) throw new Error(`styled-components has no ${name} export`);
  return value;
};

const readProperty = (tools: StubRenderTools, value: StaticValue, key: string): StaticValue => {
  if (value.kind !== "proxy" || value.handler.kind !== "object") {
    throw new Error(`expected a proxy, received ${value.kind}`);
  }
  const getter = getObjectProperty(value.handler, "get");
  if (getter.kind !== "native-function") throw new Error("proxy get is not callable");
  return getter.call([value, primitiveValue(key)], tools);
};

const callValue = (
  tools: StubRenderTools,
  value: StaticValue,
  args: StaticValue[] = [],
): StaticValue => {
  const target = value.kind === "proxy" ? value.target : value;
  if (target.kind !== "native-function") {
    throw new Error(`expected a function, received ${target.kind}`);
  }
  return target.call(args, tools);
};

const componentStub = (value: StaticValue) => {
  if (value.kind !== "component-reference" || value.type.kind !== "stub") {
    throw new Error(`expected a stub component, received ${value.kind}`);
  }
  return value.type.stub;
};

const renderStub = (
  tools: StubRenderTools,
  value: StaticValue,
  props: StaticObjectValue,
): StaticValue => componentStub(value).render(props, tools);

const expand = (tools: StubRenderTools, value: StaticValue): StaticValue => {
  if (value.kind === "branch" || value.kind !== "element") return value;
  if (value.type.kind === "host") return value;
  if (value.type.kind === "stub") return expand(tools, value.type.stub.render(value.props, tools));
  if (value.type.kind === "context-consumer") {
    const children = getObjectProperty(value.props, "children");
    if (children.kind !== "native-function") return value;
    return expand(tools, children.call([contextTheme], tools));
  }
  if (value.type.kind === "context-provider") {
    return expand(tools, getObjectProperty(value.props, "children"));
  }
  return value;
};

const hostTag = (value: StaticValue): string => {
  if (value.kind !== "element" || value.type.kind !== "host") {
    throw new Error(`expected a host element, received ${value.kind}`);
  }
  return value.type.tagName;
};

const elementProps = (value: StaticValue): StaticObjectValue => {
  if (value.kind !== "element") throw new Error(`expected an element, received ${value.kind}`);
  return value.props;
};

const propKeys = (value: StaticValue): string[] =>
  elementProps(value).entries.flatMap((entry) => (entry.kind === "property" ? [entry.key] : []));

const propsOf = (record: Record<string, StaticValue>): StaticObjectValue => objectFromRecord(record);

const button = stubValue({ displayName: "Button", render: () => primitiveValue(null) });

const styledFactory = (tools: StubRenderTools): StaticValue => importStyled(tools, "default");

const tagFactory = (tools: StubRenderTools, tag: string): StaticValue =>
  readProperty(tools, styledFactory(tools), tag);

const styledTag = (tools: StubRenderTools, tag: string): StaticValue => callValue(tools, tagFactory(tools, tag));

const withConfig = (tools: StubRenderTools, tag: string, config: StaticValue): StaticValue =>
  callValue(tools, callValue(tools, readProperty(tools, tagFactory(tools, tag), "withConfig"), [config]));

const withAttrs = (tools: StubRenderTools, tag: string, attr: StaticValue): StaticValue =>
  callValue(tools, callValue(tools, readProperty(tools, tagFactory(tools, tag), "attrs"), [attr]));

const forwardFilter = (rejected: string): StaticValue =>
  nativeFunction("shouldForwardProp", ([prop]) =>
    primitiveValue(prop?.kind === "primitive" && prop.value !== rejected),
  );

const nativeFunction = (
  name: string,
  call: (args: StaticValue[], tools: StubRenderTools) => StaticValue,
): StaticValue => ({ kind: "native-function", name, call });

describe("styled-components", () => {
  it("shares one v5 factory for the default export, the named export, and an unknown version", () => {
    const tools = createTools("5.3.11");
    const styled = styledFactory(tools);
    expect(importStyled(tools, "styled")).toBe(styled);
    expect(styledFactory(createTools("6.1.0"))).toBe(styled);
    expect(styledFactory(createTools(null))).toBe(styled);
    expect(styledFactory(createTools("4.4.0"))).not.toBe(styled);
    expect(styledComponentsValue("emotion", "default", { project: tools.project })).toBeNull();
    expect(
      styledComponentsValue("styled-components", "ServerStyleSheet", { project: tools.project }),
    ).toBeNull();
    expect(isUndefinedValue(readProperty(tools, tagFactory(tools, "div"), "foo"))).toBe(true);
  });

  it("renders v5 attrs over props, drops transient props, and renames forwardedAs", () => {
    const tools = createTools("5.3.11");
    contextTheme = propsOf({ accent: primitiveValue("tomato") });
    const seenTags: string[] = [];
    const badge = withConfig(
      tools,
      "span",
      propsOf({
        displayName: primitiveValue("Badge"),
        shouldForwardProp: nativeFunction("shouldForwardProp", ([prop, tag]) => {
          if (tag?.kind === "primitive" && typeof tag.value === "string") seenTags.push(tag.value);
          return primitiveValue(prop?.kind === "primitive" && prop.value !== "hidden");
        }),
      }),
    );
    expect(componentStub(badge).displayName).toBe("Badge");
    const rendered = expand(
      tools,
      renderStub(
        tools,
        badge,
        propsOf({
          as: primitiveValue("b"),
          $as: primitiveValue("em"),
          forwardedAs: primitiveValue("a"),
          hidden: TRUE_VALUE,
          id: primitiveValue("badge"),
          $gap: primitiveValue(2),
          ref: primitiveValue("ref"),
        }),
      ),
    );
    expect(hostTag(rendered)).toBe("em");
    expect(propKeys(rendered)).toEqual(["as", "id", "ref", "className"]);
    expect(getObjectProperty(elementProps(rendered), "as")).toEqual(primitiveValue("a"));
    expect(seenTags).toContain("em");
    expect(componentStub(styledTag(tools, "Div")).displayName).toBe("Styled(Div)");
    expect(componentStub(styledTag(tools, "div")).displayName).toBe("styled.div");
    expect(componentStub(callValue(tools, callValue(tools, styledFactory(tools), [button]))).displayName).toBe(
      "Styled(Button)",
    );
  });

  it("lets a v5 attr function read props and keeps a prop whose filter is unknown", () => {
    const tools = createTools("5.0.0");
    contextTheme = UNDEFINED_VALUE;
    const input = withAttrs(
      tools,
      "input",
      nativeFunction("attrs", ([context = UNDEFINED_VALUE]) =>
        objectFromRecord({
          size: primitiveValue(context.kind === "object" ? 8 : 0),
          type: primitiveValue("text"),
        }),
      ),
    );
    const rendered = expand(
      tools,
      renderStub(tools, input, propsOf({ $size: primitiveValue(4), size: primitiveValue(1) })),
    );
    expect(hostTag(rendered)).toBe("input");
    expect(getObjectProperty(elementProps(rendered), "type")).toEqual(primitiveValue("text"));
    expect(getObjectProperty(elementProps(rendered), "size")).toEqual(primitiveValue(8));
    const ignored = withConfig(
      tools,
      "div",
      propsOf({ displayName: primitiveValue(1), shouldForwardProp: primitiveValue("nope") }),
    );
    expect(componentStub(ignored).displayName).toBe("styled.div");
    const kept = expand(
      tools,
      renderStub(
        tools,
        withConfig(
          tools,
          "div",
          propsOf({ shouldForwardProp: nativeFunction("shouldForwardProp", () => unknownValue("filter")) }),
        ),
        objectValue([
          { kind: "spread", value: propsOf({ id: primitiveValue("row"), $secret: primitiveValue("hide") }) },
          { kind: "property", key: "title", value: primitiveValue("row") },
        ]),
      ),
    );
    expect(propKeys(kept)).toEqual(["id", "title", "className"]);
    const spread = expand(
      tools,
      renderStub(tools, styledTag(tools, "div"), objectValue([{ kind: "spread", value: unknownValue("rest") }])),
    );
    expect(spread.kind).toBe("branch");
    expect(componentStub(withConfig(tools, "div", primitiveValue("nope"))).displayName).toBe("styled.div");
    expect(hostTag(expand(tools, renderStub(tools, withAttrs(tools, "div", UNDEFINED_VALUE), propsOf({}))))).toBe(
      "div",
    );
  });

  it("folds a styled target and forwards a prop only when every filter allows it", () => {
    const tools = createTools("5.3.11");
    contextTheme = UNDEFINED_VALUE;
    const base = withConfig(tools, "div", propsOf({ shouldForwardProp: forwardFilter("hidden") }));
    const inherited = callValue(tools, callValue(tools, styledFactory(tools), [base]));
    const inheritedRender = expand(
      tools,
      renderStub(tools, inherited, propsOf({ hidden: TRUE_VALUE, id: primitiveValue("kept") })),
    );
    expect(propKeys(inheritedRender)).toEqual(["id", "className"]);
    const folded = callValue(
      tools,
      callValue(tools, readProperty(tools, callValue(tools, styledFactory(tools), [base]), "withConfig"), [
        propsOf({ shouldForwardProp: forwardFilter("align") }),
      ]),
    );
    const rendered = expand(
      tools,
      renderStub(
        tools,
        folded,
        propsOf({ hidden: TRUE_VALUE, align: primitiveValue("center"), id: primitiveValue("row") }),
      ),
    );
    expect(hostTag(rendered)).toBe("div");
    expect(propKeys(rendered)).toEqual(["id", "className"]);
    const consumer = importStyled(tools, "ThemeConsumer");
    expect(
      componentStub(callValue(tools, callValue(tools, styledFactory(tools), [consumer]))).displayName,
    ).toContain("Styled(");
  });

  it("falls through a falsy as and prefers the context theme over a falsy theme prop", () => {
    const tools = createTools("5.3.11");
    contextTheme = propsOf({ accent: primitiveValue("tomato") });
    const box = withAttrs(
      tools,
      "div",
      nativeFunction("attrs", ([context = UNDEFINED_VALUE]) =>
        objectFromRecord({
          "data-accent":
            context.kind === "object" ? getObjectProperty(context, "theme") : unknownValue("theme"),
        }),
      ),
    );
    const unknownAs = expand(
      tools,
      renderStub(tools, box, propsOf({ as: unknownValue("as"), theme: unknownValue("theme") })),
    );
    expect(unknownAs.kind).toBe("branch");
    if (unknownAs.kind === "branch") expect(unknownAs.preferredIndex).toBe(1);
    const shapedAs = expand(
      tools,
      renderStub(tools, box, propsOf({ as: unknownPrimitiveValue("string", "as") })),
    );
    expect(shapedAs.kind).toBe("branch");
    if (shapedAs.kind === "branch") expect(shapedAs.preferredIndex).toBe(0);
    const falsyAs = expand(tools, renderStub(tools, box, propsOf({ as: FALSE_VALUE, theme: FALSE_VALUE })));
    expect(hostTag(falsyAs)).toBe("div");
    expect(getObjectProperty(elementProps(falsyAs), "data-accent")).toEqual(contextTheme);
    const propTheme = expand(tools, renderStub(tools, box, propsOf({ theme: primitiveValue("red") })));
    expect(getObjectProperty(elementProps(propTheme), "data-accent")).toEqual(primitiveValue("red"));
  });

  it("merges a v5 theme and renders a global style as nothing", () => {
    const tools = createTools("5.3.11");
    contextTheme = propsOf({ accent: primitiveValue("outer") });
    const provider = importStyled(tools, "ThemeProvider");
    contextTheme = UNDEFINED_VALUE;
    expect(renderStub(tools, provider, propsOf({ theme: primitiveValue("inner"), children: FALSE_VALUE }))).toEqual(
      primitiveValue(null),
    );
    const bare = renderStub(
      tools,
      provider,
      propsOf({ theme: primitiveValue("inner"), children: primitiveValue("child") }),
    );
    expect(bare.kind).toBe("element");
    if (bare.kind === "element" && bare.type.kind === "context-provider") {
      expect(getObjectProperty(bare.props, "value")).toEqual(primitiveValue("inner"));
    }
    contextTheme = propsOf({ accent: primitiveValue("outer") });
    const provided = renderStub(
      tools,
      provider,
      propsOf({ theme: primitiveValue("inner"), children: primitiveValue("child") }),
    );
    expect(provided.kind).toBe("element");
    if (provided.kind === "element" && provided.type.kind === "context-provider") {
      expect(getObjectProperty(provided.props, "value").kind).toBe("object");
    }
    const computed = renderStub(
      tools,
      provider,
      propsOf({
        theme: nativeFunction("theme", ([outer = UNDEFINED_VALUE]) => objectFromRecord({ from: outer })),
        children: primitiveValue("child"),
      }),
    );
    expect(computed.kind).toBe("element");
    expect(importStyled(tools, "ThemeContext").kind).toBe("context");
    expect(importStyled(tools, "ThemeConsumer").kind).toBe("component-reference");
    expect(callValue(tools, importStyled(tools, "useTheme"))).toEqual(contextTheme);
    const withTheme = importStyled(tools, "withTheme");
    const themed = callValue(tools, withTheme, [button]);
    expect(componentStub(themed).displayName).toBe("WithTheme(Button)");
    expect(importStyled(tools, "withTheme")).toBe(withTheme);
    expect(renderStub(tools, themed, propsOf({ id: primitiveValue("x") })).kind).toBe("element");
    expect(callValue(tools, importStyled(tools, "css"), [unknownValue("strings")]).kind).toBe("list");
    expect(callValue(tools, importStyled(tools, "keyframes")).kind).toBe("unknown-primitive");
    const globalStyle = callValue(tools, importStyled(tools, "createGlobalStyle"), [unknownValue("strings")]);
    expect(renderStub(tools, globalStyle, propsOf({}))).toEqual(primitiveValue(null));
  });

  it("reads v4 as from props and lets attrs replace the other props", () => {
    const tools = createTools("4.4.1");
    contextTheme = propsOf({ accent: primitiveValue("tomato") });
    const badge = withAttrs(tools, "span", propsOf({ as: primitiveValue("strong"), color: primitiveValue("blue") }));
    const first = renderStub(tools, badge, propsOf({ as: primitiveValue("b"), color: primitiveValue("red") }));
    const second = renderStub(tools, badge, propsOf({ as: primitiveValue("b"), color: primitiveValue("red") }));
    expect(first.kind).toBe("element");
    expect(second.kind).toBe("element");
    if (
      first.kind === "element" &&
      second.kind === "element" &&
      first.type.kind === "stub" &&
      second.type.kind === "stub"
    ) {
      expect(first.type.stub).toBe(second.type.stub);
      expect(first.type.stub.displayName).toBe("StyledComponent");
    }
    const rendered = expand(tools, first);
    expect(hostTag(rendered)).toBe("b");
    expect(getObjectProperty(elementProps(rendered), "color")).toEqual(primitiveValue("blue"));
    const provider = importStyled(tools, "ThemeProvider");
    expect(renderStub(tools, provider, propsOf({ children: UNDEFINED_VALUE }))).toEqual(primitiveValue(null));
    const provided = renderStub(
      tools,
      provider,
      propsOf({
        theme: propsOf({ accent: primitiveValue("inner") }),
        children: primitiveValue("child"),
      }),
    );
    expect(provided.kind).toBe("element");
    if (provided.kind === "element") expect(provided.type.kind).toBe("context-consumer");
    expect(expand(tools, provided).kind).toBe("primitive");
    const wrapped = renderStub(tools, callValue(tools, importStyled(tools, "withTheme"), [button]), propsOf({}));
    expect(wrapped.kind).toBe("element");
    if (wrapped.kind === "element") expect(wrapped.type.kind).toBe("context-consumer");
    expect(expand(tools, wrapped)).toEqual(primitiveValue(null));
    const strings = unknownValue("strings");
    const staticGlobal = callValue(tools, importStyled(tools, "createGlobalStyle"), [
      strings,
      primitiveValue("body"),
    ]);
    expect(expand(tools, renderStub(tools, staticGlobal, propsOf({})))).toEqual(primitiveValue(null));
    const dynamicGlobal = callValue(tools, importStyled(tools, "createGlobalStyle"), [
      strings,
      nativeFunction("interpolation", () => primitiveValue("color")),
    ]);
    expect(expand(tools, renderStub(tools, dynamicGlobal, propsOf({})))).toEqual(primitiveValue(null));
    const uncertainGlobal = callValue(tools, importStyled(tools, "createGlobalStyle"), [
      strings,
      branchValue([primitiveValue("a"), unknownValue("rule")], "interpolation"),
    ]);
    expect(expand(tools, renderStub(tools, uncertainGlobal, propsOf({}))).kind).toBe("branch");
    const unknownInterpolation = callValue(tools, importStyled(tools, "createGlobalStyle"), [
      strings,
      unknownValue("rule"),
    ]);
    expect(expand(tools, renderStub(tools, unknownInterpolation, propsOf({}))).kind).toBe("branch");
  });

  it("lets props win over attrs before styled-components 4.4", () => {
    const tools = createTools("4.3.1");
    contextTheme = UNDEFINED_VALUE;
    const badge = withAttrs(tools, "span", propsOf({ color: primitiveValue("blue") }));
    const rendered = expand(tools, renderStub(tools, badge, propsOf({ color: primitiveValue("red") })));
    expect(hostTag(rendered)).toBe("span");
    expect(getObjectProperty(elementProps(rendered), "color")).toEqual(primitiveValue("red"));
  });
});
