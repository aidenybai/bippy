import type { Place, SourceLocation, SpreadPattern } from "../../react-compiler/HIR/HIR";
import { GeneratedSource } from "../../react-compiler/HIR/HIR";
import type { InstructionValueOfKind, Interpreter } from "./interpret";
import {
  UNDEFINED_VALUE,
  createBindingValue,
  createUnknown,
  getKnownTruthiness,
} from "../values/symbolic-values";
import type { ArrayExpressionValue, FunctionValue, SymbolicValue } from "../types";
import { getIdentifierName } from "./get-identifier-name";
import { negate } from "../values/negate";
import { getConditionalLeaves } from "../values/conditional";
import { PlaceMap } from "../values/place-map";
import { getPlaceOrSpread } from "./get-place-or-spread";
import type { PathState } from "./path-state";
import { isBuiltinMethod } from "./builtin-methods";

const MAX_LITERAL_ROWS = 32;

const SHORT_CIRCUIT_OUTCOMES = new Map([
  ["some", true],
  ["find", true],
  ["findIndex", true],
  ["every", false],
]);

const MAX_OPEN_FILTER_OUTCOMES = 4;

const TRUE_VALUE: SymbolicValue = { kind: "Primitive", value: true };

const FALSE_VALUE: SymbolicValue = { kind: "Primitive", value: false };

const getLoopElements = (collection: SymbolicValue): SymbolicValue[] =>
  getConditionalLeaves(collection).flatMap((leaf) => {
    const literal = leaf.kind === "Binding" && leaf.path.length === 0 ? leaf.binding.initial : leaf;
    return literal?.kind === "ArrayExpression" ? [...literal.elements, ...literal.spreads] : [leaf];
  });

export class ArrayIteration {
  readonly #interpreter: Interpreter;

  constructor(interpreter: Interpreter) {
    this.#interpreter = interpreter;
  }

