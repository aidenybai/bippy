import type {
  InstructionId,
  Place,
  SourceLocation,
  SpreadPattern,
} from "../react-compiler/HIR/HIR";
import { GeneratedSource } from "../react-compiler/HIR/HIR";
import type { InstructionValueOfKind, Interpreter } from "./interpret";
import { UNDEFINED_VALUE, createBindingValue, createUnknown } from "./symbolic-values";
import type { ArrayExpressionValue, FunctionValue, SymbolicValue } from "./types";
import { getIdentifierName } from "./utils/get-identifier-name";
import { getKnownTruthiness } from "./utils/get-known-truthiness";
import { getValueKey } from "./utils/get-value-key";
import { getPlaceOrSpread } from "./utils/get-place-or-spread";
import type { WalkState } from "./walk-state";

export const RENDERED_ITERATION_METHODS = new Set(["map", "flatMap"]);

const MAX_LITERAL_ROWS = 32;

export const ITERATION_METHODS = new Set([
  "forEach",
  "map",
  "filter",
  "some",
  "every",
  "find",
  "flatMap",
]);

const FIRST_VALUE_METHODS = new Set(["every", "some", "find", "findIndex", "filter"]);

export class ArrayIteration {
  readonly #interpreter: Interpreter;

  constructor(interpreter: Interpreter) {
    this.#interpreter = interpreter;
  }

  visitItemCallback(
    methodName: string,
    callback: SymbolicValue | undefined,
    methodCall: InstructionValueOfKind<"MethodCall">,
    walkState: WalkState,
  ): void {
    if (callback?.kind !== "Function") return;
    const [itemParameter] = this.#interpreter.functions.get(callback.functionId)?.params ?? [];
    if (itemParameter?.kind === "Identifier")
      this.#interpreter
        .getCompilationTables()
        .aliasSources.set(itemParameter.identifier.id, methodCall.receiver);
    if (!this.#interpreter.handlerEffects && methodName === "forEach")
      this.#interpreter.callFunction(
        callback,
        this.#interpreter.callbacks.getUnknownArguments(callback),
        methodCall.loc,
        walkState,
      );
  }

