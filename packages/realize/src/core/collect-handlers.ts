import { GeneratedSource, makeInstructionId } from "../react-compiler/HIR/HIR";
import type { HIRFunction, SourceLocation } from "../react-compiler/HIR/HIR";
import type { Interpreter } from "./interpret";
import type { CollectedEffects } from "./effect-collector";
import type {
  ObjectExpressionValue,
  Binding,
  Handler,
  HandlerTrigger,
  JsxExpressionValue,
  JsxProp,
  JsxSpreadProp,
  JsxTag,
  StateUpdate,
  SymbolicValue,
} from "./types";
import { forEachJsxElement } from "./utils/for-each-jsx-element";
import { forEachSymbolicValue } from "./utils/for-each-symbolic-value";
import { mapSymbolicValue } from "./utils/map-symbolic-value";
import { isExternalSource } from "./utils/is-external-source";
import { getValueKey } from "./utils/get-value-key";
import { getLocationKey } from "./utils/get-location-key";
import {
  UNDEFINED_VALUE,
  createBindingValue,
  createUnknown,
  foldUnary,
  getPassedCallbacks,
} from "./symbolic-values";
import { getRenderGuards, intersectGuards } from "./utils/get-render-guards";
import { isStateBinding } from "./utils/is-state-binding";

const EVENT_HANDLER_PATTERN = /^on[A-Z]/;
const CAPTURE_SUFFIX = "Capture";
const NON_BUBBLING_EVENTS = new Set([
  "onScroll",
  "onMouseEnter",
  "onMouseLeave",
  "onPointerEnter",
  "onPointerLeave",
  "onLoad",
  "onError",
]);
const FORM_ACTION_PROPS = new Map([
  ["form", "action"],
  ["button", "formAction"],
  ["input", "formAction"],
]);
const FORM_ACTION_EVENTS = new Map([
  ["action", "submit"],
  ["formAction", "click"],
]);

export const ANY_EVENT = "*";

export const EVENT_ARGUMENT: SymbolicValue = {
  kind: "Unknown",
  reason: "event",
  loc: GeneratedSource,
};

export const isEffectHandler = (handler: Handler): boolean => handler.trigger.kind === "Effect";

export const isRenderHandler = (handler: Handler): boolean => handler.trigger.kind === "Render";

export const getBindingUpdates = (handlers: Handler[], binding: Binding): StateUpdate[] =>
  handlers
    .flatMap((handler) => handler.updates)
    .filter((update) => update.binding.id === binding.id);

const isFormActionProp = (tag: JsxTag, prop: JsxProp): boolean =>
  tag.kind === "BuiltinTag" && FORM_ACTION_PROPS.get(tag.name) === prop.name;

export const isHandlerProp = (tag: JsxTag, prop: JsxProp): boolean =>
  EVENT_HANDLER_PATTERN.test(prop.name) ||
  isFormActionProp(tag, prop) ||
  (tag.kind !== "BuiltinTag" && getPassedCallbacks([prop.value]).length > 0);

const getTriggerEvent = (prop: JsxProp): string => FORM_ACTION_EVENTS.get(prop.name) ?? prop.name;

const isCallable = (value: SymbolicValue): boolean =>
  value.kind === "Setter" ||
  value.kind === "Dispatch" ||
  value.kind === "Function" ||
  value.kind === "Bound";

const isRefCallback = (prop: JsxProp): boolean => prop.name === "ref" && isCallable(prop.value);

const getSpreadProperty = (spread: ObjectExpressionValue | null, key: string): SymbolicValue =>
  spread?.properties.find((property) => property.key === key)?.value ?? UNDEFINED_VALUE;

