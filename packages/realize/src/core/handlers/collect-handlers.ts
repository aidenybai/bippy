import { GeneratedSource } from "../../react-compiler/HIR/HIR";
import type { HIRFunction, IdentifierId, SourceLocation } from "../../react-compiler/HIR/HIR";
import type { Interpreter } from "../interpret/interpret";
import type { CollectedEffects } from "../interpret/effect-collector";
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
} from "../types";
import { forEachJsxElement, forEachPropNode } from "../render/for-each-jsx-element";
import { getRenderChildren } from "../render/get-render-children";
import { mapSymbolicValue } from "../values/map-symbolic-value";
import { isExternalSource } from "./is-external-source";
import { getValueKey } from "../values/get-value-key";
import { getLocationKey } from "../shared/get-location-key";
import { collectBindingIds, getDependentClosure, getInputClosure } from "../shared/binding-graph";
import {
  UNDEFINED_VALUE,
  createBindingValue,
  createUnknown,
  getContainedValues,
} from "../values/symbolic-values";
import { getRenderGuards, intersectGuards } from "./get-render-guards";
import { isStateBinding } from "../values/is-state-binding";
import { mayCallPropsOutsideEvents } from "./may-call-props-outside-events";
import { isFunctionCreation } from "../interpret/is-function-creation";
import { getTargetMethodCalls } from "./get-target-method-calls";
import {
  ACTIVATABLE_TAGS,
  ANY_EVENT,
  CAPTURE_SUFFIX,
  CHECK_EVENTS,
  ENTER_EVENTS,
  EVENT_ARGUMENT,
  EVENT_HANDLER_PATTERN,
  INTERACTIVE_TAGS,
  LEAVE_EVENTS,
  MAYBE_BUBBLING_EVENTS,
  NON_BUBBLING_EVENTS,
  REF_METHOD_EVENTS,
  createTargetEvent,
  getAttribute,
  getBaseEvent,
  getBubblingEvent,
  getCheckableType,
  getControlEvent,
  getDispatchedEvents,
  getEnabledGuards,
  getHeldValue,
  getOptionValues,
  getResetControl,
  getSubmitControl,
  getTriggerEvent,
  isDisabledEvent,
  isHandlerProp,
  isLabelable,
  isMouseBlockedEvent,
  isRefCallback,
  isTextInput,
} from "./dom-events";
import type { ControlEvent } from "./dom-events";

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

const getSpreadProperty = (spread: ObjectExpressionValue | null, key: string): SymbolicValue =>
  spread?.properties.find((property) => property.key === key)?.value ?? UNDEFINED_VALUE;

const getSpreadHandlers = (tag: JsxTag, value: SymbolicValue): ObjectExpressionValue | null => {
  if (value.kind === "Conditional") {
    const consequent = getSpreadHandlers(tag, value.consequent);
    const alternate = getSpreadHandlers(tag, value.alternate);
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
    isHandlerProp(tag, { name: property.key, value: property.value }),
  );
  return properties.length > 0 ? { kind: "ObjectExpression", properties, spreads: [] } : null;
};

const getDefinitePropKeys = (prop: JsxProp | JsxSpreadProp): string[] => {
  if (prop.kind === "JsxAttribute") return [prop.name];
  return prop.value.kind === "ObjectExpression" && prop.value.spreads.length === 0
    ? prop.value.properties.map((property) => property.key)
    : [];
};

const createGuardedConditional = (
  test: SymbolicValue,
  consequent: SymbolicValue,
  alternate: SymbolicValue,
  origin: Pick<JsxProp, "loc" | "file">,
): SymbolicValue => ({
  kind: "Conditional",
  test,
  testKind: "truthy",
  consequent,
  alternate,
  branch: { loc: origin.loc, file: origin.file, testKind: null },
});

const chooseSpreadHandler = (
  handlers: ObjectExpressionValue,
  origin: Pick<JsxProp, "loc" | "file">,
): SymbolicValue => {
  const [last, ...earlier] = [...handlers.properties].reverse();
  if (!last) return UNDEFINED_VALUE;
  return earlier.reduce<SymbolicValue>(
    (alternate, property) =>
      createGuardedConditional(
        createUnknown(`spread-event ${property.key}`, origin.loc, {
          kind: "Name",
          name: property.key,
        }),
        property.value,
        alternate,
        origin,
      ),
    last.value,
  );
};

const guardCallbacks = (
  callbacks: SymbolicValue[],
  reason: string,
  prop: JsxProp,
): SymbolicValue[] =>
  callbacks.map((callback) =>
    createGuardedConditional(createUnknown(reason, prop.loc), callback, UNDEFINED_VALUE, prop),
  );