  callForEachItem(
    callback: FunctionValue,
    array: ArrayExpressionValue,
    loc: SourceLocation,
    walkState: WalkState,
  ): SymbolicValue[] {
    const items = [...array.elements, ...array.spreads.map(() => createUnknown("item", loc))];
    return items.map((item, itemIndex) =>
      this.#interpreter.callFunction(
        callback,
        [item, { kind: "Primitive", value: itemIndex }, array],
        loc,
        walkState,
      ),
    );
  }

  getLiteralResult(
    methodName: string,
    array: ArrayExpressionValue,
    results: SymbolicValue[],
  ): SymbolicValue | null {
    if (array.spreads.length > 0) return null;
    if (methodName === "map") return { kind: "ArrayExpression", elements: results, spreads: [] };
    const outcomes = results.map(getKnownTruthiness);
    if (outcomes.some((outcome) => outcome === null)) return null;
    if (methodName === "filter")
      return {
        kind: "ArrayExpression",
        elements: array.elements.filter((_element, index) => outcomes[index]),
        spreads: [],
      };
    if (methodName === "some") return { kind: "Primitive", value: outcomes.includes(true) };
    if (methodName === "every") return { kind: "Primitive", value: !outcomes.includes(false) };
    return null;
  }

  getFirstValue(
    methodName: string,
    receiver: SymbolicValue,
    callback: SymbolicValue | undefined,
    loc: SourceLocation,
    walkState: WalkState,
  ): SymbolicValue | null {
    const initial =
      receiver.kind === "Binding" && receiver.path.length === 0 ? receiver.binding.initial : null;
    const isLiteralArray = initial?.kind === "ArrayExpression" && initial.spreads.length === 0;
    if (!isLiteralArray || callback?.kind !== "Function" || !FIRST_VALUE_METHODS.has(methodName))
      return null;
    const outcomes: boolean[] = [];
    for (const [index, element] of initial.elements.entries()) {
      const result = this.#interpreter.callFunction(
        callback,
        [element, { kind: "Primitive", value: index }],
        loc,
        walkState,
      );
      if (result.kind !== "Primitive") return null;
      outcomes.push(Boolean(result.value));
    }
    const firstIndex = outcomes.indexOf(true);
    switch (methodName) {
      case "every":
        return { kind: "Primitive", value: outcomes.every(Boolean) };
      case "some":
        return { kind: "Primitive", value: firstIndex !== -1 };
      case "findIndex":
        return { kind: "Primitive", value: firstIndex };
      case "find":
        return initial.elements[firstIndex] ?? UNDEFINED_VALUE;
      default:
        return {
          kind: "ArrayExpression",
          elements: initial.elements.filter((_element, index) => outcomes[index]),
          spreads: [],
        };
    }
  }

  evaluateArrayFind(
    methodName: string,
    array: SymbolicValue,
    callback: SymbolicValue | undefined,
    instructionId: InstructionId,
    loc: SourceLocation,
    walkState: WalkState,
  ): SymbolicValue | null {
    const isLiteralFind =
      methodName === "find" &&
      array.kind === "ArrayExpression" &&
      array.spreads.length === 0 &&
      callback?.kind === "Function";
    if (!isLiteralFind) return null;
    const openMatches: Array<[SymbolicValue, SymbolicValue]> = [];
    const chooseFirstMatch = (fallback: SymbolicValue): SymbolicValue =>
      openMatches.reduceRight<SymbolicValue>(
        (rest, [test, element]) => ({
          kind: "Conditional",
          test,
          testKind: "truthy",
          consequent: element,
          alternate: rest,
          branch: this.#interpreter.createBranch(instructionId, loc, "none"),
          guardKeys: walkState.guards.map(getValueKey),
        }),
        fallback,
      );
    for (const [index, element] of array.elements.entries()) {
      const matched = this.#interpreter.callFunction(
        callback,
        [element, { kind: "Primitive", value: index }, array],
        loc,
        walkState,
      );
      if (matched.kind !== "Primitive") openMatches.push([matched, element]);
      if (matched.kind === "Primitive" && matched.value) return chooseFirstMatch(element);
    }
    return chooseFirstMatch(UNDEFINED_VALUE);
  }

  evaluateArrayFrom(
    callee: SymbolicValue,
    argumentValues: SymbolicValue[],
    loc: SourceLocation,
    walkState: WalkState,
  ): SymbolicValue | null {
    const [arrayLike, callback] = argumentValues;
    const isRenderedArrayFrom =
      this.#interpreter.handlerEffects === null &&
      callee.kind === "Global" &&
      callee.name === "Array.from" &&
      callee.module === null;
    if (!isRenderedArrayFrom || !arrayLike || callback?.kind !== "Function") return null;
    return this.evaluateArrayMap(arrayLike, callback, loc, walkState);
  }

  evaluateArrayMap(
    array: SymbolicValue,
    callback: FunctionValue,
    loc: SourceLocation,
    walkState: WalkState,
    isFlat = false,
  ): SymbolicValue {
    const isLiteralRows =
      !isFlat &&
      array.kind === "ArrayExpression" &&
      array.spreads.length === 0 &&
      array.elements.length <= MAX_LITERAL_ROWS;
    const position = loc === GeneratedSource ? "generated" : loc.start.index;
    if (isLiteralRows)
      return {
        kind: "ArrayExpression",
        elements: array.elements.map((element, index) =>
          this.#interpreter.withBindingScope(`row:${position}:${index}`, () =>
            this.#interpreter.callFunction(
              callback,
              [element, { kind: "Primitive", value: index }, array],
              loc,
              walkState,
            ),
          ),
        ),
        spreads: [],
      };
    const [itemParameter, indexParameter] =
      this.#interpreter.functions.get(callback.functionId)?.params ?? [];
    const item = this.#createItemValue(itemParameter, "item", loc, array);
    const index = this.#createItemValue(indexParameter, "index", loc, array);
    return {
      kind: "ArrayMap",
      array,
      item: this.#interpreter.callFunction(callback, [item, index, array], loc, walkState),
      loc,
    };
  }

  #createItemValue(
    parameter: Place | SpreadPattern | undefined,
    fallbackName: string,
    loc: SourceLocation,
    array: SymbolicValue,
  ): SymbolicValue {
    const place = parameter ? getPlaceOrSpread(parameter) : null;
    if (!place) return createUnknown(fallbackName, loc);
    const binding = this.#interpreter.createBinding(
      getIdentifierName(place) ?? fallbackName,
      "item",
      place.loc,
    );
    this.#interpreter.addItemSource(binding, array);
    return createBindingValue(binding);
  }

  evaluateLoadedArrayMap(
    call: InstructionValueOfKind<"CallExpression">,
    argumentValues: SymbolicValue[],
    walkState: WalkState,
  ): SymbolicValue | null {
    const methodName = this.#interpreter.getPropertyName(call.callee);
    const receiverPlace = this.#interpreter.getPropertyObject(call.callee);
    const [callback] = argumentValues;
    const isRenderedMap =
      this.#interpreter.handlerEffects === null &&
      methodName !== null &&
      RENDERED_ITERATION_METHODS.has(methodName) &&
      receiverPlace !== undefined &&
      callback?.kind === "Function";
    return isRenderedMap
      ? this.evaluateArrayMap(
          this.#interpreter.read(receiverPlace),
          callback,
          call.loc,
          walkState,
          methodName === "flatMap",
        )
      : null;
  }
}