const getSpreadHandlers = (
  tag: JsxTag,
  prop: JsxSpreadProp,
  value: SymbolicValue = prop.value,
): ObjectExpressionValue | null => {
  if (value.kind === "Conditional") {
    const consequent = getSpreadHandlers(tag, prop, value.consequent);
    const alternate = getSpreadHandlers(tag, prop, value.alternate);
    if (!consequent && !alternate) return null;
    const keys = new Set(
      [...(consequent?.properties ?? []), ...(alternate?.properties ?? [])].map(
        (property) => property.key,
      ),
    );
    return {
      kind: "ObjectExpression",
      properties: [...keys].map((key) => ({
        key,
        value: {
          ...value,
          consequent: getSpreadProperty(consequent, key),
          alternate: getSpreadProperty(alternate, key),
        },
      })),
      spreads: [],
    };
  }
  if (value.kind !== "ObjectExpression") return null;
  const properties = value.properties.filter((property) =>
    isHandlerProp(tag, {
      kind: "JsxAttribute",
      name: property.key,
      value: property.value,
      handlerId: null,
      loc: prop.loc,
      file: prop.file,
    }),
  );
  return properties.length > 0 ? { kind: "ObjectExpression", properties, spreads: [] } : null;
};

const chooseSpreadHandler = (
  handlers: ObjectExpressionValue,
  loc: SourceLocation,
  file: string,
): SymbolicValue => {
  const [last, ...earlier] = [...handlers.properties].reverse();
  if (!last) return UNDEFINED_VALUE;
  return earlier.reduce<SymbolicValue>(
    (alternate, property, caseIndex) => ({
      kind: "Conditional",
      test: createUnknown(`spread-event ${property.key}`, loc, {
        kind: "Name",
        name: property.key,
      }),
      testKind: "truthy",
      consequent: property.value,
      alternate,
      branch: { terminalId: makeInstructionId(0), probe: "none", loc, file, caseIndex },
      guardKeys: [],
    }),
    last.value,
  );
};

const getHandlerKey = (value: SymbolicValue): string | null => {
  switch (value.kind) {
    case "Function":
      return `function:${value.functionId}`;
    case "Setter":
      return `setter:${value.binding.id}`;
    case "Dispatch":
      return `dispatch:${value.binding.id}`;
    case "Bound": {
      const calleeKey = getHandlerKey(value.callee);
      return calleeKey === null
        ? null
        : `bound:${calleeKey}:${value.argumentValues.map(getValueKey).join(",")}`;
    }
    case "ArrayExpression":
      return `array:${value.elements.map(getHandlerKey).join(",")}`;
    case "ObjectExpression":
      return `object:${value.properties
        .map((property) => `${property.key}=${getHandlerKey(property.value)}`)
        .join(",")}`;
    case "Binding":
      return value.binding.kind === "prop" ||
        value.binding.kind === "ref" ||
        isStateBinding(value.binding) ||
        isExternalSource(value.binding)
        ? `binding:${value.binding.id}:${value.path.join(".")}`
        : null;
    case "Conditional": {
      const consequentKey = getHandlerKey(value.consequent);
      const alternateKey = getHandlerKey(value.alternate);
      return consequentKey === null && alternateKey === null
        ? null
        : `conditional:${getValueKey(value.test)}?${consequentKey}:${alternateKey}`;
    }
    case "Unknown":
    case "Global":
      return `opaque:${getValueKey(value)}`;
    default:
      return null;
  }
};

const getHandlerLocation = (value: SymbolicValue): SourceLocation => {
  if (value.kind === "Function" || value.kind === "Bound") return value.loc;
  if (value.kind === "Setter" || value.kind === "Dispatch" || value.kind === "Binding")
    return value.binding.loc;
  if (value.kind === "Conditional") {
    const consequentLocation = getHandlerLocation(value.consequent);
    return consequentLocation === GeneratedSource
      ? getHandlerLocation(value.alternate)
      : consequentLocation;
  }
  return GeneratedSource;
};

const ENABLEABLE_TAGS = new Set(["button", "input", "select", "textarea"]);

const getEnabledGuards = (element: JsxExpressionValue): SymbolicValue[] => {
  if (element.tag.kind !== "BuiltinTag" || !ENABLEABLE_TAGS.has(element.tag.name)) return [];
  const disabled = element.props.find(
    (prop): prop is JsxProp => prop.kind === "JsxAttribute" && prop.name === "disabled",
  );
  return disabled ? [foldUnary("!", disabled.value)] : [];
};

