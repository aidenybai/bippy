import type { HIRFunction, SourceLocation } from "../../react-compiler/HIR/HIR";
import type { Interpreter } from "../interpret/interpret";
import type { JsxExpressionValue, JsxProp, SymbolicValue } from "../types";
import { getValueKey } from "../values/get-value-key";
import { getLocationKey } from "../shared/get-location-key";
import { UNDEFINED_VALUE, createUnknown, getContainedValues } from "../values/symbolic-values";
import { getAncestors, getDescendants } from "./render-tree";
import type { RenderTree } from "./render-tree";
import { getTargetMethodCalls } from "./get-target-method-calls";
import { getHandlerKey } from "./handler-key";
import {
  NO_LOADS,
  gateByLoad,
  getBranchLoad,
  getCallbacks,
  getFunctionLoads,
  getPreventLoad,
  getSequenceLoad,
  loadsInHandlers,
  weaken,
} from "./event-loads";
import type { Dispatch, EventLoads, Load } from "./event-loads";
import {
  ACTIVATABLE_TAGS,
  CAPTURE_SUFFIX,
  ENTER_EVENTS,
  EVENT_HANDLER_PATTERN,
  INTERACTIVE_TAGS,
  LEAVE_EVENTS,
  MAYBE_BUBBLING_EVENTS,
  NON_BUBBLING_EVENTS,
  REF_METHOD_EVENTS,
  getAttribute,
  getBaseEvent,
  getBubblingEvent,
  getCheckableType,
  getDispatchedEvents,
  getEnabledGuards,
  getHeldValue,
  getResetControl,
  getSubmitControl,
  isHandlerProp,
  isLabelable,
  isMouseBlockedEvent,
  isTextInput,
} from "./dom-events";

export interface DomContext {
  interpreter: Interpreter;
  tree: RenderTree;
  consumerCallbacks: Map<JsxExpressionValue, Set<SymbolicValue>>;
  commitCallbacks: Map<string, CommitCallback>;
}

export interface CommitCallback {
  callback: SymbolicValue;
  loc: SourceLocation;
}

interface TargetCallbacks {
  captured: SymbolicValue[];
  bubbled: SymbolicValue[];
}

export const getIndependentCallbacks = (value: SymbolicValue): SymbolicValue =>
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

