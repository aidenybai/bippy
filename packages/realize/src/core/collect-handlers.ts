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
  getContainedValues,
  getPassedCallbacks,
} from "./symbolic-values";
import { getRenderGuards, intersectGuards } from "./utils/get-render-guards";
import { isStateBinding } from "./utils/is-state-binding";
import { mayCallPropsOutsideEvents } from "./utils/may-call-props-outside-events";
import { getTargetMethodCalls } from "./utils/get-target-method-calls";
import { DYNAMIC_TAG_NAME, LOCAL_RENDER_PROP } from "./build-jsx";

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

const getIndependentCallbacks = (value: SymbolicValue): SymbolicValue =>
  value.kind === "ArrayExpression" && value.spreads.length === 0
    ? {
        kind: "ObjectExpression",
        properties: value.elements.map((element, index) => ({
          key: String(index),
          value: element,
        })),
        spreads: [],
      }
    : value;

const getHeldValue = (value: SymbolicValue): SymbolicValue =>
  value.kind === "Binding" && value.path.length === 0 && isStateBinding(value.binding)
    ? (value.binding.initial ?? value)
    : value;

export const isHandlerProp = (tag: JsxTag, prop: JsxProp): boolean =>
  EVENT_HANDLER_PATTERN.test(prop.name) ||
  isFormActionProp(tag, prop) ||
  (tag.kind !== "BuiltinTag" && getPassedCallbacks([getHeldValue(prop.value)]).length > 0);

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

const getDefinitePropKeys = (prop: JsxProp | JsxSpreadProp): string[] => {
  if (prop.kind === "JsxAttribute") return [prop.name];
  const { value } = prop;
  return value.kind === "ObjectExpression" && value.spreads.length === 0
    ? value.properties.map((property) => property.key)
    : [];
};