const getAttribute = (element: JsxExpressionValue, name: string): JsxProp | undefined =>
  element.props.find((prop): prop is JsxProp => prop.kind === "JsxAttribute" && prop.name === name);

const CHECKABLE_TYPES = new Set(["checkbox", "radio"]);

const CHECK_EVENTS = new Set(["onChange", "onClick", "onInput"]);

interface ControlEvent {
  argument: SymbolicValue;
  guards: SymbolicValue[];
}

const getControlEvent = (element: JsxExpressionValue, prop: JsxProp): ControlEvent | null => {
  if (element.tag.kind !== "BuiltinTag" || element.tag.name !== "input") return null;
  const type = getAttribute(element, "type")?.value;
  const isCheckable =
    type?.kind === "Primitive" && typeof type.value === "string" && CHECKABLE_TYPES.has(type.value);
  if (!isCheckable || !CHECK_EVENTS.has(prop.name)) return null;
  const isRadio = type.value === "radio";
  const checked = getAttribute(element, "checked")?.value;
  const value = getAttribute(element, "value")?.value ?? { kind: "Primitive", value: "on" };
  const nextChecked: SymbolicValue | null = checked
    ? isRadio
      ? { kind: "Primitive", value: true }
      : foldUnary("!", checked)
    : null;
  const target: SymbolicValue = {
    kind: "ObjectExpression",
    properties: [
      { key: "value", value },
      ...(nextChecked ? [{ key: "checked", value: nextChecked }] : []),
    ],
    spreads: [createUnknown("event", GeneratedSource)],
  };
  return {
    argument: createTargetEvent(target),
    guards: isRadio && checked ? [foldUnary("!", checked)] : [],
  };
};

const isBlankText = (child: SymbolicValue): boolean =>
  child.kind === "Primitive" && (typeof child.value !== "string" || child.value.trim() === "");

const getOptionValue = (child: SymbolicValue): string | null => {
  if (child.kind !== "JsxExpression" || child.tag.kind !== "BuiltinTag") return null;
  if (child.tag.name !== "option") return null;
  const value = getAttribute(child, "value")?.value;
  const [text] = child.children;
  const shown = value ?? (child.children.length === 1 ? text : undefined);
  return shown?.kind === "Primitive" && shown.value !== null && shown.value !== undefined
    ? String(shown.value)
    : null;
};

const getOptionValues = (select: JsxExpressionValue): string[] | null => {
  const values = select.children.filter((child) => !isBlankText(child)).map(getOptionValue);
  return values.length > 0 && values.every((value) => value !== null) ? values : null;
};

const createTargetEvent = (target: SymbolicValue): SymbolicValue => ({
  kind: "ObjectExpression",
  properties: [
    { key: "target", value: target },
    { key: "currentTarget", value: target },
  ],
  spreads: [EVENT_ARGUMENT],
});

const SUBMIT_TYPES = new Set(["submit", "image"]);

const isSubmitControl = (element: JsxExpressionValue): boolean => {
  if (element.tag.kind !== "BuiltinTag") return false;
  const typeProp = element.props.find(
    (prop): prop is JsxProp => prop.kind === "JsxAttribute" && prop.name === "type",
  );
  const type = typeProp?.value.kind === "Primitive" ? typeProp.value.value : undefined;
  if (element.tag.name === "button")
    return typeProp === undefined || (typeof type === "string" && SUBMIT_TYPES.has(type));
  return element.tag.name === "input" && typeof type === "string" && SUBMIT_TYPES.has(type);
};

const getValueKeys = (values: SymbolicValue[]): string => values.map(getValueKey).join(",");

