import type { Place, SourceLocation } from "../../react-compiler/HIR/HIR";
import { GeneratedSource } from "../../react-compiler/HIR/HIR";
import type { HookKind } from "../../react-compiler/HIR/ObjectShape";
import type { InstructionValueOfKind, Interpreter } from "./interpret";
import { createUnknown, getPassedCallbacks, isMemoCache } from "../values/symbolic-values";
import type { FunctionValue, SymbolicValue, UnknownOrigin } from "../types";
import { getTestExpression } from "../values/get-test-expression";
import { negate } from "../values/negate";
import { getAsyncPathState } from "./path-state";
import type { PathState } from "./path-state";

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
    pathState: PathState,
  ): void {
    const asyncPathState = getAsyncPathState(pathState);
    const isRejected = createUnknown("rejected", loc, {
      kind: "Settled",
      promise,
      settlement: "rejected",
    });
    const guardsByArgument =
      methodName === "then"
        ? [negate(isRejected), isRejected]
        : methodName === "catch"
          ? [isRejected]
          : [];
    const settlementsByArgument: Array<"fulfilled" | "rejected"> =
      methodName === "then"
        ? ["fulfilled", "rejected"]
        : methodName === "catch"
          ? ["rejected"]
          : [];
    argumentValues.forEach((argument, argumentIndex) => {
      const guard = guardsByArgument[argumentIndex];
      const settlement = settlementsByArgument[argumentIndex];
      this.#visitArgument(
        argument,
        guard ? { ...asyncPathState, guards: [...asyncPathState.guards, guard] } : asyncPathState,
        settlement && { kind: "Settled", promise, settlement },
      );
    });
  }

  #visitArgument(
    argument: SymbolicValue,
    pathState: PathState,
    argumentOrigin?: UnknownOrigin,
  ): void {
    if (!this.#interpreter.handlerEffects) return;
    if (argument.kind === "Conditional") {
      const test = getTestExpression(argument);
      this.#visitArgument(argument.consequent, {
        ...pathState,
        guards: [...pathState.guards, test],
      });
      this.#visitArgument(argument.alternate, {
        ...pathState,
        guards: [...pathState.guards, negate(test)],
      });
      return;
    }
    if (argument.kind === "ObjectExpression")
      for (const property of argument.properties) this.#visitArgument(property.value, pathState);
    if (argument.kind === "ArrayExpression")
      for (const element of argument.elements) this.#visitArgument(element, pathState);
    const asyncPathState = getAsyncPathState(pathState);
    if (argument.kind === "Bound") this.#visitArgument(argument.callee, pathState);
    if (argument.kind === "Dispatch")
      this.#interpreter.callStoredValue(
        argument,
        [createUnknown("callback-argument", GeneratedSource, argumentOrigin)],
        argument.binding.loc,
        asyncPathState,
      );
    if (argument.kind === "Setter")
      this.#interpreter.handlerEffects.recordSetterCall(
        argument.binding,
        createUnknown("callback-argument", GeneratedSource, argumentOrigin),
        asyncPathState,
      );
    for (const wrapped of this.#interpreter.getMemberCallbacks(argument) ?? [])
      this.#visitArgument(wrapped, pathState, argumentOrigin);
    if (argument.kind === "Binding" && argument.path.length > 0)
      this.#interpreter.callStoredFunctions(
        argument,
        [createUnknown("callback-argument", GeneratedSource, argumentOrigin)],
        { ...asyncPathState, frame: this.#nextFrame++ },
      );
    if (argument.kind === "Function")
      this.#interpreter.walker.runRepeated(() =>
        this.#interpreter.callFunction(
          argument,
          this.getUnknownArguments(argument, argumentOrigin),
          argument.loc,
          { ...asyncPathState, frame: this.#nextFrame++ },
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
    pathState: PathState,
  ): void {
    const storedValue = this.#interpreter.read(store.value);
    const isCached = isMemoCache(this.#interpreter.read(store.object));
    if (storedValue.kind === "Function" && !isCached)
      this.passCallbacks([storedValue], store.loc, pathState);
  }

  passCallbacks(argumentValues: SymbolicValue[], loc: SourceLocation, pathState: PathState): void {
    if (!this.#interpreter.handlerEffects) {
      this.addDeferredCallbacks(argumentValues, loc);
      return;
    }
    for (const argument of argumentValues) this.#visitArgument(argument, pathState);
  }

  addEffectCall(
    hookKind: HookKind,
    callback: SymbolicValue,
    dependenciesPlace: Place | undefined,
    loc: SourceLocation,
  ): void {
    const dependencies = dependenciesPlace ? this.#interpreter.read(dependenciesPlace) : null;
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
        loc,
      });
    }
  }
}