const getLaterPropKeys = (props: Array<JsxProp | JsxSpreadProp>): Array<Set<string>> => {
  const laterKeys: Array<Set<string>> = [];
  let keys = new Set<string>();
  for (let index = props.length - 1; index >= 0; index--) {
    laterKeys[index] = keys;
    const prop = props[index];
    keys = prop ? new Set([...keys, ...getDefinitePropKeys(prop)]) : keys;
  }
  return laterKeys;
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

const guardCallbacks = (
  callbacks: SymbolicValue[],
  reason: string,
  prop: JsxProp,
): SymbolicValue[] =>
  callbacks.map((callback, caseIndex) => ({
    kind: "Conditional",
    test: createUnknown(reason, prop.loc),
    testKind: "truthy",
    consequent: callback,
    alternate: UNDEFINED_VALUE,
    branch: {
      terminalId: makeInstructionId(0),
      probe: "none",
      loc: prop.loc,
      file: prop.file,
      caseIndex,
    },
    guardKeys: [],
  }));

const getBubblingEvent = (prop: JsxProp | JsxSpreadProp): string[] => {
  if (prop.kind !== "JsxAttribute" || !EVENT_HANDLER_PATTERN.test(prop.name)) return [];
  const event = prop.name.endsWith(CAPTURE_SUFFIX)
    ? prop.name.slice(0, -CAPTURE_SUFFIX.length)
    : prop.name;
  return NON_BUBBLING_EVENTS.has(event) ? [] : [event];
};

const ENTER_EVENTS = new Set(["onMouseEnter", "onPointerEnter"]);

const LEAVE_EVENTS = new Set(["onMouseLeave", "onPointerLeave"]);

const TEXT_INPUT_TYPES = new Set([
  "color",
  "date",
  "datetime",
  "datetime-local",
  "email",
  "month",
  "number",
  "password",
  "range",
  "search",
  "tel",
  "text",
  "time",
  "url",
  "week",
]);

const INPUT_EVENTS = new Set(["onInput", "onChange"]);

const isTextInput = (element: JsxExpressionValue): boolean => {
  if (element.tag.kind !== "BuiltinTag") return false;
  if (element.tag.name === "textarea") return true;
  if (element.tag.name !== "input") return false;
  const type = getAttribute(element, "type")?.value;
  if (type === undefined) return true;
  return (
    type.kind !== "Primitive" ||
    (typeof type.value === "string" && TEXT_INPUT_TYPES.has(type.value))
  );
};

const getDispatchedEvents = (element: JsxExpressionValue, prop: JsxProp): string[] => {
  if (prop.name === "onChange" && getCheckableType(element) !== null)
    return ["onClick", "onChange"];
  if (INPUT_EVENTS.has(prop.name) && isTextInput(element)) return ["onInput", "onChange"];
  return [prop.name];
};

const REF_METHOD_EVENTS = new Map([
  ["focus", "onFocus"],
  ["blur", "onBlur"],
  ["click", "onClick"],
  ["requestSubmit", "onSubmit"],
  ["reset", "onReset"],
]);

const ACTIVATABLE_TAGS = new Set([
  "a",
  "button",
  "input",
  "label",
  "select",
  "summary",
  "textarea",
]);

const LABELABLE_TAGS = new Set([
  "button",
  "input",
  "meter",
  "output",
  "progress",
  "select",
  "textarea",
]);

const isLabelable = (element: JsxExpressionValue): boolean => {
  if (element.tag.kind !== "BuiltinTag" || !LABELABLE_TAGS.has(element.tag.name)) return false;
  const type = getAttribute(element, "type")?.value;
  return !(type?.kind === "Primitive" && type.value === "hidden");
};

const getActivationEvents = (control: JsxExpressionValue): string[] => {
  if (getCheckableType(control) !== null) return ["onClick", "onChange"];
  if (control.tag.name === "button" || getSubmitControl(control) === "always") return ["onClick"];
  return ["onFocus"];
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

const getCheckableType = (element: JsxExpressionValue): string | null => {
  if (element.tag.kind !== "BuiltinTag" || element.tag.name !== "input") return null;
  const type = getAttribute(element, "type")?.value;
  return type?.kind === "Primitive" &&
    typeof type.value === "string" &&
    CHECKABLE_TYPES.has(type.value)
    ? type.value
    : null;
};

const getControlEvent = (element: JsxExpressionValue, prop: JsxProp): ControlEvent | null => {
  const type = getCheckableType(element);
  if (type === null || !CHECK_EVENTS.has(prop.name)) return null;
  const isRadio = type === "radio";
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
    guards: isRadio && checked && prop.name !== "onClick" ? [foldUnary("!", checked)] : [],
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

const NON_SUBMIT_BUTTON_TYPES = new Set(["button", "reset"]);

const getResetControl = (element: JsxExpressionValue): "always" | "maybe" | null => {
  if (element.tag.kind !== "BuiltinTag") return null;
  if (element.tag.name !== "button" && element.tag.name !== "input") return null;
  const typeValue = getAttribute(element, "type")?.value;
  if (typeValue && typeValue.kind !== "Primitive") return "maybe";
  return typeValue?.value === "reset" ? "always" : null;
};

const getSubmitControl = (element: JsxExpressionValue): "always" | "maybe" | null => {
  if (element.tag.kind !== "BuiltinTag") return null;
  const isButton = element.tag.name === "button";
  if (!isButton && element.tag.name !== "input") return null;
  const typeValue = getAttribute(element, "type")?.value;
  if (typeValue && typeValue.kind !== "Primitive") return "maybe";
  const type = typeof typeValue?.value === "string" ? typeValue.value : "";
  const isSubmit = isButton ? !NON_SUBMIT_BUTTON_TYPES.has(type) : SUBMIT_TYPES.has(type);
  return isSubmit ? "always" : null;
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
  readonly commitCallbacks = new Map<string, { callback: SymbolicValue; loc: SourceLocation }>();

  readonly #consumerCallbacks: Map<JsxExpressionValue, SymbolicValue[]>;
  readonly #ancestorsByElement: Map<JsxExpressionValue, JsxExpressionValue[]>;

  constructor(
    interpreter: Interpreter,
    ancestorsByElement: Map<JsxExpressionValue, JsxExpressionValue[]> = new Map(),
  ) {
    this.#interpreter = interpreter;
    this.#consumerCallbacks = this.#getConsumerCallbacks(ancestorsByElement);
    this.#ancestorsByElement = ancestorsByElement;
    interpreter.refEventDispatcher = (refId, methodName) =>
      this.#getRefEventCallbacks(refId, methodName);
  }

  #getConsumerCallbacks(
    ancestorsByElement: Map<JsxExpressionValue, JsxExpressionValue[]>,
  ): Map<JsxExpressionValue, SymbolicValue[]> {
    const callbacksByAncestor = new Map<JsxExpressionValue, Set<SymbolicValue>>();
    for (const [element, ancestors] of ancestorsByElement) {
      if (element.tag.kind !== "Component" || element.tag.isContext) continue;
      const provided = ancestors.flatMap((ancestor) =>
        ancestor.tag.kind === "Component" && ancestor.tag.isContext
          ? this.#getAncestorCallbacks(ancestor, "value").flatMap((value) =>
              getContainedValues(getIndependentCallbacks(value)),
            )
          : [],
      );
      if (provided.length === 0) continue;
      for (const ancestor of ancestors)
        if (ancestor.tag.kind === "BuiltinTag")
          for (const callback of provided)
            callbacksByAncestor.set(
              ancestor,
              (callbacksByAncestor.get(ancestor) ?? new Set()).add(callback),
            );
    }
    return new Map(
      [...callbacksByAncestor].map(([ancestor, callbacks]) => [ancestor, [...callbacks]]),
    );
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
    const effects = this.#interpreter.collectEffects(
      callback,
      callbackArguments,
      guards,
      callbackGuards,
      runsCleanup,
    );
    const isLocalRender =
      trigger.kind === "Event" &&
      trigger.tag === DYNAMIC_TAG_NAME &&
      trigger.event === LOCAL_RENDER_PROP;
    if (isLocalRender) this.#interpreter.localRenders.push(...(effects.returned ?? []));
    return this.addCollectedHandler(trigger, effects, loc, guards);
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
    const laterKeys = getLaterPropKeys(element.props);
    element.props.forEach((prop, index) => {
      const overridden = laterKeys[index] ?? new Set<string>();
      if (prop.kind === "JsxSpreadAttribute")
        this.#planSpreadHandlers(element, prop, eventGuards, overridden);
      else if (overridden.has(prop.name)) return;
      else if (isRefCallback(prop)) this.#planRefCallback(prop, renderGuards);
      else if (isHandlerProp(element.tag, prop))
        this.#planEventHandler(element, prop, eventGuards, ancestors);
    });
    const autoFocus = getAttribute(element, "autoFocus")?.value;
    const focused =
      autoFocus && !(autoFocus.kind === "Primitive" && !autoFocus.value)
        ? this.#getElementEventCallbacks(element, "focus")
        : [];
    if (focused.length > 0)
      this.commitCallbacks.set(`autofocus:${getLocationKey(element.loc)}`, {
        callback: { kind: "ArrayExpression", elements: focused, spreads: [] },
        loc: element.loc,
      });
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
    overridden: ReadonlySet<string>,
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
    const allSpreadHandlers = getSpreadHandlers(element.tag, prop);
    const keptProperties = allSpreadHandlers?.properties.filter(
      (property) => !overridden.has(property.key),
    );
    const spreadHandlers: ObjectExpressionValue | null =
      keptProperties && keptProperties.length > 0
        ? { kind: "ObjectExpression", properties: keptProperties, spreads: [] }
        : null;
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
    const unwrapped = this.#unwrapCallback(prop.value);
    const callback =
      element.tag.kind === "BuiltinTag" ? unwrapped : getIndependentCallbacks(unwrapped);
    const callbackKey = getHandlerKey(callback);
    if (callbackKey === null) return;
    if (element.tag.kind === "Component" && this.#mayCallOutsideEvents(element.tag.declaration))
      this.commitCallbacks.set(callbackKey, { callback, loc: prop.loc });
    const propagated =
      element.tag.kind === "Component"
        ? this.#getBubbledCallbacks(prop, callback, ancestors)
        : this.#getPropagatedCallbacks(element, prop, callback, ancestors);
    const targeted =
      element.tag.kind === "BuiltinTag" ? this.#getTargetEventCallbacks(element, callback) : [];
    const sequence = [...(propagated.length > 0 ? propagated : [callback]), ...targeted];
    const handled: SymbolicValue =
      sequence.length > 1 ? { kind: "ArrayExpression", elements: sequence, spreads: [] } : callback;
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
    if (element.tag.kind !== "BuiltinTag" || !EVENT_HANDLER_PATTERN.test(prop.name)) return [];
    if (ENTER_EVENTS.has(prop.name) || LEAVE_EVENTS.has(prop.name)) {
      const entered = ancestors.flatMap((ancestor) =>
        ancestor.tag.kind === "BuiltinTag"
          ? guardCallbacks(
              this.#getAncestorCallbacks(ancestor, prop.name),
              `crossed ${prop.name} ${getLocationKey(ancestor.loc)}`,
              prop,
            )
          : [],
      );
      if (entered.length === 0) return [];
      return ENTER_EVENTS.has(prop.name)
        ? [...entered, callback]
        : [callback, ...entered.reverse()];
    }
    if (NON_BUBBLING_EVENTS.has(prop.name) || prop.name.endsWith(CAPTURE_SUFFIX)) return [];
    const clicked = getDispatchedEvents(element, prop).flatMap((event) =>
      this.#getReachedCallbacks(
        this.#getChain(
          event,
          event === prop.name
            ? [
                ...guardCallbacks(
                  this.#consumerCallbacks.get(element) ?? [],
                  `consumer ${prop.name} ${getLocationKey(element.loc)}`,
                  prop,
                ),
                callback,
              ]
            : this.#getAncestorCallbacks(element, event),
          ancestors,
          prop,
        ),
        prop,
      ),
    );
    const propagated = [
      ...clicked,
      ...this.#getDefaultActionCallbacks(element, prop, ancestors, clicked),
    ];
    return propagated.length === 1 ? [] : propagated;
  }

  #getRefEventCallbacks(refId: number, methodName: string): SymbolicValue[] {
    const element = [...this.#ancestorsByElement.keys()].find((candidate) =>
      candidate.props.some(
        (prop) =>
          prop.kind === "JsxAttribute" &&
          prop.name === "ref" &&
          prop.value.kind === "Binding" &&
          prop.value.path.length === 0 &&
          prop.value.binding.id === refId,
      ),
    );
    if (!element) return [];
    if (element.tag.kind === "BuiltinTag")
      return this.#getElementEventCallbacks(element, methodName);
    return guardCallbacks(
      this.#getComponentCallbacks(element),
      `ref ${methodName} ${getLocationKey(element.loc)}`,
      this.#getEventProp(element, methodName),
    );
  }

  #getTargetEventCallbacks(element: JsxExpressionValue, callback: SymbolicValue): SymbolicValue[] {
    if (callback.kind !== "Function") return [];
    const hirFunction = this.#interpreter.functions.get(callback.functionId);
    if (!hirFunction) return [];
    const ancestors = this.#ancestorsByElement.get(element) ?? [];
    return getTargetMethodCalls(hirFunction).flatMap((call) => {
      const target = call.isForm ? this.#getOwnerForm(element, ancestors) : element;
      if (!target) return [];
      return guardCallbacks(
        this.#getElementEventCallbacks(target, call.methodName),
        `target ${call.methodName} ${getLocationKey(element.loc)}`,
        this.#getEventProp(target, call.methodName),
      );
    });
  }

  #getEventProp(element: JsxExpressionValue, methodName: string): JsxProp {
    return {
      kind: "JsxAttribute",
      name: REF_METHOD_EVENTS.get(methodName) ?? methodName,
      value: UNDEFINED_VALUE,
      handlerId: null,
      loc: element.loc,
      file: this.#interpreter.resolver.fileName,
    };
  }

  #getElementEventCallbacks(element: JsxExpressionValue, methodName: string): SymbolicValue[] {
    const event = REF_METHOD_EVENTS.get(methodName);
    if (!event || element.tag.kind !== "BuiltinTag") return [];
    const ancestors = this.#ancestorsByElement.get(element) ?? [];
    const prop = this.#getEventProp(element, methodName);
    const [callback = UNDEFINED_VALUE] = this.#getAncestorCallbacks(element, event);
    const propagated = this.#getPropagatedCallbacks(element, prop, callback, ancestors);
    const callbacks = propagated.length > 0 ? propagated : [callback];
    return event === "onFocus" || event === "onBlur"
      ? guardCallbacks(callbacks, `${methodName} ${getLocationKey(element.loc)}`, prop)
      : callbacks;
  }

  #getActivationCallbacks(
    label: JsxExpressionValue,
    clicked: SymbolicValue[],
    prop: JsxProp,
  ): SymbolicValue[] {
    const control = this.#getLabelControl(label);
    const prevents = clicked.map((callback) => this.#getPropertyLoad(callback, "preventDefault"));
    if (!control || prevents.includes("always")) return [];
    const ancestors = this.#ancestorsByElement.get(control) ?? [];
    const isRadio = getCheckableType(control) === "radio";
    const activated = getActivationEvents(control).flatMap((event) => {
      const reached = this.#getReachedCallbacks(
        this.#getChain(event, this.#getAncestorCallbacks(control, event), ancestors, prop),
        prop,
      );
      const isMaybe = event === "onFocus" || (isRadio && event === "onChange");
      return isMaybe
        ? guardCallbacks(reached, `activated ${event} ${getLocationKey(control.loc)}`, prop)
        : reached;
    });
    const sequence = [
      ...activated,
      ...this.#getDefaultActionCallbacks(
        control,
        { ...prop, name: "onClick" },
        ancestors,
        activated,
      ),
    ];
    return prevents.includes("maybe")
      ? guardCallbacks(sequence, `activated ${getLocationKey(label.loc)}`, prop)
      : sequence;
  }

  #getLabelControl(label: JsxExpressionValue): JsxExpressionValue | null {
    const target = getAttribute(label, "htmlFor")?.value;
    const elements = [...this.#ancestorsByElement.keys()];
    if (target?.kind === "Primitive")
      return (
        elements.find((element) => {
          const id = getAttribute(element, "id")?.value;
          return id?.kind === "Primitive" && id.value === target.value;
        }) ?? null
      );
    if (target) return null;
    return (
      elements.find(
        (element) =>
          isLabelable(element) && (this.#ancestorsByElement.get(element) ?? []).includes(label),
      ) ?? null
    );
  }

  #getChain(
    name: string,
    targetCallbacks: SymbolicValue[],
    ancestors: JsxExpressionValue[],
    prop: JsxProp,
  ): SymbolicValue[] {
    return [
      ...ancestors.flatMap((ancestor) =>
        ancestor.tag.kind === "BuiltinTag"
          ? this.#getAncestorCallbacks(ancestor, `${name}${CAPTURE_SUFFIX}`)
          : [],
      ),
      ...targetCallbacks,
      ...[...ancestors]
        .reverse()
        .flatMap((ancestor) =>
          ancestor.tag.kind === "BuiltinTag"
            ? this.#getAncestorCallbacks(ancestor, name)
            : guardCallbacks(
                this.#getComponentCallbacks(ancestor),
                `wrapper ${name} ${getLocationKey(ancestor.loc)}`,
                prop,
              ),
        ),
    ];
  }

  #getComponentCallbacks(component: JsxExpressionValue): SymbolicValue[] {
    const isWrapper =
      component.tag.kind === "Component" &&
      !component.tag.isContext &&
      component.tag.reactExport === null;
    if (!isWrapper) return [];
    return component.props
      .flatMap((prop) =>
        prop.kind === "JsxAttribute" && isHandlerProp(component.tag, prop)
          ? getContainedValues(getIndependentCallbacks(this.#unwrapCallback(prop.value)))
          : [],
      )
      .filter((callback) => getHandlerKey(callback) !== null);
  }

  #getBubbledCallbacks(
    prop: JsxProp,
    callback: SymbolicValue,
    ancestors: JsxExpressionValue[],
  ): SymbolicValue[] {
    if (callback.kind === "ObjectExpression") return [];
    const events = new Set(
      ancestors.flatMap((ancestor) =>
        ancestor.tag.kind === "BuiltinTag" ? ancestor.props.flatMap(getBubblingEvent) : [],
      ),
    );
    const groups = [...events].map((event) => {
      const reached = this.#getReachedCallbacks(
        this.#getChain(event, [callback], ancestors, prop),
        prop,
      );
      const index = reached.indexOf(callback);
      const reason = `bubbled ${event} ${getHandlerKey(callback)}`;
      return index === -1
        ? { before: [], after: [] }
        : {
            before: guardCallbacks(reached.slice(0, index), reason, prop),
            after: guardCallbacks(reached.slice(index + 1), reason, prop),
          };
    });
    const before = groups.flatMap((group) => group.before);
    const after = groups.flatMap((group) => group.after);
    return before.length + after.length === 0 ? [] : [...before, callback, ...after];
  }

  #getReachedCallbacks(chain: SymbolicValue[], prop: JsxProp): SymbolicValue[] {
    const stopIndex = chain.findIndex(
      (entry) => this.#getPropertyLoad(entry, "stopPropagation") !== null,
    );
    const stopper = chain[stopIndex];
    if (!stopper) return chain;
    const reached = chain.slice(0, stopIndex + 1);
    return this.#getPropertyLoad(stopper, "stopPropagation") === "always"
      ? reached
      : [
          ...reached,
          ...guardCallbacks(
            this.#getReachedCallbacks(chain.slice(stopIndex + 1), prop),
            `propagation ${getHandlerKey(stopper)}`,
            prop,
          ),
        ];
  }

  #getDefaultActionCallbacks(
    element: JsxExpressionValue,
    prop: JsxProp,
    ancestors: JsxExpressionValue[],
    clicked: SymbolicValue[],
  ): SymbolicValue[] {
    if (prop.name !== "onClick") return [];
    const prevents = clicked.map((callback) => this.#getPropertyLoad(callback, "preventDefault"));
    if (prevents.includes("always")) return [];
    const getDefaultCallbacks = (
      owner: JsxExpressionValue | undefined,
      control: "always" | "maybe" | null,
      event: string,
      extra: SymbolicValue[] = [],
    ): SymbolicValue[] => {
      if (owner === undefined || control === null) return [];
      const callbacks = [...this.#getAncestorCallbacks(owner, event), ...extra];
      return prevents.includes("maybe") || control === "maybe"
        ? guardCallbacks(callbacks, `default ${event} ${getLocationKey(owner.loc)}`, prop)
        : callbacks;
    };
    const path = [...ancestors, element];
    const activatorIndex = path.findLastIndex(
      (ancestor) => ancestor.tag.kind === "BuiltinTag" && ACTIVATABLE_TAGS.has(ancestor.tag.name),
    );
    const activator = path[activatorIndex];
    if (!activator) return [];
    if (activator.tag.name === "label")
      return this.#getActivationCallbacks(activator, clicked, prop);
    const form = this.#getOwnerForm(activator, path.slice(0, activatorIndex));
    const details = activator.tag.name === "summary" ? path[activatorIndex - 1] : undefined;
    const isToggled = details?.tag.kind === "BuiltinTag" && details.tag.name === "details";
    return [
      ...getDefaultCallbacks(
        form,
        getSubmitControl(activator),
        "onSubmit",
        this.#getFormActions(form, activator),
      ),
      ...getDefaultCallbacks(form, getResetControl(activator), "onReset"),
      ...getDefaultCallbacks(isToggled ? details : undefined, "maybe", "onToggle"),
    ];
  }

  #getFormActions(
    form: JsxExpressionValue | undefined,
    submitter: JsxExpressionValue,
  ): SymbolicValue[] {
    if (!form) return [];
    const submitterActions = this.#getAncestorCallbacks(submitter, "formAction");
    const actions =
      submitterActions.length > 0 ? submitterActions : this.#getAncestorCallbacks(form, "action");
    const prevents = this.#getAncestorCallbacks(form, "onSubmit").map((callback) =>
      this.#getPropertyLoad(callback, "preventDefault"),
    );
    if (prevents.includes("always")) return [];
    return prevents.includes("maybe")
      ? guardCallbacks(
          actions,
          `action ${getLocationKey(form.loc)}`,
          this.#getEventProp(form, "requestSubmit"),
        )
      : actions;
  }

  #getOwnerForm(
    element: JsxExpressionValue,
    ancestors: JsxExpressionValue[],
  ): JsxExpressionValue | undefined {
    const formId = getAttribute(element, "form")?.value;
    if (formId === undefined)
      return ancestors.findLast(
        (ancestor) => ancestor.tag.kind === "BuiltinTag" && ancestor.tag.name === "form",
      );
    if (formId.kind !== "Primitive") return undefined;
    return [...this.#ancestorsByElement.keys()].find((candidate) => {
      const id = getAttribute(candidate, "id")?.value;
      return (
        candidate.tag.kind === "BuiltinTag" &&
        candidate.tag.name === "form" &&
        id?.kind === "Primitive" &&
        id.value === formId.value
      );
    });
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

  #getPropertyLoad(callback: SymbolicValue, property: string): "always" | "maybe" | null {
    if (callback.kind !== "Function") return null;
    const hirFunction = this.#interpreter.functions.get(callback.functionId);
    if (hirFunction === null || !loadsProperty(hirFunction, property)) return null;
    const entry = hirFunction.body.blocks.get(hirFunction.body.entry);
    const isAlways = entry?.instructions.some(
      ({ value }) => value.kind === "PropertyLoad" && value.property === property,
    );
    return isAlways ? "always" : "maybe";
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

  #mayCallOutsideEvents(declaration: string | null): boolean {
    const hirFunction = declaration ? this.#interpreter.loadProjectComponent(declaration) : null;
    return hirFunction !== null && mayCallPropsOutsideEvents(hirFunction);
  }

  #unwrapCallback(value: SymbolicValue): SymbolicValue {
    const resolved = this.#interpreter.resolveModuleFunction(getHeldValue(value));
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
        for (const child of node.children) walk(child, [...ancestors, node]);
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