const getHandlerContentKey = (handler: Handler): string =>
  JSON.stringify([
    handler.trigger,
    getLocationKey(handler.loc),
    getValueKeys(handler.guards),
    handler.delegates,
    handler.updates.map((update) => [
      update.binding.id,
      getValueKey(update.value),
      getValueKeys(update.guards),
      update.isAsync,
    ]),
    handler.claims.map((claim) => [
      claim.kind,
      getValueKey(claim.subject),
      claim.cases,
      claim.test && getValueKey(claim.test),
      getValueKeys(claim.guards),
      claim.description,
      getLocationKey(claim.loc),
    ]),
  ]);

interface PlannedHandler {
  trigger: HandlerTrigger;
  callback: SymbolicValue;
  callbackArguments: SymbolicValue[];
  loc: SourceLocation;
  guards: SymbolicValue[];
  callbackGuards?: SymbolicValue[];
  props: Array<JsxProp | JsxSpreadProp>;
}

class HandlerCollector {
  readonly handlers: Handler[] = [];
  readonly pendingMutations = new Map<number, Binding>();
  readonly #interpreter: Interpreter;
  readonly #plannedByKey = new Map<string | JsxSpreadProp, PlannedHandler>();
  readonly #idsByContent = new Map<string, string>();

  constructor(interpreter: Interpreter) {
    this.#interpreter = interpreter;
  }

