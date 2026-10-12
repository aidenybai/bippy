import type { SourceFile } from "typescript/unstable/ast";
import { GeneratedSource } from "../react-compiler/HIR/HIR.js";
import type { SourceLocation } from "../react-compiler/HIR/HIR.js";
import type { Interpreter } from "./interpret.js";
import type { SymbolicValue, Handler, HandlerTrigger, JsxProp, JsxTag } from "./types.js";
import { forEachJsxElement } from "./utils/traverse.js";

const EVENT_HANDLER_PATTERN = /^on[A-Z]/;

/** The event of a handler that spread props may install: any of them. */
export const ANY_EVENT = "*";

/**
 * Whether a prop holds a handler: one named like an event, or a setter or function passed to
 * a component under any name, like `setSearchTerm`, which the component may call.
 */
const isHandlerProp = (tag: JsxTag, prop: JsxProp): boolean =>
  EVENT_HANDLER_PATTERN.test(prop.name) ||
  (tag.kind !== "BuiltinTag" && (prop.value.kind === "Setter" || prop.value.kind === "Function"));

const getHandlerKey = (value: SymbolicValue): string | null => {
  switch (value.kind) {
    case "Function":
      return `function:${value.functionId}`;
    case "Setter":
      return `setter:${value.binding.id}`;
    case "Binding":
      return value.binding.kind === "prop" ||
        value.binding.kind === "hook" ||
        value.binding.kind === "context"
        ? `binding:${value.binding.id}:${value.path.join(".")}`
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
    : sourceFile.text.slice(loc.start.index, loc.end.index).replace(/\s+/g, " ").trim();

/**
 * Finds every event handler in the render tree and every effect, and records what each one
 * does to state. Handlers reached from several places in the tree are one handler, and
 * each JSX attribute that holds one is linked to it by `handlerId`.
 */
export const collectHandlers = (
  render: SymbolicValue,
  interpreter: Interpreter,
  sourceFile: SourceFile,
): Handler[] => {
  const handlers: Handler[] = [];
  const handlerIds = new Map<string, string | null>();

  const addTransition = (
    trigger: HandlerTrigger,
    handler: SymbolicValue,
    args: SymbolicValue[],
    loc: SourceLocation,
  ): string | null => {
    const { updates, delegates } = interpreter.collectEffects(handler, args);
    if (updates.length === 0 && delegates.length === 0) return null;
    const id = `t${handlers.length + 1}`;
    handlers.push({ id, trigger, updates, delegates, loc });
    return id;
  };

  for (const effectCall of interpreter.effectCalls) {
    const trigger: HandlerTrigger = {
      kind: "Effect",
      hookKind: effectCall.hookKind,
      dependencies: getSourceText(sourceFile, effectCall.dependencies),
    };
    addTransition(trigger, effectCall.callback, effectCall.args, effectCall.loc);
  }
  forEachJsxElement(render, (element) => {
    for (const prop of element.props) {
      if (prop.kind === "JsxSpreadAttribute") {
        if (prop.value.kind !== "Unknown") continue;
        prop.handlerId = addTransition(
          { kind: "Event", tag: element.tag.name, event: ANY_EVENT },
          prop.value,
          [],
          prop.value.loc,
        );
        continue;
      }
      if (!isHandlerProp(element.tag, prop)) continue;
      const key = getHandlerKey(prop.value);
      if (key === null) continue;
      if (!handlerIds.has(key)) {
        const trigger: HandlerTrigger = {
          kind: "Event",
          tag: element.tag.name,
          event: prop.name,
        };
        const event: SymbolicValue = { kind: "Unknown", reason: "event", loc: GeneratedSource };
        handlerIds.set(
          key,
          addTransition(trigger, prop.value, [event], getHandlerLocation(prop.value)),
        );
      }
      prop.handlerId = handlerIds.get(key) ?? null;
    }
  });
  return handlers;
};
