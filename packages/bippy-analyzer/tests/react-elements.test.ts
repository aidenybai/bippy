import { describe, expect, it } from "vite-plus/test";
import { providedContextValue } from "../src/evaluate/react-context.js";
import {
  cloneElement,
  createStaticElement,
  propsFromValue,
} from "../src/evaluate/react-elements.js";
import {
  branchValue,
  getObjectProperty,
  objectFromRecord,
  objectValue,
  primitiveValue,
} from "../src/evaluate/values.js";
import type { ContextDefinition, ElementOwner } from "../src/types.js";
import { createCallbackValue, createEvaluationContext } from "./helpers/evaluation-context.js";

describe("element construction without evaluation state", () => {
  it("gives a config key precedence over the automatic-runtime key", () => {
    const { entries, key } = propsFromValue(
      objectFromRecord({ key: primitiveValue("config"), title: primitiveValue("title") }),
      primitiveValue("argument"),
    );
    expect(key).toEqual(primitiveValue("config"));
    const props = objectValue(entries);
    expect(getObjectProperty(props, "title")).toEqual(primitiveValue("title"));
    expect(getObjectProperty(props, "key")).toEqual(primitiveValue(undefined));
  });

  it("keeps the runtime key when config has none", () => {
    const key = primitiveValue("argument");
    expect(propsFromValue(undefined, key)).toEqual({ entries: [], key });
  });

  it("retains branch alternatives without duplicating props or losing ownership", () => {
    const context = createEvaluationContext();
    const owner: ElementOwner = {
      node: createCallbackValue(context).node,
      scope: context.scope,
      props: objectValue(),
      owner: null,
    };
    const props = objectValue();
    const element = createStaticElement(
      primitiveValue("div"),
      props,
      branchValue([primitiveValue("first"), primitiveValue("second")], "element key"),
      [primitiveValue("child")],
      null,
      null,
      { environment: "server", owner },
    );
    if (element.kind !== "branch") throw new Error("Expected keyed alternatives");
    expect(element.alternatives).toHaveLength(2);
    expect(element.alternatives).toMatchObject([
      { kind: "element", key: primitiveValue("first"), environment: "server" },
      { kind: "element", key: primitiveValue("second"), environment: "server" },
    ]);
    for (const alternative of element.alternatives) {
      if (alternative.kind !== "element") throw new Error("Expected an element alternative");
      expect(alternative.props).toBe(props);
      expect(alternative.owner).toBe(owner);
    }
    expect(props.entries).toEqual([
      { kind: "property", key: "children", value: primitiveValue("child") },
    ]);
  });

  it("clones children and props without mutating the source element", () => {
    const props = objectFromRecord({
      children: primitiveValue("original"),
      title: primitiveValue("before"),
    });
    const original = createStaticElement(
      primitiveValue("div"),
      props,
      primitiveValue("original-key"),
      [],
      null,
      null,
      { environment: "client", owner: null },
    );
    const cloned = cloneElement(
      original,
      objectFromRecord({ title: primitiveValue("after") }),
      [primitiveValue("first"), primitiveValue("second")],
      null,
    );
    if (original.kind !== "element" || cloned.kind !== "element")
      throw new Error("Expected elements");
    expect(cloned).not.toBe(original);
    expect(cloned.props).not.toBe(props);
    expect(cloned.key).toEqual(original.key);
    expect(cloned.environment).toBe("client");
    expect(getObjectProperty(cloned.props, "title")).toEqual(primitiveValue("after"));
    expect(getObjectProperty(cloned.props, "children")).toMatchObject({
      kind: "list",
      items: [primitiveValue("first"), primitiveValue("second")],
    });
    expect(getObjectProperty(props, "children")).toEqual(primitiveValue("original"));
    expect(getObjectProperty(props, "title")).toEqual(primitiveValue("before"));
  });

  it("clones an object-shaped element without requiring interpreter access", () => {
    const cloned = cloneElement(
      objectFromRecord({
        type: primitiveValue("section"),
        key: primitiveValue("key"),
        props: objectFromRecord({ title: primitiveValue("title") }),
      }),
      undefined,
      [],
      null,
    );
    if (cloned.kind !== "element") throw new Error("Expected a cloned element");
    expect(cloned.key).toEqual(primitiveValue("key"));
    expect(getObjectProperty(cloned.props, "title")).toEqual(primitiveValue("title"));
  });
});

describe("provider lookup without an interpreter", () => {
  const definition: ContextDefinition = {
    name: "Theme",
    displayName: null,
    defaultValue: primitiveValue("default"),
    location: null,
  };

  it.each([false, true])(
    "prefers a provider, including falsy values, with outer providers %s",
    (assumeOuterProviders) => {
      const provided = primitiveValue(false);
      expect(providedContextValue(assumeOuterProviders, definition, provided, null)).toBe(provided);
    },
  );

  it("returns the default when no outer provider is assumed", () => {
    expect(providedContextValue(false, definition, null, null)).toBe(definition.defaultValue);
  });

  it("retains the default and the unknown outer-provider alternative", () => {
    expect(providedContextValue(true, definition, null, null)).toMatchObject({
      kind: "branch",
      alternatives: [
        definition.defaultValue,
        { kind: "unknown", reason: "Theme provided outside the analyzed tree" },
      ],
      reason: "no provider for Theme",
    });
  });
});
