import { GeneratedSource } from "../../react-compiler/HIR/HIR";
import type { Interpreter } from "../interpret/interpret";
import type { CollectedEffects } from "../interpret/effect-collector";
import type { Binding, Handler, JsxExpressionValue, StateUpdate, SymbolicValue } from "../types";
import { mapSymbolicValue } from "../values/map-symbolic-value";
import { collectBindingIds, getDependentClosure, getInputClosure } from "../shared/binding-graph";
import { createBindingValue, createUnknown } from "../values/symbolic-values";
import { isStateBinding } from "../values/is-state-binding";
import { getRenderTree } from "./render-tree";
import { createDomContext, getRefEventCallbacks } from "./dom-dispatch";
import { HandlerCollector } from "./plan-handlers";
import { isHandlerProp } from "./dom-events";

const collectWrappedCallbacks = (
  elements: JsxExpressionValue[],
  interpreter: Interpreter,
): Set<SymbolicValue> => {
  const wrapped = new Set<SymbolicValue>();
  for (const element of elements)
    for (const prop of element.props) {
      if (prop.kind !== "JsxAttribute" || !isHandlerProp(element.tag, prop)) continue;
      for (const callback of interpreter.getWrappedCallbacks(prop.value) ?? [])
        wrapped.add(callback);
    }
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
  const tree = getRenderTree(render);
  const context = createDomContext(interpreter, tree);
  const collector = new HandlerCollector(interpreter, context);
  interpreter.refEventDispatcher = (refId, methodName) =>
    getRefEventCallbacks(context, refId, methodName);
  const wrappedCallbacks = collectWrappedCallbacks(tree.elements, interpreter);
  const effectCalls = interpreter.effectCalls.filter(
    (effectCall) => !wrappedCallbacks.has(effectCall.callback),
  );
  tree.elements.forEach((element, index) =>
    collector.planElementHandlers(element, tree.guards[index] ?? []),
  );
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
  for (const commitCallback of context.commitCallbacks.values())
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