  addHandler(
    trigger: HandlerTrigger,
    callback: SymbolicValue,
    callbackArguments: SymbolicValue[],
    loc: SourceLocation,
    guards: SymbolicValue[] = [],
    callbackGuards: SymbolicValue[] = [],
  ): string | null {
    const runsCleanup =
      trigger.kind === "Effect" && trigger.hookKind !== "Custom" && trigger.dependencies !== "[]";
    return this.addCollectedHandler(
      trigger,
      this.#interpreter.collectEffects(
        callback,
        callbackArguments,
        guards,
        callbackGuards,
        runsCleanup,
      ),
      loc,
      guards,
    );
  }

  addCollectedHandler(
    trigger: HandlerTrigger,
    { updates, delegates, pendingMutations, claims }: CollectedEffects,
    loc: SourceLocation,
    guards: SymbolicValue[] = [],
  ): string | null {
    for (const binding of pendingMutations) this.pendingMutations.set(binding.id, binding);
    if (updates.length === 0 && delegates.length === 0 && claims.length === 0) return null;
    const handler: Handler = {
      id: `t${this.handlers.length + 1}`,
      trigger,
      updates,
      delegates,
      claims,
      guards,
      loc,
    };
    const contentKey = getHandlerContentKey(handler);
    const sameHandlerId = this.#idsByContent.get(contentKey);
    if (sameHandlerId) return sameHandlerId;
    this.#idsByContent.set(contentKey, handler.id);
    this.handlers.push(handler);
    return handler.id;
  }

  planElementHandlers(
    element: JsxExpressionValue,
    renderGuards: SymbolicValue[],
    ancestors: JsxExpressionValue[],
  ): void {
    const eventGuards = [...renderGuards, ...getEnabledGuards(element)];
    for (const prop of element.props) {
      if (prop.kind === "JsxSpreadAttribute") this.#planSpreadHandlers(element, prop, eventGuards);
      else if (isRefCallback(prop)) this.#planRefCallback(prop, renderGuards);
      else if (isHandlerProp(element.tag, prop))
        this.#planEventHandler(element, prop, eventGuards, ancestors);
    }
  }

  get plannedCallbacks(): SymbolicValue[] {
    return [...this.#plannedByKey.values()].map((planned) => planned.callback);
  }

  runPlannedHandlers(): void {
    for (const planned of this.#plannedByKey.values()) {
      const handlerId = this.addHandler(
        planned.trigger,
        planned.callback,
        planned.callbackArguments,
        planned.loc,
        planned.guards,
        planned.callbackGuards,
      );
      for (const prop of planned.props) prop.handlerId = handlerId;
    }
  }

  #plan(key: string | JsxSpreadProp, handler: PlannedHandler): void {
    const planned = this.#plannedByKey.get(key);
    if (!planned) {
      this.#plannedByKey.set(key, handler);
      return;
    }
    planned.guards = intersectGuards(planned.guards, handler.guards);
    planned.props.push(...handler.props);
  }

  #planSpreadHandlers(
    element: JsxExpressionValue,
    prop: JsxSpreadProp,
    guards: SymbolicValue[],
  ): void {
    const trigger: HandlerTrigger = { kind: "Event", tag: element.tag.name, event: ANY_EVENT };
    if (prop.value.kind === "Unknown") {
      this.#plan(prop, {
        trigger,
        callback: prop.value,
        callbackArguments: [],
        loc: prop.value.loc,
        guards,
        props: [prop],
      });
      return;
    }
    const spreadHandlers = getSpreadHandlers(element.tag, prop);
    const spreadHandlerKey = spreadHandlers && getHandlerKey(spreadHandlers);
    if (spreadHandlers && spreadHandlerKey)
      this.#plan(spreadHandlerKey, {
        trigger,
        callback: chooseSpreadHandler(spreadHandlers, element.loc, prop.file),
        callbackArguments: [EVENT_ARGUMENT],
        loc: element.loc,
        guards,
        props: [prop],
      });
  }

  #planRefCallback(prop: JsxProp, guards: SymbolicValue[]): void {
    const refCallbackKey = getHandlerKey(prop.value);
    if (refCallbackKey === null) return;
    this.#plan(`ref:${refCallbackKey}`, {
      trigger: {
        kind: "Effect",
        hookKind: "useLayoutEffect",
        dependencies: null,
        dependencyPlaces: null,
      },
      callback: prop.value,
      callbackArguments: [EVENT_ARGUMENT],
      loc: getHandlerLocation(prop.value),
      guards,
      props: [],
    });
  }

  #planEventHandler(
    element: JsxExpressionValue,
    prop: JsxProp,
    guards: SymbolicValue[],
    ancestors: JsxExpressionValue[],
  ): void {
    const callback = this.#unwrapCallback(prop.value);
    if (getHandlerKey(callback) === null) return;
    const propagated = this.#getPropagatedCallbacks(element, prop, callback, ancestors);
    const handled: SymbolicValue =
      propagated.length > 0
        ? { kind: "ArrayExpression", elements: propagated, spreads: [] }
        : callback;
    const handlerKey = getHandlerKey(handled);
    if (handlerKey === null) return;
    const isWrapped = callback !== prop.value;
    const controlEvent = getControlEvent(element, prop) ?? this.#getSelectEvent(element, prop);
    const key = isWrapped ? `wrapped:${handlerKey}` : handlerKey;
    this.#plan(controlEvent ? `${key}:${getValueKey(controlEvent.argument)}` : key, {
      trigger: { kind: "Event", tag: element.tag.name, event: getTriggerEvent(prop) },
      callback: handled,
      callbackArguments: [controlEvent?.argument ?? EVENT_ARGUMENT],
      loc: getHandlerLocation(callback),
      guards,
      callbackGuards: [
        ...(isWrapped ? [createUnknown("wrapped-call", prop.loc)] : []),
        ...(controlEvent?.guards ?? []),
      ],
      props: [prop],
    });
  }

  #getPropagatedCallbacks(
    element: JsxExpressionValue,
    prop: JsxProp,
    callback: SymbolicValue,
    ancestors: JsxExpressionValue[],
  ): SymbolicValue[] {
    const isBubbling =
      element.tag.kind === "BuiltinTag" &&
      EVENT_HANDLER_PATTERN.test(prop.name) &&
      !NON_BUBBLING_EVENTS.has(prop.name) &&
      !prop.name.endsWith(CAPTURE_SUFFIX);
    if (!isBubbling) return [];
    const chain = [
      ...ancestors.flatMap((ancestor) =>
        this.#getAncestorCallbacks(ancestor, `${prop.name}${CAPTURE_SUFFIX}`),
      ),
      callback,
      ...[...ancestors]
        .reverse()
        .flatMap((ancestor) => this.#getAncestorCallbacks(ancestor, prop.name)),
    ];
    const stopIndex = chain.findIndex((entry) => this.#loadsProperty(entry, "stopPropagation"));
    const clicked = stopIndex === -1 ? chain : chain.slice(0, stopIndex + 1);
    const propagated = [...clicked, ...this.#getSubmitCallbacks(element, prop, ancestors, clicked)];
    return propagated.length === 1 ? [] : propagated;
  }

  #getSubmitCallbacks(
    element: JsxExpressionValue,
    prop: JsxProp,
    ancestors: JsxExpressionValue[],
    clicked: SymbolicValue[],
  ): SymbolicValue[] {
    const form = ancestors.findLast(
      (ancestor) => ancestor.tag.kind === "BuiltinTag" && ancestor.tag.name === "form",
    );
    const isSubmitted =
      form !== undefined &&
      prop.name === "onClick" &&
      isSubmitControl(element) &&
      !clicked.some((callback) => this.#loadsProperty(callback, "preventDefault"));
    return isSubmitted ? this.#getAncestorCallbacks(form, "onSubmit") : [];
  }

  #getAncestorCallbacks(ancestor: JsxExpressionValue, name: string): SymbolicValue[] {
    return ancestor.props
      .flatMap((prop) =>
        prop.kind === "JsxAttribute" && prop.name === name
          ? [this.#unwrapCallback(prop.value)]
          : [],
      )
      .filter((callback) => getHandlerKey(callback) !== null);
  }

  #loadsProperty(callback: SymbolicValue, property: string): boolean {
    if (callback.kind !== "Function") return false;
    const hirFunction = this.#interpreter.functions.get(callback.functionId);
    return hirFunction !== null && loadsProperty(hirFunction, property);
  }

  #getSelectEvent(element: JsxExpressionValue, prop: JsxProp): ControlEvent | null {
    const isSelect = element.tag.kind === "BuiltinTag" && element.tag.name === "select";
    const values = isSelect && CHECK_EVENTS.has(prop.name) ? getOptionValues(element) : null;
    if (!values) return null;
    const selected = this.#interpreter.createBinding("event.target.value", "call", prop.loc, {
      domain: {
        kind: "Cases",
        cases: values.map((value) => ({ kind: "Literal", value })),
        origin: "call-sites",
      },
    });
    return {
      argument: createTargetEvent({
        kind: "ObjectExpression",
        properties: [{ key: "value", value: createBindingValue(selected) }],
        spreads: [createUnknown("event", GeneratedSource)],
      }),
      guards: [],
    };
  }

  #unwrapCallback(value: SymbolicValue): SymbolicValue {
    const resolved = this.#interpreter.resolveModuleFunction(value);
    const wrapped = this.#interpreter.getWrappedCallbacks(resolved);
    if (!wrapped) return resolved;
    const [single] = wrapped;
    return wrapped.length === 1 && single
      ? single
      : { kind: "ArrayExpression", elements: wrapped, spreads: [] };
  }
}

