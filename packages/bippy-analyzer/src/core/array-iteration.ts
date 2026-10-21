import type { Place, SourceLocation, SpreadPattern } from "../react-compiler/HIR/HIR";
import type { InstructionValueOfKind, Interpreter } from "./interpret";
import { createBindingValue, createUnknown } from "./symbolic-values";
import type { ArrayExpressionValue, FunctionValue, SymbolicValue } from "./types";
import { getIdentifierName } from "./utils/get-identifier-name";
import { getPlaceOrSpread } from "./utils/get-place-or-spread";
import type { WalkState } from "./walk-state";

export const RENDERED_ITERATION_METHODS = new Set(["map", "flatMap"]);

export const ITERATION_METHODS = new Set([
  "forEach",
  "map",
  "filter",
  "some",
  "every",
  "find",
  "flatMap",
]);

export class ArrayIteration {
  readonly #interpreter: Interpreter;
  readonly #callbacksByMap = new WeakMap<SymbolicValue, FunctionValue>();

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
  ): void {
    const items = [...array.elements, ...array.spreads.map(() => createUnknown("item", loc))];
    items.forEach((item, itemIndex) =>
      this.#interpreter.callFunction(
        callback,
        [item, { kind: "Primitive", value: itemIndex }, array],
        loc,
        walkState,
      ),
    );
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
  ): SymbolicValue {
    const [itemParameter, indexParameter] =
      this.#interpreter.functions.get(callback.functionId)?.params ?? [];
    const item = this.#createItemValue(itemParameter, "item", loc);
    const index = this.#createItemValue(indexParameter, "index", loc);
    const mapped: SymbolicValue = {
      kind: "ArrayMap",
      array,
      item: this.#interpreter.callFunction(callback, [item, index, array], loc, walkState),
      loc,
    };
    this.#callbacksByMap.set(mapped, callback);
    return mapped;
  }

  getMapCallback(mapped: SymbolicValue): FunctionValue | null {
    return this.#callbacksByMap.get(mapped) ?? null;
  }

  #createItemValue(
    parameter: Place | SpreadPattern | undefined,
    fallbackName: string,
    loc: SourceLocation,
  ): SymbolicValue {
    const place = parameter ? getPlaceOrSpread(parameter) : null;
    return place
      ? createBindingValue(
          this.#interpreter.createBinding(
            getIdentifierName(place) ?? fallbackName,
            "item",
            place.loc,
          ),
        )
      : createUnknown(fallbackName, loc);
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
      ? this.evaluateArrayMap(this.#interpreter.read(receiverPlace), callback, call.loc, walkState)
      : null;
  }
}
