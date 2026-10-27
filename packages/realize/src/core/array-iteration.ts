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
import { negate } from "./utils/negate";
import { PlaceMap } from "./utils/place-map";
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

const SHORT_CIRCUIT_OUTCOMES = new Map([
  ["some", true],
  ["find", true],
  ["findIndex", true],
  ["every", false],
]);

const MAX_OPEN_FILTER_OUTCOMES = 4;

const TRUE_VALUE: SymbolicValue = { kind: "Primitive", value: true };

const FALSE_VALUE: SymbolicValue = { kind: "Primitive", value: false };

const DECLARED_NAME_PATTERN = /^(?:const|let|var)\s+([A-Za-z_$][\w$]*)$/;

const getDeclaredNameLoc = (
  sourceText: string | null,
  loc: SourceLocation,
): { name: string; loc: SourceLocation } | null => {
  const name = sourceText?.trim().match(DECLARED_NAME_PATTERN)?.[1];
  if (!name || !sourceText || typeof loc === "symbol" || loc.start.line !== loc.end.line)
    return null;
  const offset = sourceText.lastIndexOf(name);
  return {
    name,
    loc: {
      ...loc,
      start: { ...loc.start, column: loc.start.column + offset, index: loc.start.index + offset },
      end: {
        ...loc.end,
        column: loc.start.column + offset + name.length,
        index: loc.start.index + offset + name.length,
      },
    },
  };
};

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
    methodName: string,
    callback: FunctionValue,
    array: ArrayExpressionValue,
    loc: SourceLocation,
    walkState: WalkState,
  ): SymbolicValue[] {
    const items = [...array.elements, ...array.spreads.map(() => createUnknown("item", loc))];
    const stopsOn = SHORT_CIRCUIT_OUTCOMES.get(methodName);
    const results: SymbolicValue[] = [];
    let guards = walkState.guards;
    for (const [itemIndex, item] of items.entries()) {
      const result = this.#interpreter.callFunction(
        callback,
        [item, { kind: "Primitive", value: itemIndex }, array],
        loc,
        { ...walkState, guards },
      );
      results.push(result);
      if (stopsOn === undefined) continue;
      const truthiness = getKnownTruthiness(result);
      if (truthiness === stopsOn) break;
      if (truthiness === null) guards = [...guards, stopsOn ? negate(result) : result];
    }
    return results;
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
    instructionId: InstructionId,
    walkState: WalkState,
  ): SymbolicValue | null {
    const initial =
      receiver.kind === "Binding" && receiver.path.length === 0 ? receiver.binding.initial : null;
    const isLiteralArray = initial?.kind === "ArrayExpression" && initial.spreads.length === 0;
    if (!isLiteralArray || callback?.kind !== "Function" || !FIRST_VALUE_METHODS.has(methodName))
      return null;
    const { elements } = initial;
    const outcomes = elements.map((element, index) =>
      this.#interpreter.callFunction(
        callback,
        [element, { kind: "Primitive", value: index }],
        loc,
        walkState,
      ),
    );
    const select = (
      outcome: SymbolicValue,
      consequent: SymbolicValue,
      alternate: SymbolicValue,
      caseIndex: number,
    ): SymbolicValue => {
      const truthiness = getKnownTruthiness(outcome);
      if (truthiness !== null) return truthiness ? consequent : alternate;
      return {
        kind: "Conditional",
        test: outcome,
        testKind: "truthy",
        consequent,
        alternate,
        branch: this.#interpreter.createBranch(instructionId, loc, "none", caseIndex),
        guardKeys: [],
      };
    };
    const chain = (
      consequentAt: (index: number) => SymbolicValue,
      isFirstMatch: boolean,
      fallback: SymbolicValue,
    ): SymbolicValue =>
      outcomes.reduceRight<SymbolicValue>(
        (rest, outcome, index) =>
          isFirstMatch
            ? select(outcome, consequentAt(index), rest, index)
            : select(outcome, rest, consequentAt(index), index),
        fallback,
      );
    switch (methodName) {
      case "every":
        return chain(() => FALSE_VALUE, false, TRUE_VALUE);
      case "some":
        return chain(() => TRUE_VALUE, true, FALSE_VALUE);
      case "findIndex":
        return chain((index) => ({ kind: "Primitive", value: index }), true, {
          kind: "Primitive",
          value: -1,
        });
      case "find":
        return chain((index) => elements[index] ?? UNDEFINED_VALUE, true, UNDEFINED_VALUE);
      default: {
        const openCount = outcomes.filter((outcome) => getKnownTruthiness(outcome) === null).length;
        if (openCount > MAX_OPEN_FILTER_OUTCOMES) return null;
        const keep = (index: number, kept: SymbolicValue[]): SymbolicValue => {
          const outcome = outcomes[index];
          const element = elements[index];
          if (outcome === undefined || element === undefined)
            return { kind: "ArrayExpression", elements: kept, spreads: [] };
          return select(outcome, keep(index + 1, [...kept, element]), keep(index + 1, kept), index);
        };
        return keep(0, []);
      }
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
        (rest, [test, element], index) => ({
          kind: "Conditional",
          test,
          testKind: "truthy",
          consequent: element,
          alternate: rest,
          branch: this.#interpreter.createBranch(instructionId, loc, "none", index),
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

  createLoopItem(collection: SymbolicValue, loc: SourceLocation): SymbolicValue {
    const declaredLoc = getDeclaredNameLoc(this.#interpreter.resolver.getSourceText(loc), loc);
    if (!declaredLoc) return createUnknown("IteratorNext", loc);
    const inputPlaces = new PlaceMap<true>();
    this.#interpreter.collectInputPlaces(collection, inputPlaces);
    const binding = this.#interpreter.createBinding(declaredLoc.name, "item", declaredLoc.loc, {
      inputPlaces: inputPlaces.places(),
    });
    this.#interpreter.addItemSource(binding, collection);
    const item = createBindingValue(binding);
    this.#interpreter.addStoredFunctions(item, collection, false);
    if (collection.kind === "Binding")
      for (const stored of this.#interpreter.getStoredFunctions(collection))
        this.#interpreter.addStoredFunctions(item, stored, false);
    return item;
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