const loadsProperty = (hirFunction: HIRFunction, property: string): boolean => {
  for (const block of hirFunction.body.blocks.values())
    for (const { value } of block.instructions) {
      if (value.kind === "PropertyLoad" && value.property === property) return true;
      const isClosure = value.kind === "FunctionExpression" || value.kind === "ObjectMethod";
      if (isClosure && loadsProperty(value.loweredFunc.func, property)) return true;
    }
  return false;
};

const getElementAncestors = (
  render: SymbolicValue,
): Map<JsxExpressionValue, JsxExpressionValue[]> => {
  const ancestorsByElement = new Map<JsxExpressionValue, JsxExpressionValue[]>();
  const visited = new WeakSet<SymbolicValue>();
  const walk = (node: SymbolicValue, ancestors: JsxExpressionValue[]): void => {
    if (visited.has(node)) return;
    visited.add(node);
    switch (node.kind) {
      case "JsxExpression": {
        ancestorsByElement.set(node, ancestors);
        for (const prop of node.props) if (prop.kind === "JsxAttribute") walkPropValue(prop.value);
        const inner = node.tag.kind === "BuiltinTag" ? [...ancestors, node] : ancestors;
        for (const child of node.children) walk(child, inner);
        return;
      }
      case "JsxFragment":
        for (const child of node.children) walk(child, ancestors);
        return;
      case "Conditional":
        walk(node.consequent, ancestors);
        walk(node.alternate, ancestors);
        return;
      case "ArrayMap":
        walk(node.item, ancestors);
        return;
      default:
        return;
    }
  };
  const walkPropValue = (propValue: SymbolicValue): void => {
    switch (propValue.kind) {
      case "ArrayExpression":
        propValue.elements.forEach(walkPropValue);
        return;
      case "ObjectExpression":
        for (const property of propValue.properties) walkPropValue(property.value);
        return;
      default:
        walk(propValue, []);
    }
  };
  walk(render, []);
  return ancestorsByElement;
};

