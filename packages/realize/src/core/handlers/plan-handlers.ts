import { GeneratedSource } from "../../react-compiler/HIR/HIR";
import type { SourceLocation } from "../../react-compiler/HIR/HIR";
import type { Interpreter } from "../interpret/interpret";
import type { CollectedEffects } from "../interpret/effect-collector";
import type {
  Binding,
  Handler,
  HandlerTrigger,
  JsxExpressionValue,
  JsxProp,
  JsxSpreadProp,
  JsxTag,
  ObjectExpressionValue,
  SymbolicValue,
} from "../types";
import { getValueKey } from "../values/get-value-key";
import { getLocationKey } from "../shared/get-location-key";
import { UNDEFINED_VALUE, createUnknown } from "../values/symbolic-values";
import { intersectGuards } from "./render-tree";
import { mayCallPropsOutsideEvents } from "./may-call-props-outside-events";
import { getHandlerKey } from "./handler-key";
import { getCallbacks } from "./event-loads";
import {
  addCommitCallbacks,
  createGuardedConditional,
  getBubbledCallbacks,
  getDispatches,
  getElementEventCallbacks,
  getEventProp,
  getIndependentCallbacks,
  getPropagatedCallbacks,
  getTargetEventCallbacks,
  guardCallbacks,
  loadComponent,
  unwrapCallback,
} from "./dom-dispatch";
import type { DomContext } from "./dom-dispatch";
import {
  ANY_EVENT,
  EVENT_ARGUMENT,
  getAttribute,
  getControlEvent,
  getEnabledGuards,
  getSelectEvent,
  getTriggerEvent,
  isDisabledEvent,
  isHandlerProp,
  isRefCallback,
} from "./dom-events";

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

export class HandlerCollector {
  readonly handlers: Handler[] = [];
  readonly pendingMutations = new Map<number, Binding>();
  readonly #interpreter: Interpreter;
  readonly #context: DomContext;
  readonly #plannedByKey = new Map<string | JsxSpreadProp, PlannedHandler>();
  readonly #idsByContent = new Map<string, string>();

  constructor(interpreter: Interpreter, context: DomContext) {
    this.#interpreter = interpreter;
    this.#context = context;
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
      addCommitCallbacks(
        this.#context,
        `autofocus:${location}`,
        getElementEventCallbacks(this.#context, element, "focus"),
        element.loc,
      );
    if (element.tag.kind !== "BuiltinTag" || element.tag.name !== "details") return;
    const toggleProp = getEventProp(this.#context, element, "onToggle");
    addCommitCallbacks(
      this.#context,
      `toggle:${location}`,
      guardCallbacks(
        getCallbacks(getDispatches(this.#context, element, "onToggle", toggleProp)),
        `toggle ${location}`,
        toggleProp,
      ),
      element.loc,
    );
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
    const unwrapped = unwrapCallback(this.#context, prop.value);
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
    const component = loadComponent(this.#context, element);
    if (component && mayCallPropsOutsideEvents(component))
      this.#context.commitCallbacks.set(callbackKey, { callback, loc: prop.loc });
    const propagated =
      element.tag.kind === "Component"
        ? getBubbledCallbacks(this.#context, element, prop, callback)
        : getPropagatedCallbacks(this.#context, element, prop, callback);
    const targeted =
      element.tag.kind === "BuiltinTag"
        ? getTargetEventCallbacks(this.#context, element, callback)
        : [];
    const sequence = [...(propagated.length > 0 ? propagated : [callback]), ...targeted];
    const handled: SymbolicValue =
      sequence.length > 1 ? { kind: "ArrayExpression", elements: sequence, spreads: [] } : callback;
    const handlerKey = getHandlerKey(handled);
    if (handlerKey === null) return;
    const isWrapped = callback !== prop.value;
    const controlEvent =
      getControlEvent(element, prop) ?? getSelectEvent(element, prop, this.#interpreter);
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
}