export const createGuardedConditional = (
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

export const guardCallbacks = (
  callbacks: SymbolicValue[],
  reason: string,
  prop: JsxProp,
): SymbolicValue[] =>
  callbacks.map((callback) =>
    createGuardedConditional(createUnknown(reason, prop.loc), callback, UNDEFINED_VALUE, prop),
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

const addConsumerCallbacks = (context: DomContext): void => {
  const callbacksByAncestor = context.consumerCallbacks;
  for (const element of context.tree.elements) {
    if (element.tag.kind !== "Component" || element.tag.isContext) continue;
    const ancestors = getAncestors(context.tree, element);
    const provided = ancestors.flatMap((ancestor) =>
      ancestor.tag.kind === "Component" && ancestor.tag.isContext
        ? getAncestorCallbacks(context, ancestor, "value").flatMap((value) =>
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
};

export const addCommitCallbacks = (
  context: DomContext,
  key: string,
  callbacks: SymbolicValue[],
  loc: SourceLocation,
): void => {
  if (callbacks.length > 0)
    context.commitCallbacks.set(key, {
      callback: { kind: "ArrayExpression", elements: callbacks, spreads: [] },
      loc,
    });
};

export const getPropagatedCallbacks = (
  context: DomContext,
  element: JsxExpressionValue,
  prop: JsxProp,
  callback: SymbolicValue,
): SymbolicValue[] => {
  if (element.tag.kind !== "BuiltinTag" || !EVENT_HANDLER_PATTERN.test(prop.name)) return [];
  const ancestors = getAncestors(context.tree, element);
  if (ENTER_EVENTS.has(prop.name) || LEAVE_EVENTS.has(prop.name)) {
    const entered = ancestors.flatMap((ancestor) =>
      ancestor.tag.kind === "BuiltinTag"
        ? guardCallbacks(
            getAncestorCallbacks(context, ancestor, prop.name),
            `crossed ${prop.name} ${getLocationKey(ancestor.loc)}`,
            prop,
          )
        : [],
    );
    if (entered.length === 0) return [];
    return ENTER_EVENTS.has(prop.name) ? [...entered, callback] : [callback, ...entered.reverse()];
  }
  const isCapture = prop.name.endsWith(CAPTURE_SUFFIX);
  const eventProp = isCapture ? { ...prop, name: getBaseEvent(prop.name) } : prop;
  if (NON_BUBBLING_EVENTS.has(eventProp.name)) return [];
  const consumers = guardCallbacks(
    [...(context.consumerCallbacks.get(element) ?? [])],
    `consumer ${prop.name} ${getLocationKey(element.loc)}`,
    prop,
  );
  const clicked = getEventSequence(
    context,
    element,
    getDispatchedEvents(element, eventProp),
    prop,
    (event) => {
      const isProp = event === eventProp.name;
      return {
        captured:
          isProp && isCapture
            ? [callback]
            : getAncestorCallbacks(context, element, `${event}${CAPTURE_SUFFIX}`),
        bubbled:
          isProp && !isCapture
            ? [...consumers, callback]
            : getAncestorCallbacks(context, element, event),
      };
    },
  );
  const descendants = getDescendants(context.tree, element);
  const getDescendantDispatches = () =>
    descendants.flatMap((descendant) => [
      ...getWrapperDispatches(context, descendant, [
        eventProp.name,
        `${eventProp.name}${CAPTURE_SUFFIX}`,
      ]),
      ...getAncestorCallbacks(context, descendant, eventProp.name).map((callback) =>
        dispatch(context, callback),
      ),
      ...getAncestorCallbacks(context, descendant, `${eventProp.name}${CAPTURE_SUFFIX}`).map(
        (callback) => dispatch(context, callback),
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
  const defaults = getDefaultActionCallbacks(context, element, eventProp, clicked);
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
};

export const getRefEventCallbacks = (
  context: DomContext,
  refId: number,
  methodName: string,
): SymbolicValue[] => {
  const element = context.tree.elements.find((candidate) =>
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
    return getElementEventCallbacks(context, element, methodName);
  return guardCallbacks(
    getComponentCallbacks(context, element),
    `ref ${methodName} ${getLocationKey(element.loc)}`,
    getEventProp(context, element, methodName),
  );
};

export const getTargetEventCallbacks = (
  context: DomContext,
  element: JsxExpressionValue,
  callback: SymbolicValue,
): SymbolicValue[] => {
  if (callback.kind !== "Function") return [];
  const hirFunction = context.interpreter.functions.get(callback.functionId);
  if (!hirFunction) return [];
  return getTargetMethodCalls(hirFunction).flatMap((call) => {
    const target = call.isForm
      ? getOwnerForm(context, element, getAncestors(context.tree, element))
      : element;
    if (!target) return [];
    return guardCallbacks(
      getElementEventCallbacks(context, target, call.methodName),
      `target ${call.methodName} ${getLocationKey(element.loc)}`,
      getEventProp(context, target, call.methodName),
    );
  });
};

export const getEventProp = (
  context: DomContext,
  element: JsxExpressionValue,
  methodName: string,
): JsxProp => {
  return {
    kind: "JsxAttribute",
    name: REF_METHOD_EVENTS.get(methodName) ?? methodName,
    value: UNDEFINED_VALUE,
    handlerId: null,
    loc: element.loc,
    file: context.interpreter.resolver.fileName,
  };
};

export const getElementEventCallbacks = (
  context: DomContext,
  element: JsxExpressionValue,
  methodName: string,
): SymbolicValue[] => {
  const event = REF_METHOD_EVENTS.get(methodName);
  if (!event || element.tag.kind !== "BuiltinTag") return [];
  const prop = getEventProp(context, element, methodName);
  const [callback = UNDEFINED_VALUE] = getAncestorCallbacks(context, element, event);
  const propagated = getPropagatedCallbacks(context, element, prop, callback);
  const callbacks = propagated.length > 0 ? propagated : [callback];
  return event === "onFocus" || event === "onBlur"
    ? guardCallbacks(callbacks, `${methodName} ${getLocationKey(element.loc)}`, prop)
    : callbacks;
};

const getActivationCallbacks = (
  context: DomContext,
  label: JsxExpressionValue,
  prevents: Load,
  prop: JsxProp,
): SymbolicValue[] => {
  const labelKeys = new Set(getRenderGuards(context, label).map(getValueKey));
  const getControlGuards = (control: JsxExpressionValue) =>
    getRenderGuards(context, control).filter((guard) => !labelKeys.has(getValueKey(guard)));
  const controls = getLabelControls(context, label);
  const renderedIndex = controls.findIndex((control) => getControlGuards(control).length === 0);
  const sequence = controls
    .slice(0, renderedIndex === -1 ? controls.length : renderedIndex + 1)
    .flatMap((control, index) =>
      getControlActivation(context, control, prop, (callback) =>
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
};

const getControlActivation = (
  context: DomContext,
  control: JsxExpressionValue,
  prop: JsxProp,
  gate: (callback: SymbolicValue) => SymbolicValue,
): SymbolicValue[] => {
  const location = getLocationKey(control.loc);
  const clickProp = { ...prop, name: "onClick" };
  const focused = guardCallbacks(
    getCallbacks(getDispatches(context, control, "onFocus", prop)),
    `activated onFocus ${location}`,
    prop,
  );
  const dispatched = getEventSequence(
    context,
    control,
    getDispatchedEvents(control, clickProp),
    prop,
    (event) => ({
      captured: getAncestorCallbacks(context, control, `${event}${CAPTURE_SUFFIX}`),
      bubbled: getAncestorCallbacks(context, control, event),
    }),
  );
  const activated = [
    ...getCallbacks(dispatched),
    ...getDefaultActionCallbacks(context, control, clickProp, dispatched),
  ];
  if (focused.length > 0)
    addCommitCallbacks(context, `activated:${location}`, activated.map(gate), control.loc);
  return [...focused, ...activated].map(gate);
};

const getLabelControls = (context: DomContext, label: JsxExpressionValue): JsxExpressionValue[] => {
  const target = getAttribute(label, "htmlFor")?.value;
  const elements = context.tree.elements;
  if (target)
    return elements.filter((element) => {
      const id = getAttribute(element, "id")?.value;
      return id !== undefined && getValueKey(id) === getValueKey(target);
    });
  return elements.filter(
    (element) => isLabelable(element) && getAncestors(context.tree, element).includes(label),
  );
};

const getChain = (
  context: DomContext,
  name: string,
  targetCallbacks: SymbolicValue[],
  ancestors: JsxExpressionValue[],
  prop: JsxProp,
): Dispatch[] => {
  const getEnabledCallbacks = (ancestor: JsxExpressionValue, eventName: string) =>
    getAncestorCallbacks(context, ancestor, eventName).map((callback) =>
      isMouseBlockedEvent(eventName)
        ? getRenderedBranch(getEnabledGuards(ancestor), callback, UNDEFINED_VALUE, prop)
        : callback,
    );
  return [
    ...ancestors.flatMap((ancestor) =>
      ancestor.tag.kind === "BuiltinTag"
        ? getEnabledCallbacks(ancestor, `${name}${CAPTURE_SUFFIX}`).map((callback) =>
            dispatch(context, callback),
          )
        : getWrapperDispatches(context, ancestor, [`${name}${CAPTURE_SUFFIX}`]),
    ),
    ...targetCallbacks.map((callback) => dispatch(context, callback)),
    ...[...ancestors].reverse().flatMap((ancestor) => {
      if (ancestor.tag.kind !== "BuiltinTag")
        return [
          ...getWrapperDispatches(context, ancestor, [name]),
          ...guardCallbacks(
            getComponentCallbacks(context, ancestor),
            `wrapper ${name} ${getLocationKey(ancestor.loc)}`,
            prop,
          ).map((callback) => dispatch(context, callback)),
        ];
      const callbacks = getEnabledCallbacks(ancestor, name);
      return (
        MAYBE_BUBBLING_EVENTS.has(name)
          ? guardCallbacks(callbacks, `bubbled ${name} ${getLocationKey(ancestor.loc)}`, prop)
          : callbacks
      ).map((callback) => dispatch(context, callback));
    }),
  ];
};

const getWrapperDispatches = (
  context: DomContext,
  component: JsxExpressionValue,
  names: string[],
): Dispatch[] => {
  const hirFunction = loadComponent(context, component);
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
};

export const getDispatches = (
  context: DomContext,
  target: JsxExpressionValue,
  event: string,
  prop: JsxProp,
): Dispatch[] => {
  return getReachedDispatches(
    getChain(
      context,
      event,
      [
        ...getAncestorCallbacks(context, target, `${event}${CAPTURE_SUFFIX}`),
        ...getAncestorCallbacks(context, target, event),
      ],
      getAncestors(context.tree, target),
      prop,
    ),
    prop,
  );
};

const getEventSequence = (
  context: DomContext,
  element: JsxExpressionValue,
  events: string[],
  prop: JsxProp,
  getTargetCallbacks: (event: string) => TargetCallbacks,
): Dispatch[] => {
  const ancestors = getAncestors(context.tree, element);
  const location = getLocationKey(element.loc);
  const isRadio = getCheckableType(element) === "radio";
  return events.reduce<Dispatch[]>((sequence, event, index) => {
    const target = getTargetCallbacks(event);
    const reached = getReachedDispatches(
      getChain(context, event, [...target.captured, ...target.bubbled], ancestors, prop),
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
      addCommitCallbacks(context, `input:${location}`, getCallbacks(inputs), element.loc);
      return [...sequence, ...inputs];
    }
    if (event !== "onChange" || index === 0) return [...sequence, ...reached];
    const previous = events[index - 1];
    const stops = getSequenceLoad(
      [
        ...ancestors.flatMap((ancestor) =>
          ancestor.tag.kind === "BuiltinTag"
            ? getAncestorCallbacks(context, ancestor, `${previous}${CAPTURE_SUFFIX}`)
            : [],
        ),
        ...getTargetCallbacks(previous).captured,
      ].map((callback) => getEventLoads(context, callback).stops),
    );
    const isChangeHidden = stops === null && (isRadio || isTextInput(element));
    return [
      ...sequence,
      ...gateByLoad(isChangeHidden ? "maybe" : stops, reached, (dispatches) =>
        guardDispatches(dispatches, `changed ${location}`, prop),
      ),
    ];
  }, []);
};

const getComponentCallbacks = (
  context: DomContext,
  component: JsxExpressionValue,
): SymbolicValue[] => {
  const isWrapper =
    component.tag.kind === "Component" &&
    !component.tag.isContext &&
    component.tag.reactExport === null;
  if (!isWrapper) return [];
  return component.props
    .flatMap((prop) =>
      prop.kind === "JsxAttribute" && isHandlerProp(component.tag, prop)
        ? getContainedValues(getIndependentCallbacks(unwrapCallback(context, prop.value)))
        : [],
    )
    .filter((callback) => getHandlerKey(callback) !== null);
};

export const getBubbledCallbacks = (
  context: DomContext,
  element: JsxExpressionValue,
  prop: JsxProp,
  callback: SymbolicValue,
): SymbolicValue[] => {
  if (callback.kind === "ObjectExpression") return [];
  const ancestors = getAncestors(context.tree, element);
  const events = new Set(
    ancestors.flatMap((ancestor) =>
      ancestor.tag.kind === "BuiltinTag" ? ancestor.props.flatMap(getBubblingEvent) : [],
    ),
  );
  const before: SymbolicValue[] = [];
  const after: SymbolicValue[] = [];
  for (const event of events) {
    const reached = getCallbacks(
      getReachedDispatches(getChain(context, event, [callback], ancestors, prop), prop),
    );
    const index = reached.indexOf(callback);
    if (index === -1) continue;
    const reason = `bubbled ${event} ${getHandlerKey(callback)}`;
    before.push(...guardCallbacks(reached.slice(0, index), reason, prop));
    after.push(...guardCallbacks(reached.slice(index + 1), reason, prop));
  }
  return before.length + after.length === 0 ? [] : [...before, callback, ...after];
};

const getDefaultActionCallbacks = (
  context: DomContext,
  element: JsxExpressionValue,
  prop: JsxProp,
  clicked: Dispatch[],
): SymbolicValue[] => {
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
    const callbacks = [...getCallbacks(getDispatches(context, owner, event, prop)), ...extra];
    return gateByLoad(control === "maybe" ? "maybe" : prevents, callbacks, (gated) =>
      guardCallbacks(gated, `default ${event} ${getLocationKey(owner.loc)}`, prop),
    );
  };
  const path = [...getAncestors(context.tree, element), element];
  const activatorIndex = path.findLastIndex(
    (ancestor) => ancestor.tag.kind === "BuiltinTag" && ACTIVATABLE_TAGS.has(ancestor.tag.name),
  );
  const activator = path[activatorIndex];
  if (!activator) return [];
  if (activator.tag.name === "label")
    return getActivationCallbacks(context, activator, prevents, prop);
  const form = getOwnerForm(context, activator, path.slice(0, activatorIndex));
  return [
    ...getDefaultCallbacks(
      form,
      getSubmitControl(activator),
      "onSubmit",
      getFormActions(context, form, activator),
    ),
    ...getDefaultCallbacks(form, getResetControl(activator), "onReset"),
  ].map((callback) =>
    getRenderedBranch(getEnabledGuards(activator), callback, UNDEFINED_VALUE, prop),
  );
};

const getFormActions = (
  context: DomContext,
  form: JsxExpressionValue | undefined,
  submitter: JsxExpressionValue,
): SymbolicValue[] => {
  if (!form) return [];
  const submitterActions = getAncestorCallbacks(context, submitter, "formAction");
  const actions =
    submitterActions.length > 0 ? submitterActions : getAncestorCallbacks(context, form, "action");
  const prop = getEventProp(context, form, "requestSubmit");
  return gateByLoad(
    getPreventLoad(getDispatches(context, form, "onSubmit", prop)),
    actions,
    (callbacks) => guardCallbacks(callbacks, `action ${getLocationKey(form.loc)}`, prop),
  );
};

const getOwnerForm = (
  context: DomContext,
  element: JsxExpressionValue,
  ancestors: JsxExpressionValue[],
): JsxExpressionValue | undefined => {
  const formId = getAttribute(element, "form")?.value;
  if (formId === undefined)
    return ancestors.findLast(
      (ancestor) => ancestor.tag.kind === "BuiltinTag" && ancestor.tag.name === "form",
    );
  if (formId.kind !== "Primitive") return undefined;
  return context.tree.elements.find((candidate) => {
    const id = getAttribute(candidate, "id")?.value;
    return (
      candidate.tag.kind === "BuiltinTag" &&
      candidate.tag.name === "form" &&
      id?.kind === "Primitive" &&
      id.value === formId.value
    );
  });
};

const getRenderGuards = (context: DomContext, element: JsxExpressionValue): SymbolicValue[] => {
  const index = context.tree.indexes.get(element);
  return (index === undefined ? undefined : context.tree.guards[index]) ?? [];
};

const getAncestorCallbacks = (
  context: DomContext,
  ancestor: JsxExpressionValue,
  name: string,
): SymbolicValue[] => {
  return ancestor.props
    .flatMap((prop) =>
      prop.kind === "JsxAttribute" && prop.name === name
        ? [unwrapCallback(context, prop.value)]
        : [],
    )
    .filter((callback) => getHandlerKey(callback) !== null);
};

const dispatch = (context: DomContext, callback: SymbolicValue): Dispatch => ({
  callback,
  ...getEventLoads(context, callback),
});

const getEventLoads = (context: DomContext, callback: SymbolicValue): EventLoads => {
  if (callback.kind === "Bound") return getEventLoads(context, callback.callee);
  if (callback.kind === "Conditional") {
    const consequent = getEventLoads(context, callback.consequent);
    const alternate = getEventLoads(context, callback.alternate);
    return {
      stops: getBranchLoad(consequent.stops, alternate.stops),
      prevents: getBranchLoad(consequent.prevents, alternate.prevents),
    };
  }
  if (callback.kind !== "Function") return NO_LOADS;
  const hirFunction = context.interpreter.functions.get(callback.functionId);
  return hirFunction === null ? NO_LOADS : getFunctionLoads(hirFunction);
};

export const loadComponent = (
  context: DomContext,
  element: JsxExpressionValue,
): HIRFunction | null => {
  return element.tag.kind === "Component" && element.tag.declaration
    ? context.interpreter.loadProjectComponent(element.tag.declaration)
    : null;
};

export const unwrapCallback = (context: DomContext, value: SymbolicValue): SymbolicValue => {
  const resolved = context.interpreter.resolveModuleFunction(getHeldValue(value));
  const isCallMember =
    resolved.kind === "Binding" && resolved.binding.kind === "call" && resolved.path.length > 0;
  const wrapped = isCallMember ? null : context.interpreter.getWrappedCallbacks(resolved);
  if (!wrapped) return resolved;
  const [single] = wrapped;
  return wrapped.length === 1 && single
    ? single
    : { kind: "ArrayExpression", elements: wrapped, spreads: [] };
};

export const createDomContext = (interpreter: Interpreter, tree: RenderTree): DomContext => {
  const context: DomContext = {
    interpreter,
    tree,
    consumerCallbacks: new Map(),
    commitCallbacks: new Map(),
  };
  addConsumerCallbacks(context);
  return context;
};
