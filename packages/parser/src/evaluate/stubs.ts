import { NULL_VALUE, UNDEFINED_VALUE, getObjectProperty, objectFromRecord } from "./values.js";
import type {
  StaticElementType,
  StaticElementValue,
  StaticObjectValue,
  StaticValue,
  StubComponent,
  StubRenderTools,
} from "../types.js";

// Building blocks for framework models: values a framework's package exports
// resolve to so the static side can stand in for code it does not analyze.

export const element = (
  type: StaticElementType,
  props: StaticObjectValue,
  key: StaticValue | null = null,
): StaticElementValue => ({
  kind: "element",
  type,
  key,
  props,
  location: null,
  environment: null,
  owner: null,
});

export const hostElement = (
  tagName: string,
  props: Record<string, StaticValue>,
): StaticElementValue => element({ kind: "host", tagName }, objectFromRecord(props));

export const stubValue = (stub: StubComponent): StaticValue => ({
  kind: "component-reference",
  type: { kind: "stub", stub },
});

export const stubElement = (
  stub: StubComponent,
  props: Record<string, StaticValue>,
): StaticElementValue => element({ kind: "stub", stub }, objectFromRecord(props));

export const nativeFunction = (
  name: string,
  call: (args: StaticValue[], tools: StubRenderTools) => StaticValue,
): StaticValue => ({ kind: "native-function", name, call });

export const noopFunction = (name: string): StaticValue =>
  nativeFunction(name, () => UNDEFINED_VALUE);

/** `target` with properties computed on access (a store's `values`), as `new Proxy(target, { get })` would. */
export const lazyProperties = (
  target: StaticValue,
  getProperty: (key: string, tools: StubRenderTools) => StaticValue,
): StaticValue => ({
  kind: "proxy",
  target,
  handler: objectFromRecord({
    get: nativeFunction("get", ([, key], tools) =>
      key?.kind === "primitive" && typeof key.value === "string"
        ? getProperty(key.value, tools)
        : UNDEFINED_VALUE,
    ),
  }),
});

/** A component that renders exactly its children (context/state wrappers with no host output). */
export const passthroughStub = (displayName: string): StubComponent => ({
  displayName,
  render: (props) => getObjectProperty(props, "children"),
});

/** A component that renders nothing (effects, portals to `<head>`, metadata). */
export const emptyStub = (displayName: string): StubComponent => ({
  displayName,
  render: () => NULL_VALUE,
});

/** Copies `props` minus the framework-only keys the component consumes itself. */
export const omitProps = (
  props: StaticObjectValue,
  omitted: ReadonlySet<string>,
): StaticObjectValue => ({
  kind: "object",
  entries: props.entries.filter((entry) => entry.kind !== "property" || !omitted.has(entry.key)),
});