  visitItemCallback(
    methodName: string,
    callback: SymbolicValue | undefined,
    methodCall: InstructionValueOfKind<"MethodCall">,
    pathState: PathState,
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
        pathState,
      );
  }

  callForEachItem(
    methodName: string,
    callback: FunctionValue,
    array: ArrayExpressionValue,
    loc: SourceLocation,
    pathState: PathState,
  ): SymbolicValue[] {
    const spreadItems = array.spreads.map((spread) =>
      spread.kind === "ArrayMap" && !spread.isFlat ? spread.item : createUnknown("item", loc),
    );
    const items = [...array.elements, ...spreadItems];
    const stopsOn = SHORT_CIRCUIT_OUTCOMES.get(methodName);
    const results: SymbolicValue[] = [];
    let guards = pathState.guards;
    for (const [itemIndex, item] of items.entries()) {
      const result = this.#interpreter.callFunction(
        callback,
        [item, { kind: "Primitive", value: itemIndex }, array],
        loc,
        { ...pathState, guards },
      );
      results.push(result);
      if (stopsOn === undefined) continue;
      const truthiness = itemIndex < array.elements.length ? getKnownTruthiness(result) : null;
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
    const truthinesses = results.map(getKnownTruthiness);
    if (truthinesses.includes(null)) return null;
    if (methodName === "filter")
      return {
        kind: "ArrayExpression",
        elements: array.elements.filter((_element, index) => truthinesses[index]),
        spreads: [],
      };
    if (methodName === "some") return { kind: "Primitive", value: truthinesses.includes(true) };
    if (methodName === "every") return { kind: "Primitive", value: !truthinesses.includes(false) };
    return null;
  }

  getFirstValue(
    methodName: string,
    receiver: SymbolicValue,
    argumentValues: SymbolicValue[],
    loc: SourceLocation,
    pathState: PathState,
  ): SymbolicValue | null {
    const [callback, accumulator] = argumentValues;
    const initial =
      receiver.kind === "Binding" && receiver.path.length === 0 ? receiver.binding.initial : null;
    const isLiteralArray = initial?.kind === "ArrayExpression" && initial.spreads.length === 0;
    if (
      !isLiteralArray ||
      callback?.kind !== "Function" ||
      !isBuiltinMethod(methodName, "firstValue")
    )
      return null;
    if (methodName === "reduce")
      return this.#reduce(initial.elements, callback, accumulator, loc, pathState, []);
    const tests = initial.elements.map((element, index) =>
      this.#interpreter.callFunction(
        callback,
        [element, { kind: "Primitive", value: index }],
        loc,
        pathState,
      ),
    );
    return this.getOpenResult(methodName, initial, tests, loc);
  }

  getOpenResult(
    methodName: string,
    array: ArrayExpressionValue,
    tests: SymbolicValue[],
    loc: SourceLocation,
  ): SymbolicValue | null {
    if (array.spreads.length > 0 || !isBuiltinMethod(methodName, "firstValue")) return null;
    const select = (
      test: SymbolicValue,
      consequent: SymbolicValue,
      alternate: SymbolicValue,
    ): SymbolicValue => {
      const truthiness = getKnownTruthiness(test);
      if (truthiness !== null) return truthiness ? consequent : alternate;
      return {
        kind: "Conditional",
        test,
        testKind: "truthy",
        consequent,
        alternate,
        branch: this.#interpreter.createBranchSite(loc),
      };
    };
    const chain = (
      consequentAt: (index: number) => SymbolicValue,
      isFirstMatch: boolean,
      fallback: SymbolicValue,
    ): SymbolicValue =>
      tests.reduceRight<SymbolicValue>(
        (rest, test, index) =>
          isFirstMatch
            ? select(test, consequentAt(index), rest)
            : select(test, rest, consequentAt(index)),
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
        return chain((index) => array.elements[index] ?? UNDEFINED_VALUE, true, UNDEFINED_VALUE);
      case "filter": {
        const openCount = tests.filter((test) => getKnownTruthiness(test) === null).length;
        if (openCount > MAX_OPEN_FILTER_OUTCOMES) return null;
        const keep = (index: number, kept: SymbolicValue[]): SymbolicValue => {
          const test = tests[index];
          const element = array.elements[index];
          if (test === undefined || element === undefined)
            return { kind: "ArrayExpression", elements: kept, spreads: [] };
          return select(test, keep(index + 1, [...kept, element]), keep(index + 1, kept));
        };
        return keep(0, []);
      }
      default:
        return null;
    }
  }

  #reduce(
    elements: SymbolicValue[],
    callback: FunctionValue,
    accumulator: SymbolicValue | undefined,
    loc: SourceLocation,
    pathState: PathState,
    trailingArguments: SymbolicValue[],
  ): SymbolicValue | null {
    const [first, ...rest] = elements;
    const start = accumulator ?? first;
    const remaining = accumulator ? elements : rest;
    if (!start) return null;
    const offset = elements.length - remaining.length;
    return remaining.reduce<SymbolicValue>(
      (total, element, index) =>
        this.#interpreter.callFunction(
          callback,
          [total, element, { kind: "Primitive", value: index + offset }, ...trailingArguments],
          loc,
          pathState,
        ),
      start,
    );
  }

  evaluateArrayFind(
    methodName: string,
    array: SymbolicValue,
    callback: SymbolicValue | undefined,
    loc: SourceLocation,
    pathState: PathState,
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
          branch: this.#interpreter.createBranchSite(loc),
        }),
        fallback,
      );
    for (const [index, element] of array.elements.entries()) {
      const matched = this.#interpreter.callFunction(
        callback,
        [element, { kind: "Primitive", value: index }, array],
        loc,
        pathState,
      );
      if (matched.kind !== "Primitive") openMatches.push([matched, element]);
      if (matched.kind === "Primitive" && matched.value) return chooseFirstMatch(element);
    }
    return chooseFirstMatch(UNDEFINED_VALUE);
  }

  evaluateLiteralReduce(
    methodName: string,
    receiver: SymbolicValue,
    [callback, accumulator]: SymbolicValue[],
    loc: SourceLocation,
    pathState: PathState,
  ): SymbolicValue | null {
    if (
      this.#interpreter.handlerEffects !== null ||
      methodName !== "reduce" ||
      callback?.kind !== "Function" ||
      receiver.kind !== "ArrayExpression" ||
      receiver.spreads.length > 0 ||
      receiver.elements.length > MAX_LITERAL_ROWS
    )
      return null;
    return this.#reduce(receiver.elements, callback, accumulator, loc, pathState, [receiver]);
  }

  evaluateArrayFrom(
    callee: SymbolicValue,
    argumentValues: SymbolicValue[],
    loc: SourceLocation,
    pathState: PathState,
  ): SymbolicValue | null {
    const [arrayLike, callback] = argumentValues;
    const isRenderedArrayFrom =
      this.#interpreter.handlerEffects === null &&
      callee.kind === "Global" &&
      callee.name === "Array.from" &&
      callee.module === null;
    if (!isRenderedArrayFrom || !arrayLike || callback?.kind !== "Function") return null;
    return this.evaluateArrayMap(arrayLike, callback, loc, pathState);
  }

  evaluateArrayMap(
    array: SymbolicValue,
    callback: FunctionValue,
    loc: SourceLocation,
    pathState: PathState,
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
              pathState,
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
      item: this.#interpreter.callFunction(callback, [item, index, array], loc, pathState),
      loc,
      isFlat,
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

  createLoopItem(
    collection: SymbolicValue,
    target: Place | undefined,
    loc: SourceLocation,
  ): SymbolicValue {
    const name = target ? getIdentifierName(target) : null;
    const nameLoc = target?.identifier.loc ?? GeneratedSource;
    if (name === null || typeof loc === "symbol" || typeof nameLoc === "symbol") {
      const unknownItem = createUnknown("IteratorNext", loc);
      this.#interpreter.addUnknownSource(unknownItem, collection);
      return unknownItem;
    }
    const inputPlaces = new PlaceMap<true>();
    this.#interpreter.collectInputPlaces(collection, inputPlaces);
    const declaredLoc = { ...loc, start: { ...nameLoc.start }, end: { ...nameLoc.end } };
    const binding = this.#interpreter.createBinding(name, "item", declaredLoc, {
      inputPlaces: inputPlaces.places(),
    });
    this.#interpreter.addItemSource(binding, collection);
    const item = createBindingValue(binding);
    for (const element of getLoopElements(collection))
      this.#interpreter.addStoredFunctions(item, element, false);
    if (collection.kind === "Binding")
      for (const stored of this.#interpreter.getStoredFunctions(collection))
        this.#interpreter.addStoredFunctions(item, stored, false);
    return item;
  }

  evaluateLoadedArrayMap(
    call: InstructionValueOfKind<"CallExpression">,
    argumentValues: SymbolicValue[],
    pathState: PathState,
  ): SymbolicValue | null {
    const methodName = this.#interpreter.getPropertyName(call.callee);
    const receiverPlace = this.#interpreter.getPropertyObject(call.callee);
    const [callback] = argumentValues;
    const isRenderedMap =
      this.#interpreter.handlerEffects === null &&
      methodName !== null &&
      isBuiltinMethod(methodName, "renderedIteration") &&
      receiverPlace !== undefined &&
      callback?.kind === "Function";
    return isRenderedMap
      ? this.evaluateArrayMap(
          this.#interpreter.read(receiverPlace),
          callback,
          call.loc,
          pathState,
          methodName === "flatMap",
        )
      : null;
  }
}