const collectWrappedCallbacks = (
  render: SymbolicValue,
  interpreter: Interpreter,
): Set<SymbolicValue> => {
  const wrapped = new Set<SymbolicValue>();
  forEachJsxElement(render, (element) => {
    for (const prop of element.props) {
      if (prop.kind !== "JsxAttribute" || !isHandlerProp(element.tag, prop)) continue;
      for (const callback of interpreter.getWrappedCallbacks(prop.value) ?? [])
        wrapped.add(callback);
    }
  });
  return wrapped;
};

const getReadBindingIds = (handler: Handler): Set<number> => {
  const bindingIds = new Set<number>();
  for (const update of handler.updates)
    for (const read of [update.value, ...update.guards])
      forEachSymbolicValue(read, (part) => {
        if (part.kind === "Binding") bindingIds.add(part.binding.id);
      });
  return bindingIds;
};

const getCommitUpdates = (effects: Handler[]): StateUpdate[] => {
  const readIds = effects.map(getReadBindingIds);
  const interacting = effects.filter((effect, index) =>
    effects.some(
      (other, otherIndex) =>
        otherIndex !== index &&
        (other.updates.some((update) => readIds[index]?.has(update.binding.id)) ||
          effect.updates.some((update) => readIds[otherIndex]?.has(update.binding.id))),
    ),
  );
  return interacting.flatMap((effect) =>
    effect.updates.map((update) => ({
      ...update,
      guards: [createUnknown(`fires ${effect.id}`, effect.loc), ...update.guards],
    })),
  );
};

const getRenderedBindingIds = (render: SymbolicValue): Set<number> => {
  const bindingIds = new Set<number>();
  forEachSymbolicValue(render, (part) => {
    if (part.kind === "Binding") bindingIds.add(part.binding.id);
  });
  return bindingIds;
};

const getDependentIds = (bindingIds: Set<number>, bindings: Binding[]): Set<number> => {
  const dependentIds = new Set(bindingIds);
  let previousSize = 0;
  while (previousSize !== dependentIds.size) {
    previousSize = dependentIds.size;
    for (const binding of bindings)
      if (binding.inputPlaces.some((place) => dependentIds.has(place.bindingId)))
        dependentIds.add(binding.id);
  }
  return dependentIds;
};

const forgetPendingReads = (
  handlers: Handler[],
  pendingMutations: Binding[],
  bindings: Binding[],
): void => {
  const mutatedIds = new Set(pendingMutations.filter(isStateBinding).map((binding) => binding.id));
  if (mutatedIds.size === 0) return;
  const pendingIds = getDependentIds(mutatedIds, bindings);
  const forget = (value: SymbolicValue): SymbolicValue =>
    mapSymbolicValue(value, (part) =>
      part.kind === "Binding" && pendingIds.has(part.binding.id)
        ? createUnknown("mutated", GeneratedSource)
        : part,
    );
  for (const handler of handlers) {
    if (handler.trigger.kind === "Render") continue;
    handler.updates = handler.updates.map((update) => ({
      ...update,
      value: forget(update.value),
      guards: update.guards.map(forget),
    }));
  }
};