const chooseReachableCallback = (callbacks: SymbolicValue[], prop: JsxProp): SymbolicValue =>
  [
    ...new Map(callbacks.map((callback) => [getHandlerKey(callback), callback])).values(),
  ].reduceRight<SymbolicValue>(
    (alternate, callback, caseIndex) =>
      createGuardedConditional(
        createUnknown(`reachable-callback ${caseIndex}`, prop.loc),
        callback,
        alternate,
        prop,
      ),
    UNDEFINED_VALUE,
  );

const getRenderedBranch = (
  guards: SymbolicValue[],
  consequent: SymbolicValue,
  alternate: SymbolicValue,
  prop: JsxProp,
): SymbolicValue =>
  guards.reduceRight<SymbolicValue>(
    (inner, test) => createGuardedConditional(test, inner, alternate, prop),
    consequent,
  );

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
        : `bound:${calleeKey}:${getValueKey(value.receiver)}:${value.argumentValues.map(getValueKey).join(",")}`;
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
        value.binding.hookKind === "useMemo" ||
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

interface TargetCallbacks {
  captured: SymbolicValue[];
  bubbled: SymbolicValue[];
}

type Load = "always" | "maybe" | null;

interface EventLoads {
  stops: Load;
  prevents: Load;
}

interface Dispatch extends EventLoads {
  callback: SymbolicValue;
}

const NO_LOADS: EventLoads = { stops: null, prevents: null };

const getBranchLoad = (consequent: Load, alternate: Load): Load => {
  if (consequent === "always" && alternate === "always") return "always";
  return consequent !== null || alternate !== null ? "maybe" : null;
};

const getSequenceLoad = (loads: Load[]): Load => {
  if (loads.includes("always")) return "always";
  return loads.includes("maybe") ? "maybe" : null;
};

const getPreventLoad = (dispatches: Dispatch[]): Load =>
  getSequenceLoad(dispatches.map((dispatch) => dispatch.prevents));

const weaken = (load: Load): Load => (load === null ? null : "maybe");

const gateByLoad = <Item>(load: Load, items: Item[], guard: (items: Item[]) => Item[]): Item[] => {
  if (load === "always") return [];
  return load === "maybe" ? guard(items) : items;
};

const getCallbacks = (dispatches: Dispatch[]): SymbolicValue[] =>
  dispatches.map((dispatch) => dispatch.callback);

const guardDispatches = (dispatches: Dispatch[], reason: string, prop: JsxProp): Dispatch[] =>
  dispatches.map((dispatch) => ({
    callback: createGuardedConditional(
      createUnknown(reason, prop.loc),
      dispatch.callback,
      UNDEFINED_VALUE,
      prop,
    ),
    stops: weaken(dispatch.stops),
    prevents: weaken(dispatch.prevents),
  }));