const getInputClosure = (bindingIds: Set<number>, bindings: Binding[]): Set<number> => {
  const closure = new Set(bindingIds);
  const pending = [...bindingIds];
  for (let bindingId = pending.pop(); bindingId !== undefined; bindingId = pending.pop())
    for (const place of bindings[bindingId]?.inputPlaces ?? [])
      if (!closure.has(place.bindingId)) {
        closure.add(place.bindingId);
        pending.push(place.bindingId);
      }
  return closure;
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
  const ancestorsByElement = getElementAncestors(render);
  const collector = new HandlerCollector(interpreter, ancestorsByElement);
  const wrappedCallbacks = collectWrappedCallbacks(render, interpreter);
  const effectCalls = interpreter.effectCalls.filter(
    (effectCall) => !wrappedCallbacks.has(effectCall.callback),
  );
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
  for (const commitCallback of collector.commitCallbacks.values())
    collector.addHandler(
      { kind: "Effect", hookKind: "Custom", dependencies: null, dependencyPlaces: null },
      commitCallback.callback,
      [createUnknown("callback-argument", commitCallback.loc)],
      commitCallback.loc,
    );
  const suspenseUpdates = interpreter.bindingTable.bindings.flatMap((binding): StateUpdate[] =>
    binding.kind === "suspense"
      ? [{ binding, value: createUnknown("suspense", binding.loc), guards: [], isAsync: true }]
      : [],
  );
  if (suspenseUpdates.length > 0)
    collector.addCollectedHandler(
      { kind: "Effect", hookKind: "Custom", dependencies: null, dependencyPlaces: null },
      { updates: suspenseUpdates, delegates: [], pendingMutations: [], claims: [] },
      GeneratedSource,
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
  const renderedIds = getInputClosure(
    getRenderedBindingIds(render),
    interpreter.bindingTable.bindings,
  );
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