const revealPendingMutations = (
  handlers: Handler[],
  pendingMutations: Binding[],
  hookBindings: Binding[],
): void => {
  for (const handler of handlers) {
    if (handler.trigger.kind === "Render" || handler.updates.length === 0) continue;
    const writesModule = handler.updates.some((update) => update.binding.kind === "module");
    for (const binding of writesModule ? [...pendingMutations, ...hookBindings] : pendingMutations)
      if (!handler.updates.some((update) => update.binding.id === binding.id))
        handler.updates.push({
          binding,
          value: createUnknown("mutated", GeneratedSource),
          guards: [],
          isAsync: false,
        });
  }
};

export const collectHandlers = (render: SymbolicValue, interpreter: Interpreter): Handler[] => {
  const renderPhaseEffects = interpreter.finishRenderPhaseEffects();
  const storedFunctionCount = interpreter.storedFunctionCount;
  const handlers = collectHandlersOnce(render, interpreter, renderPhaseEffects);
  for (const update of handlers.flatMap((handler) => handler.updates))
    if (isStateBinding(update.binding))
      interpreter.addStoredFunctions(createBindingValue(update.binding), update.value);
  return interpreter.storedFunctionCount === storedFunctionCount
    ? handlers
    : collectHandlersOnce(render, interpreter, renderPhaseEffects);
};

const collectHandlersOnce = (
  render: SymbolicValue,
  interpreter: Interpreter,
  renderPhaseEffects: CollectedEffects,
): Handler[] => {
  const collector = new HandlerCollector(interpreter);
  const wrappedCallbacks = collectWrappedCallbacks(render, interpreter);
  const effectCalls = interpreter.effectCalls.filter(
    (effectCall) => !wrappedCallbacks.has(effectCall.callback),
  );
  const ancestorsByElement = getElementAncestors(render);
  for (const [element, renderGuards] of getRenderGuards(render))
    collector.planElementHandlers(element, renderGuards, ancestorsByElement.get(element) ?? []);
  for (const callback of [
    ...effectCalls.map((effectCall) => effectCall.callback),
    ...collector.plannedCallbacks,
  ])
    interpreter.forgetHandlerWrites(callback);
  for (const effectCall of effectCalls)
    collector.addHandler(
      {
        kind: "Effect",
        hookKind: effectCall.hookKind,
        dependencies: effectCall.dependencies,
        dependencyPlaces: effectCall.dependencyPlaces,
      },
      effectCall.callback,
      effectCall.callbackArguments,
      effectCall.loc,
    );
  const commitUpdates = getCommitUpdates(collector.handlers);
  if (commitUpdates.length > 0)
    collector.addCollectedHandler(
      { kind: "Effect", hookKind: "useEffect", dependencies: null, dependencyPlaces: null },
      { updates: commitUpdates, delegates: [], pendingMutations: [], claims: [] },
      GeneratedSource,
    );
  collector.addCollectedHandler({ kind: "Render" }, renderPhaseEffects, GeneratedSource);
  collector.runPlannedHandlers();
  const renderedIds = getRenderedBindingIds(render);
  const isRendered = (binding: Binding): boolean =>
    (binding.kind !== "ref" && binding.kind !== "module") || renderedIds.has(binding.id);
  const { bindings } = interpreter.bindingTable;
  forgetPendingReads(collector.handlers, [...collector.pendingMutations.values()], bindings);
  revealPendingMutations(
    collector.handlers,
    [
      ...collector.pendingMutations.values(),
      ...bindings.filter((binding) => binding.kind === "module"),
    ].filter(isRendered),
    bindings.filter((binding) => binding.kind === "hook"),
  );
  for (const handler of collector.handlers)
    handler.updates = handler.updates.filter((update) => isRendered(update.binding));
  return collector.handlers;
};