const getReachedDispatches = (chain: Dispatch[], prop: JsxProp): Dispatch[] => {
  const stopIndex = chain.findIndex((dispatch) => dispatch.stops !== null);
  const stopper = chain[stopIndex];
  if (!stopper) return chain;
  const reached = chain.slice(0, stopIndex + 1);
  if (stopper.stops === "always") return reached;
  return [
    ...reached,
    ...guardDispatches(
      getReachedDispatches(chain.slice(stopIndex + 1), prop),
      `propagation ${getHandlerKey(stopper.callback)}`,
      prop,
    ),
  ];
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
    handler.assertions.map((assertion) => [
      assertion.kind,
      getValueKey(assertion.subject),
      assertion.check.kind === "Membership" ? assertion.check.cases : null,
      assertion.check.kind === "Condition" ? getValueKey(assertion.check.test) : null,
      getValueKeys(assertion.guards),
      assertion.description,
      getLocationKey(assertion.loc),
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

  readonly #consumerCallbacks: Map<JsxExpressionValue, Set<SymbolicValue>>;
  readonly #ancestorsByElement: Map<JsxExpressionValue, JsxExpressionValue[]>;
  readonly #renderGuards: Map<JsxExpressionValue, SymbolicValue[]>;

  constructor(
    interpreter: Interpreter,
    ancestorsByElement: Map<JsxExpressionValue, JsxExpressionValue[]>,
    renderGuards: Map<JsxExpressionValue, SymbolicValue[]>,
  ) {
    this.#interpreter = interpreter;
    this.#consumerCallbacks = this.#getConsumerCallbacks(ancestorsByElement);
    this.#ancestorsByElement = ancestorsByElement;
    this.#renderGuards = renderGuards;
  }

  #getConsumerCallbacks(
    ancestorsByElement: Map<JsxExpressionValue, JsxExpressionValue[]>,
  ): Map<JsxExpressionValue, Set<SymbolicValue>> {
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
    return callbacksByAncestor;
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
    return this.addCollectedHandler(trigger, effects, loc, guards);
  }

  addCollectedHandler(
    trigger: HandlerTrigger,
    effects: CollectedEffects,
    loc: SourceLocation,
    guards: SymbolicValue[] = [],
  ): string | null {
    for (const binding of effects.pendingMutations) this.pendingMutations.set(binding.id, binding);
    if (
      effects.updates.length === 0 &&
      effects.delegates.length === 0 &&
      effects.assertions.length === 0
    )
      return null;
    const handler: Handler = {
      id: `t${this.handlers.length + 1}`,
      trigger,
      updates: effects.updates,
      delegates: effects.delegates,
      assertions: effects.assertions,
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

  planElementHandlers(element: JsxExpressionValue, renderGuards: SymbolicValue[]): void {
    const enabledGuards = getEnabledGuards(element);
    element.props.forEach((prop, index) => {
      const overridden = new Set(element.props.slice(index + 1).flatMap(getDefinitePropKeys));
      if (prop.kind === "JsxSpreadAttribute")
        this.#planSpreadHandlers(element, prop, renderGuards, overridden);
      else if (overridden.has(prop.name)) return;
      else if (isRefCallback(prop)) this.#planRefCallback(prop, renderGuards);
      else if (isHandlerProp(element.tag, prop))
        this.#planEventHandler(
          element,
          prop,
          isDisabledEvent(prop.name) ? [...renderGuards, ...enabledGuards] : renderGuards,
        );
    });
    const location = getLocationKey(element.loc);
    const autoFocus = getAttribute(element, "autoFocus")?.value;
    if (autoFocus && !(autoFocus.kind === "Primitive" && !autoFocus.value))
      this.#addCommitCallbacks(
        `autofocus:${location}`,
        this.#getElementEventCallbacks(element, "focus"),
        element.loc,
      );
    if (element.tag.kind !== "BuiltinTag" || element.tag.name !== "details") return;
    const toggleProp = this.#getEventProp(element, "onToggle");
    this.#addCommitCallbacks(
      `toggle:${location}`,
      guardCallbacks(
        getCallbacks(this.#getDispatches(element, "onToggle", toggleProp)),
        `toggle ${location}`,
        toggleProp,
      ),
      element.loc,
    );
  }

  #addCommitCallbacks(key: string, callbacks: SymbolicValue[], loc: SourceLocation): void {
    if (callbacks.length > 0)
      this.commitCallbacks.set(key, {
        callback: { kind: "ArrayExpression", elements: callbacks, spreads: [] },
        loc,
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
    const properties =
      getSpreadHandlers(element.tag, prop.value)?.properties.filter(
        (property) => !overridden.has(property.key),
      ) ?? [];
    if (properties.length === 0) return;
    const spreadHandlers: ObjectExpressionValue = {
      kind: "ObjectExpression",
      properties,
      spreads: [],
    };
    const spreadHandlerKey = getHandlerKey(spreadHandlers);
    if (spreadHandlerKey === null) return;
    this.#plan(spreadHandlerKey, {
      trigger,
      callback: chooseSpreadHandler(spreadHandlers, { loc: element.loc, file: prop.file }),
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
      },
      callback: prop.value,
      callbackArguments: [EVENT_ARGUMENT],
      loc: getHandlerLocation(prop.value),
      guards,
      props: [],
    });
  }

  #planEventHandler(element: JsxExpressionValue, prop: JsxProp, guards: SymbolicValue[]): void {
    const unwrapped = this.#unwrapCallback(prop.value);
    const resolved =
      element.tag.kind === "BuiltinTag" ? unwrapped : getIndependentCallbacks(unwrapped);
    const reachable =
      getHandlerKey(resolved) === null
        ? this.#interpreter
            .getSourceFunctions([prop.value])
            .filter((candidate) => getHandlerKey(candidate) !== null)
        : [];
    const callback = reachable.length > 0 ? chooseReachableCallback(reachable, prop) : resolved;
    const callbackKey = getHandlerKey(callback);
    if (callbackKey === null) return;
    const component = this.#loadComponent(element);
    if (component && mayCallPropsOutsideEvents(component))
      this.commitCallbacks.set(callbackKey, { callback, loc: prop.loc });
    const propagated =
      element.tag.kind === "Component"
        ? this.#getBubbledCallbacks(element, prop, callback)
        : this.#getPropagatedCallbacks(element, prop, callback);
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
  ): SymbolicValue[] {
    if (element.tag.kind !== "BuiltinTag" || !EVENT_HANDLER_PATTERN.test(prop.name)) return [];
    const ancestors = this.#getAncestors(element);
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
    const isCapture = prop.name.endsWith(CAPTURE_SUFFIX);
    const eventProp = isCapture ? { ...prop, name: getBaseEvent(prop.name) } : prop;
    if (NON_BUBBLING_EVENTS.has(eventProp.name)) return [];
    const consumers = guardCallbacks(
      [...(this.#consumerCallbacks.get(element) ?? [])],
      `consumer ${prop.name} ${getLocationKey(element.loc)}`,
      prop,
    );
    const clicked = this.#getEventSequence(
      element,
      getDispatchedEvents(element, eventProp),
      prop,
      (event) => {
        const isProp = event === eventProp.name;
        return {
          captured:
            isProp && isCapture
              ? [callback]
              : this.#getAncestorCallbacks(element, `${event}${CAPTURE_SUFFIX}`),
          bubbled:
            isProp && !isCapture
              ? [...consumers, callback]
              : this.#getAncestorCallbacks(element, event),
        };
      },
    );
    const descendants = [...this.#ancestorsByElement].flatMap(([candidate, path]) =>
      path.includes(element) ? [candidate] : [],
    );
    const getDescendantDispatches = () =>
      descendants.flatMap((descendant) => [
        ...this.#getWrapperDispatches(descendant, [
          eventProp.name,
          `${eventProp.name}${CAPTURE_SUFFIX}`,
        ]),
        ...this.#getAncestorCallbacks(descendant, eventProp.name).map(this.#dispatch),
        ...this.#getAncestorCallbacks(descendant, `${eventProp.name}${CAPTURE_SUFFIX}`).map(
          this.#dispatch,
        ),
      ]);
    const index = clicked.findIndex((dispatch) => dispatch.callback === callback);
    const isStoppedBelow =
      isCapture &&
      index !== -1 &&
      getDescendantDispatches().some((dispatch) => dispatch.stops !== null);
    const isRetargeted =
      descendants.some(
        (descendant) =>
          descendant.tag.kind === "BuiltinTag" && INTERACTIVE_TAGS.has(descendant.tag.name),
      ) || getDescendantDispatches().some((dispatch) => dispatch.prevents !== null);
    const reason = `descendant ${prop.name} ${getLocationKey(element.loc)}`;
    const defaults = this.#getDefaultActionCallbacks(element, eventProp, clicked);
    const callbacks = getCallbacks(clicked);
    const propagated = [
      ...(isStoppedBelow
        ? [
            ...callbacks.slice(0, index + 1),
            ...guardCallbacks(callbacks.slice(index + 1), reason, prop),
          ]
        : callbacks),
      ...(isRetargeted ? guardCallbacks(defaults, reason, prop) : defaults),
    ];
    return propagated.length === 1 ? [] : propagated;
  }

  getRefEventCallbacks(refId: number, methodName: string): SymbolicValue[] {
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
    return getTargetMethodCalls(hirFunction).flatMap((call) => {
      const target = call.isForm
        ? this.#getOwnerForm(element, this.#getAncestors(element))
        : element;
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
    const prop = this.#getEventProp(element, methodName);
    const [callback = UNDEFINED_VALUE] = this.#getAncestorCallbacks(element, event);
    const propagated = this.#getPropagatedCallbacks(element, prop, callback);
    const callbacks = propagated.length > 0 ? propagated : [callback];
    return event === "onFocus" || event === "onBlur"
      ? guardCallbacks(callbacks, `${methodName} ${getLocationKey(element.loc)}`, prop)
      : callbacks;
  }

  #getActivationCallbacks(
    label: JsxExpressionValue,
    prevents: Load,
    prop: JsxProp,
  ): SymbolicValue[] {
    const labelKeys = new Set((this.#renderGuards.get(label) ?? []).map(getValueKey));
    const getControlGuards = (control: JsxExpressionValue) =>
      (this.#renderGuards.get(control) ?? []).filter((guard) => !labelKeys.has(getValueKey(guard)));
    const controls = this.#getLabelControls(label);
    const renderedIndex = controls.findIndex((control) => getControlGuards(control).length === 0);
    const sequence = controls
      .slice(0, renderedIndex === -1 ? controls.length : renderedIndex + 1)
      .flatMap((control, index) =>
        this.#getControlActivation(control, prop, (callback) =>
          controls
            .slice(0, index)
            .reduce(
              (gated, earlier) =>
                getRenderedBranch(getControlGuards(earlier), UNDEFINED_VALUE, gated, prop),
              getRenderedBranch(
                [...getControlGuards(control), ...getEnabledGuards(control)],
                callback,
                UNDEFINED_VALUE,
                prop,
              ),
            ),
        ),
      );
    return gateByLoad(prevents, sequence, (callbacks) =>
      guardCallbacks(callbacks, `activated ${getLocationKey(label.loc)}`, prop),
    );
  }

  #getControlActivation(
    control: JsxExpressionValue,
    prop: JsxProp,
    gate: (callback: SymbolicValue) => SymbolicValue,
  ): SymbolicValue[] {
    const location = getLocationKey(control.loc);
    const clickProp = { ...prop, name: "onClick" };
    const focused = guardCallbacks(
      getCallbacks(this.#getDispatches(control, "onFocus", prop)),
      `activated onFocus ${location}`,
      prop,
    );
    const dispatched = this.#getEventSequence(
      control,
      getDispatchedEvents(control, clickProp),
      prop,
      (event) => ({
        captured: this.#getAncestorCallbacks(control, `${event}${CAPTURE_SUFFIX}`),
        bubbled: this.#getAncestorCallbacks(control, event),
      }),
    );
    const activated = [
      ...getCallbacks(dispatched),
      ...this.#getDefaultActionCallbacks(control, clickProp, dispatched),
    ];
    if (focused.length > 0)
      this.#addCommitCallbacks(`activated:${location}`, activated.map(gate), control.loc);
    return [...focused, ...activated].map(gate);
  }

  #getLabelControls(label: JsxExpressionValue): JsxExpressionValue[] {
    const target = getAttribute(label, "htmlFor")?.value;
    const elements = [...this.#ancestorsByElement.keys()];
    if (target)
      return elements.filter((element) => {
        const id = getAttribute(element, "id")?.value;
        return id !== undefined && getValueKey(id) === getValueKey(target);
      });
    return elements.filter(
      (element) => isLabelable(element) && this.#getAncestors(element).includes(label),
    );
  }

  #getChain(
    name: string,
    targetCallbacks: SymbolicValue[],
    ancestors: JsxExpressionValue[],
    prop: JsxProp,
  ): Dispatch[] {
    const getEnabledCallbacks = (ancestor: JsxExpressionValue, eventName: string) =>
      this.#getAncestorCallbacks(ancestor, eventName).map((callback) =>
        isMouseBlockedEvent(eventName)
          ? getRenderedBranch(getEnabledGuards(ancestor), callback, UNDEFINED_VALUE, prop)
          : callback,
      );
    return [
      ...ancestors.flatMap((ancestor) =>
        ancestor.tag.kind === "BuiltinTag"
          ? getEnabledCallbacks(ancestor, `${name}${CAPTURE_SUFFIX}`).map(this.#dispatch)
          : this.#getWrapperDispatches(ancestor, [`${name}${CAPTURE_SUFFIX}`]),
      ),
      ...targetCallbacks.map(this.#dispatch),
      ...[...ancestors].reverse().flatMap((ancestor) => {
        if (ancestor.tag.kind !== "BuiltinTag")
          return [
            ...this.#getWrapperDispatches(ancestor, [name]),
            ...guardCallbacks(
              this.#getComponentCallbacks(ancestor),
              `wrapper ${name} ${getLocationKey(ancestor.loc)}`,
              prop,
            ).map(this.#dispatch),
          ];
        const callbacks = getEnabledCallbacks(ancestor, name);
        return (
          MAYBE_BUBBLING_EVENTS.has(name)
            ? guardCallbacks(callbacks, `bubbled ${name} ${getLocationKey(ancestor.loc)}`, prop)
            : callbacks
        ).map(this.#dispatch);
      }),
    ];
  }

  #getWrapperDispatches(component: JsxExpressionValue, names: string[]): Dispatch[] {
    const hirFunction = this.#loadComponent(component);
    if (!hirFunction) return [];
    const isStopped = loadsInHandlers(hirFunction, new Set(names), "stopPropagation");
    const isPrevented = loadsInHandlers(hirFunction, new Set(names), "preventDefault");
    if (!isStopped && !isPrevented) return [];
    const marker = createUnknown(
      `wrapper ${names.join(" ")} ${getLocationKey(component.loc)}`,
      component.loc,
    );
    return [
      {
        callback: marker,
        stops: isStopped ? "maybe" : null,
        prevents: isPrevented ? "maybe" : null,
      },
    ];
  }

  #getDispatches(target: JsxExpressionValue, event: string, prop: JsxProp): Dispatch[] {
    return getReachedDispatches(
      this.#getChain(
        event,
        [
          ...this.#getAncestorCallbacks(target, `${event}${CAPTURE_SUFFIX}`),
          ...this.#getAncestorCallbacks(target, event),
        ],
        this.#getAncestors(target),
        prop,
      ),
      prop,
    );
  }

  #getEventSequence(
    element: JsxExpressionValue,
    events: string[],
    prop: JsxProp,
    getTargetCallbacks: (event: string) => TargetCallbacks,
  ): Dispatch[] {
    const ancestors = this.#getAncestors(element);
    const location = getLocationKey(element.loc);
    const isRadio = getCheckableType(element) === "radio";
    return events.reduce<Dispatch[]>((sequence, event, index) => {
      const target = getTargetCallbacks(event);
      const reached = getReachedDispatches(
        this.#getChain(event, [...target.captured, ...target.bubbled], ancestors, prop),
        prop,
      );
      if (event === "onInput" && index > 0) {
        const reason = `input ${location}`;
        const inputs = guardDispatches(
          gateByLoad(getPreventLoad(sequence), reached, (dispatches) =>
            guardDispatches(dispatches, reason, prop),
          ),
          reason,
          prop,
        );
        this.#addCommitCallbacks(`input:${location}`, getCallbacks(inputs), element.loc);
        return [...sequence, ...inputs];
      }
      if (event !== "onChange" || index === 0) return [...sequence, ...reached];
      const previous = events[index - 1];
      const stops = getSequenceLoad(
        [
          ...ancestors.flatMap((ancestor) =>
            ancestor.tag.kind === "BuiltinTag"
              ? this.#getAncestorCallbacks(ancestor, `${previous}${CAPTURE_SUFFIX}`)
              : [],
          ),
          ...getTargetCallbacks(previous).captured,
        ].map((callback) => this.#getEventLoads(callback).stops),
      );
      const isChangeHidden = stops === null && (isRadio || isTextInput(element));
      return [
        ...sequence,
        ...gateByLoad(isChangeHidden ? "maybe" : stops, reached, (dispatches) =>
          guardDispatches(dispatches, `changed ${location}`, prop),
        ),
      ];
    }, []);
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
    element: JsxExpressionValue,
    prop: JsxProp,
    callback: SymbolicValue,
  ): SymbolicValue[] {
    if (callback.kind === "ObjectExpression") return [];
    const ancestors = this.#getAncestors(element);
    const events = new Set(
      ancestors.flatMap((ancestor) =>
        ancestor.tag.kind === "BuiltinTag" ? ancestor.props.flatMap(getBubblingEvent) : [],
      ),
    );
    const before: SymbolicValue[] = [];
    const after: SymbolicValue[] = [];
    for (const event of events) {
      const reached = getCallbacks(
        getReachedDispatches(this.#getChain(event, [callback], ancestors, prop), prop),
      );
      const index = reached.indexOf(callback);
      if (index === -1) continue;
      const reason = `bubbled ${event} ${getHandlerKey(callback)}`;
      before.push(...guardCallbacks(reached.slice(0, index), reason, prop));
      after.push(...guardCallbacks(reached.slice(index + 1), reason, prop));
    }
    return before.length + after.length === 0 ? [] : [...before, callback, ...after];
  }

  #getDefaultActionCallbacks(
    element: JsxExpressionValue,
    prop: JsxProp,
    clicked: Dispatch[],
  ): SymbolicValue[] {
    if (prop.name !== "onClick") return [];
    const prevents = getPreventLoad(clicked);
    if (prevents === "always") return [];
    const getDefaultCallbacks = (
      owner: JsxExpressionValue | undefined,
      control: "always" | "maybe" | null,
      event: string,
      extra: SymbolicValue[] = [],
    ): SymbolicValue[] => {
      if (owner === undefined || control === null) return [];
      const callbacks = [...getCallbacks(this.#getDispatches(owner, event, prop)), ...extra];
      return gateByLoad(control === "maybe" ? "maybe" : prevents, callbacks, (gated) =>
        guardCallbacks(gated, `default ${event} ${getLocationKey(owner.loc)}`, prop),
      );
    };
    const path = [...this.#getAncestors(element), element];
    const activatorIndex = path.findLastIndex(
      (ancestor) => ancestor.tag.kind === "BuiltinTag" && ACTIVATABLE_TAGS.has(ancestor.tag.name),
    );
    const activator = path[activatorIndex];
    if (!activator) return [];
    if (activator.tag.name === "label")
      return this.#getActivationCallbacks(activator, prevents, prop);
    const form = this.#getOwnerForm(activator, path.slice(0, activatorIndex));
    return [
      ...getDefaultCallbacks(
        form,
        getSubmitControl(activator),
        "onSubmit",
        this.#getFormActions(form, activator),
      ),
      ...getDefaultCallbacks(form, getResetControl(activator), "onReset"),
    ].map((callback) =>
      getRenderedBranch(getEnabledGuards(activator), callback, UNDEFINED_VALUE, prop),
    );
  }

  #getFormActions(
    form: JsxExpressionValue | undefined,
    submitter: JsxExpressionValue,
  ): SymbolicValue[] {
    if (!form) return [];
    const submitterActions = this.#getAncestorCallbacks(submitter, "formAction");
    const actions =
      submitterActions.length > 0 ? submitterActions : this.#getAncestorCallbacks(form, "action");
    const prop = this.#getEventProp(form, "requestSubmit");
    return gateByLoad(
      getPreventLoad(this.#getDispatches(form, "onSubmit", prop)),
      actions,
      (callbacks) => guardCallbacks(callbacks, `action ${getLocationKey(form.loc)}`, prop),
    );
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

  #getAncestors(element: JsxExpressionValue): JsxExpressionValue[] {
    return this.#ancestorsByElement.get(element) ?? [];
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

  readonly #dispatch = (callback: SymbolicValue): Dispatch => ({
    callback,
    ...this.#getEventLoads(callback),
  });

  #getEventLoads(callback: SymbolicValue): EventLoads {
    if (callback.kind === "Bound") return this.#getEventLoads(callback.callee);
    if (callback.kind === "Conditional") {
      const consequent = this.#getEventLoads(callback.consequent);
      const alternate = this.#getEventLoads(callback.alternate);
      return {
        stops: getBranchLoad(consequent.stops, alternate.stops),
        prevents: getBranchLoad(consequent.prevents, alternate.prevents),
      };
    }
    if (callback.kind !== "Function") return NO_LOADS;
    const hirFunction = this.#interpreter.functions.get(callback.functionId);
    return hirFunction === null ? NO_LOADS : getFunctionLoads(hirFunction);
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
      argument: createTargetEvent([{ key: "value", value: createBindingValue(selected) }]),
      guards: [],
    };
  }

  #loadComponent(element: JsxExpressionValue): HIRFunction | null {
    return element.tag.kind === "Component" && element.tag.declaration
      ? this.#interpreter.loadProjectComponent(element.tag.declaration)
      : null;
  }

  #unwrapCallback(value: SymbolicValue): SymbolicValue {
    const resolved = this.#interpreter.resolveModuleFunction(getHeldValue(value));
    const isCallMember =
      resolved.kind === "Binding" && resolved.binding.kind === "call" && resolved.path.length > 0;
    const wrapped = isCallMember ? null : this.#interpreter.getWrappedCallbacks(resolved);
    if (!wrapped) return resolved;
    const [single] = wrapped;
    return wrapped.length === 1 && single
      ? single
      : { kind: "ArrayExpression", elements: wrapped, spreads: [] };
  }
}

