import type { SourceFile } from "typescript/unstable/ast";
import { GeneratedSource } from "../hir/hir.js";
import type { SourceLocation } from "../hir/hir.js";
import type { SymbolicEvaluator } from "./symbolic-evaluator.js";
import type { SymbolicValue, Transition, TransitionTrigger } from "./types.js";
import { forEachJsxElement } from "./values.js";

const EVENT_HANDLER_PATTERN = /^on[A-Z]/;

const getHandlerKey = (value: SymbolicValue): string | null => {
  switch (value.kind) {
    case "Function":
      return `function:${value.functionId}`;
    case "Setter":
      return `setter:${value.binding.id}`;
    case "Binding":
      return value.binding.kind === "prop"
        ? `prop:${value.binding.id}:${value.path.join(".")}`
        : null;
    default:
      return null;
  }
};

const getHandlerLocation = (value: SymbolicValue): SourceLocation => {
  if (value.kind === "Function") return value.loc;
  if (value.kind === "Setter" || value.kind === "Binding") return value.binding.loc;
  return GeneratedSource;
};

const getSourceText = (sourceFile: SourceFile, loc: SourceLocation | null): string | null =>
  loc === null || loc === GeneratedSource
    ? null
    : sourceFile.text.slice(loc.start, loc.end).replace(/\s+/g, " ").trim();

/**
 * Finds every event handler in the render tree and every effect, and records what each one
 * does to state. Handlers reached from several places in the tree are one transition, and
 * each JSX attribute that holds one is linked to it by `transitionId`.
 */
export const inferTransitions = (
  render: SymbolicValue,
  evaluator: SymbolicEvaluator,
  sourceFile: SourceFile,
): Transition[] => {
  const transitions: Transition[] = [];
  const transitionIds = new Map<string, string | null>();

  const addTransition = (
    trigger: TransitionTrigger,
    handler: SymbolicValue,
    args: SymbolicValue[],
    loc: SourceLocation,
  ): string | null => {
    const { updates, delegates } = evaluator.collectEffects(handler, args);
    if (updates.length === 0 && delegates.length === 0) return null;
    const id = `t${transitions.length + 1}`;
    transitions.push({ id, trigger, updates, delegates, loc });
    return id;
  };

  for (const effectCall of evaluator.effectCalls) {
    const trigger: TransitionTrigger = {
      kind: "Effect",
      hookKind: effectCall.hookKind,
      dependencies: getSourceText(sourceFile, effectCall.dependencies),
    };
    addTransition(trigger, effectCall.callback, [], effectCall.loc);
  }
  forEachJsxElement(render, (element) => {
    for (const prop of element.props) {
      if (prop.kind !== "JsxAttribute" || !EVENT_HANDLER_PATTERN.test(prop.name)) continue;
      const key = getHandlerKey(prop.value);
      if (key === null) continue;
      if (!transitionIds.has(key)) {
        const trigger: TransitionTrigger = {
          kind: "Event",
          tag: element.tag.name,
          event: prop.name,
        };
        const event: SymbolicValue = { kind: "Unknown", reason: "event", loc: GeneratedSource };
        transitionIds.set(
          key,
          addTransition(trigger, prop.value, [event], getHandlerLocation(prop.value)),
        );
      }
      prop.transitionId = transitionIds.get(key) ?? null;
    }
  });
  return transitions;
};
