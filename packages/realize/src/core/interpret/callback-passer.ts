import type { Place, SourceLocation } from "../../react-compiler/HIR/HIR";
import { GeneratedSource } from "../../react-compiler/HIR/HIR";
import type { HookKind } from "../../react-compiler/HIR/ObjectShape";
import type { InstructionValueOfKind, Interpreter } from "./interpret";
import { createUnknown, getPassedCallbacks, isMemoCache } from "../values/symbolic-values";
import { PlaceMap } from "../values/place-map";
import type { FunctionValue, SymbolicValue, UnknownOrigin } from "../types";
import { getTestExpression } from "../values/get-test-expression";
import { negate } from "../values/negate";
import { getAsyncWalkState } from "./walk-state";
import type { WalkState } from "./walk-state";

export class CallbackPasser {
  readonly #interpreter: Interpreter;
  #nextFrame = 1;

  constructor(interpreter: Interpreter) {
    this.#interpreter = interpreter;
  }

  visitPromiseCallbacks(
    methodName: string,
    promise: SymbolicValue,
    argumentValues: SymbolicValue[],
    loc: SourceLocation,
    walkState: WalkState,
  ): void {
    const asyncWalkState = getAsyncWalkState(walkState);
    const isRejected = createUnknown("rejected", loc, {
      kind: "Settled",
      promise,
      outcome: "rejected",
    });
    const guardsByArgument =
      methodName === "then"
        ? [negate(isRejected), isRejected]
        : methodName === "catch"
          ? [isRejected]
          : [];
    const outcomesByArgument: Array<"resolved" | "rejected"> =
      methodName === "then" ? ["resolved", "rejected"] : methodName === "catch" ? ["rejected"] : [];
    argumentValues.forEach((argument, argumentIndex) => {
      const guard = guardsByArgument[argumentIndex];
      const outcome = outcomesByArgument[argumentIndex];
      this.#visitArgument(
        argument,
        guard ? { ...asyncWalkState, guards: [...asyncWalkState.guards, guard] } : asyncWalkState,
        outcome && { kind: "Settled", promise, outcome },
      );
    });
  }

  #visitArgument(
    argument: SymbolicValue,
    walkState: WalkState,
    argumentOrigin?: UnknownOrigin,
  ): void {
    if (!this.#interpreter.handlerEffects) return;
    if (argument.kind === "Conditional") {
      const test = getTestExpression(argument);
      this.#visitArgument(argument.consequent, {
        ...walkState,
        guards: [...walkState.guards, test],
      });
      this.#visitArgument(argument.alternate, {
        ...walkState,
        guards: [...walkState.guards, negate(test)],
      });
      return;
    }
    if (argument.kind === "ObjectExpression")
      for (const property of argument.properties) this.#visitArgument(property.value, walkState);
    if (argument.kind === "ArrayExpression")
      for (const element of argument.elements) this.#visitArgument(element, walkState);
    const asyncWalkState = getAsyncWalkState(walkState);
    if (argument.kind === "Bound") this.#visitArgument(argument.callee, walkState);
    if (argument.kind === "Dispatch")
      this.#interpreter.callStoredValue(
        argument,
        [createUnknown("callback-argument", GeneratedSource, argumentOrigin)],
        argument.binding.loc,
        asyncWalkState,
      );
    if (argument.kind === "Setter")
      this.#interpreter.handlerEffects.recordSetterCall(
        argument.binding,
        createUnknown("callback-argument", GeneratedSource, argumentOrigin),
        asyncWalkState,
      );
    for (const wrapped of this.#interpreter.getMemberCallbacks(argument) ?? [])
      this.#visitArgument(wrapped, walkState, argumentOrigin);
    if (argument.kind === "Binding" && argument.path.length > 0)
      this.#interpreter.callStoredFunctions(
        argument,
        [createUnknown("callback-argument", GeneratedSource, argumentOrigin)],
        { ...asyncWalkState, frame: this.#nextFrame++ },
      );
    if (argument.kind === "Function")
      this.#interpreter.walker.runRepeated(() =>
        this.#interpreter.callFunction(
          argument,
          this.getUnknownArguments(argument, argumentOrigin),
          argument.loc,
          { ...asyncWalkState, frame: this.#nextFrame++ },
        ),
      );
  }

  getUnknownArguments(callback: FunctionValue, firstOrigin?: UnknownOrigin): SymbolicValue[] {
    const parameterCount = this.#interpreter.functions.get(callback.functionId)?.params.length ?? 1;
    return Array.from({ length: Math.max(parameterCount, 1) }, (_parameter, index) =>
      createUnknown("callback-argument", callback.loc, index === 0 ? firstOrigin : undefined),
    );
  }

  passStoredCallback(
    store: InstructionValueOfKind<"PropertyStore" | "ComputedStore">,
    walkState: WalkState,
  ): void {
    const storedValue = this.#interpreter.read(store.value);
    const isCached = isMemoCache(this.#interpreter.read(store.object));
    if (storedValue.kind === "Function" && !isCached)
      this.passCallbacks([storedValue], store.loc, walkState);
  }

  passCallbacks(argumentValues: SymbolicValue[], loc: SourceLocation, walkState: WalkState): void {
    if (!this.#interpreter.handlerEffects) {
      this.addDeferredCallbacks(argumentValues, loc);
      return;
    }
    for (const argument of argumentValues) this.#visitArgument(argument, walkState);
  }

  addEffectCall(
    hookKind: HookKind,
    callback: SymbolicValue,
    dependenciesPlace: Place | undefined,
    loc: SourceLocation,
  ): void {
    const dependencyPlaces = new PlaceMap<true>();
    const dependencies = dependenciesPlace ? this.#interpreter.read(dependenciesPlace) : null;
    if (dependencies) this.#interpreter.collectInputPlaces(dependencies, dependencyPlaces);
    const isEmptyList =
      dependencies?.kind === "ArrayExpression" &&
      dependencies.elements.length === 0 &&
      dependencies.spreads.length === 0;
    this.#interpreter.effectCalls.push({
      hookKind,
      callback,
      callbackArguments: [],
      dependencies: isEmptyList
        ? "[]"
        : dependenciesPlace
          ? this.#interpreter.resolver.getSourceText(dependenciesPlace.loc)
          : null,
      dependencyPlaces: dependenciesPlace ? dependencyPlaces.places() : null,
      loc,
    });
  }

  addDeferredCallbacks(
    argumentValues: SymbolicValue[],
    loc: SourceLocation,
    isHookArgument = false,
  ): void {
    for (const callback of getPassedCallbacks(argumentValues)) {
      const isUpdate = callback.kind === "Setter" || callback.kind === "Dispatch";
      if (callback.kind !== "Function" && !(isHookArgument && isUpdate)) continue;
      const parameters =
        callback.kind === "Function"
          ? (this.#interpreter.functions.get(callback.functionId)?.params ?? [])
          : [null];
      this.#interpreter.effectCalls.push({
        hookKind: "Custom",
        callback,
        callbackArguments: parameters.map(() => createUnknown("callback-argument", loc)),
        dependencies: null,
        dependencyPlaces: null,
        loc,
      });
    }
  }
}