const loadsInHandlers = (
  hirFunction: HIRFunction,
  names: ReadonlySet<string>,
  property: string,
): boolean => {
  const functions = new Map<IdentifierId, HIRFunction>();
  for (const block of hirFunction.body.blocks.values())
    for (const instruction of block.instructions) {
      const value = instruction.value;
      if (isFunctionCreation(value)) {
        if (loadsInHandlers(value.loweredFunc.func, names, property)) return true;
        functions.set(instruction.lvalue.identifier.id, value.loweredFunc.func);
      }
      if (value.kind === "StoreLocal") {
        const stored = functions.get(value.value.identifier.id);
        if (stored) functions.set(value.lvalue.place.identifier.id, stored);
      }
      const source =
        value.kind === "LoadLocal"
          ? value.place
          : value.kind === "CallExpression"
            ? value.args.find(
                (argument) =>
                  argument.kind === "Identifier" && functions.has(argument.identifier.id),
              )
            : undefined;
      const sourceFunction =
        source?.kind === "Identifier" ? functions.get(source.identifier.id) : undefined;
      if (sourceFunction) functions.set(instruction.lvalue.identifier.id, sourceFunction);
      if (value.kind !== "JsxExpression") continue;
      const isLoaded = value.props.some((prop) => {
        if (prop.kind !== "JsxAttribute" || !names.has(prop.name)) return false;
        const handler = functions.get(prop.place.identifier.id);
        return handler !== undefined && loadsProperty(handler, property);
      });
      if (isLoaded) return true;
    }
  return false;
};

const loadsProperty = (hirFunction: HIRFunction, property: string): boolean => {
  for (const block of hirFunction.body.blocks.values())
    for (const instruction of block.instructions) {
      const value = instruction.value;
      if (value.kind === "PropertyLoad" && value.property === property) return true;
      if (isFunctionCreation(value) && loadsProperty(value.loweredFunc.func, property)) return true;
    }
  return false;
};

const getFunctionLoad = (hirFunction: HIRFunction, property: string): Load => {
  if (!loadsProperty(hirFunction, property)) return null;
  const entry = hirFunction.body.blocks.get(hirFunction.body.entry);
  const isAlways = entry?.instructions.some(
    (instruction) =>
      instruction.value.kind === "PropertyLoad" && instruction.value.property === property,
  );
  return isAlways ? "always" : "maybe";
};

const getFunctionLoads = (hirFunction: HIRFunction): EventLoads => ({
  stops: getFunctionLoad(hirFunction, "stopPropagation"),
  prevents: getFunctionLoad(hirFunction, "preventDefault"),
});

const getElementAncestors = (
  render: SymbolicValue,
): Map<JsxExpressionValue, JsxExpressionValue[]> => {
  const ancestorsByElement = new Map<JsxExpressionValue, JsxExpressionValue[]>();
  const visited = new WeakSet<SymbolicValue>();
  const walk = (node: SymbolicValue, ancestors: JsxExpressionValue[]): void => {
    if (visited.has(node)) return;
    visited.add(node);
    if (node.kind === "JsxExpression") {
      ancestorsByElement.set(node, ancestors);
      forEachPropNode(node, (propNode) => walk(propNode, []));
    }
    const childAncestors = node.kind === "JsxExpression" ? [...ancestors, node] : ancestors;
    getRenderChildren(node).forEach((child) => walk(child, childAncestors));
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

const getCommitUpdates = (effects: Handler[]): StateUpdate[] => {
  const readIds = effects.map((effect) =>
    collectBindingIds(effect.updates.flatMap((update) => [update.value, ...update.guards])),
  );
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

const forgetPendingReads = (
  handlers: Handler[],
  pendingMutations: Binding[],
  bindings: Binding[],
): void => {
  const mutatedIds = new Set(pendingMutations.filter(isStateBinding).map((binding) => binding.id));
  if (mutatedIds.size === 0) return;
  const pendingIds = getDependentClosure(bindings, mutatedIds);
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
  const renderGuards = getRenderGuards(render);
  const collector = new HandlerCollector(interpreter, ancestorsByElement, renderGuards);
  interpreter.refEventDispatcher = (refId, methodName) =>
    collector.getRefEventCallbacks(refId, methodName);
  const wrappedCallbacks = collectWrappedCallbacks(render, interpreter);
  const effectCalls = interpreter.effectCalls.filter(
    (effectCall) => !wrappedCallbacks.has(effectCall.callback),
  );
  for (const [element, guards] of renderGuards) collector.planElementHandlers(element, guards);
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
      },
      effectCall.callback,
      effectCall.callbackArguments,
      effectCall.loc,
    );
  for (const commitCallback of collector.commitCallbacks.values())
    collector.addHandler(
      { kind: "Effect", hookKind: "Custom", dependencies: null },
      commitCallback.callback,
      [createUnknown("callback-argument", commitCallback.loc)],
      commitCallback.loc,
    );
  const suspenseUpdates = interpreter.bindingTable.bindings.flatMap((binding): StateUpdate[] =>
    binding.kind === "suspense"
      ? [{ binding, value: createUnknown("suspense", binding.loc), guards: [], isAsync: true }]
      : [],
  );
  collector.addCollectedHandler(
    { kind: "Effect", hookKind: "Custom", dependencies: null },
    { updates: suspenseUpdates, delegates: [], pendingMutations: [], assertions: [] },
    GeneratedSource,
  );
  const commitUpdates = getCommitUpdates(collector.handlers);
  collector.addCollectedHandler(
    { kind: "Effect", hookKind: "useEffect", dependencies: null },
    { updates: commitUpdates, delegates: [], pendingMutations: [], assertions: [] },
    GeneratedSource,
  );
  collector.addCollectedHandler({ kind: "Render" }, renderPhaseEffects, GeneratedSource);
  collector.runPlannedHandlers();
  const renderedIds = getInputClosure(
    interpreter.bindingTable.bindings,
    collectBindingIds([render]),
  );
  const isRendered = (binding: Binding): boolean =>
    (binding.kind !== "ref" && binding.kind !== "module") || renderedIds.has(binding.id);
  forgetPendingReads(
    collector.handlers,
    [...collector.pendingMutations.values()],
    interpreter.bindingTable.bindings,
  );
  revealPendingMutations(
    collector.handlers,
    [
      ...collector.pendingMutations.values(),
      ...interpreter.bindingTable.bindings.filter((binding) => binding.kind === "module"),
    ].filter(isRendered),
    interpreter.bindingTable.bindings.filter((binding) => binding.kind === "hook"),
  );
  for (const handler of collector.handlers)
    handler.updates = handler.updates.filter((update) => isRendered(update.binding));
  return collector.handlers;
};
