import type { Place, SourceLocation } from "../react-compiler/HIR/HIR";
import { GeneratedSource } from "../react-compiler/HIR/HIR";
import type { HookKind } from "../react-compiler/HIR/ObjectShape";
import type { InstructionValueOfKind, Interpreter } from "./interpret";
import { createUnknown, getPassedCallbacks } from "./symbolic-values";
import type { FunctionValue, SymbolicValue } from "./types";
import { negate } from "./utils/negate";
import { getAsyncWalkState } from "./walk-state";
import type { WalkState } from "./walk-state";

export class CallbackPasser {
  readonly #interpreter: Interpreter;

  constructor(interpreter: Interpreter) {
    this.#interpreter = interpreter;
  }

  visitPromiseCallbacks(
    methodName: string,
    argumentValues: SymbolicValue[],
    loc: SourceLocation,
    walkState: WalkState,
  ): void {
    const asyncWalkState = getAsyncWalkState(walkState);
    const isRejected = createUnknown("rejected", loc);
    const guardsByArgument =
      methodName === "then"
        ? [negate(isRejected), isRejected]
        : methodName === "catch"
          ? [isRejected]
          : [];
    argumentValues.forEach((argument, argumentIndex) => {
      const guard = guardsByArgument[argumentIndex];
      this.#visitArgument(
        argument,
        guard ? { ...asyncWalkState, guards: [...asyncWalkState.guards, guard] } : asyncWalkState,
      );
    });
  }

  #visitArgument(argument: SymbolicValue, walkState: WalkState): void {
    if (!this.#interpreter.handlerEffects) return;
    if (argument.kind === "ObjectExpression")
      for (const callback of getPassedCallbacks([argument]))
        this.#visitArgument(callback, walkState);
    const asyncWalkState = getAsyncWalkState(walkState);
    if (argument.kind === "Setter")
      this.#interpreter.handlerEffects.recordSetterCall(
        argument.binding,
        createUnknown("callback-argument", GeneratedSource),
        asyncWalkState,
      );
    if (argument.kind === "Function")
      this.#interpreter.callFunction(
        argument,
        this.getUnknownArguments(argument),
        argument.loc,
        asyncWalkState,
      );
  }

  getUnknownArguments(callback: FunctionValue): SymbolicValue[] {
    const parameterCount = this.#interpreter.functions.get(callback.functionId)?.params.length ?? 1;
    return Array.from({ length: Math.max(parameterCount, 1) }, () =>
      createUnknown("callback-argument", callback.loc),
    );
  }

  passStoredCallback(
    store: InstructionValueOfKind<"PropertyStore" | "ComputedStore">,
    walkState: WalkState,
  ): void {
    const storedValue = this.#interpreter.read(store.value);
    if (storedValue.kind === "Function") this.passCallbacks([storedValue], store.loc, walkState);
  }

  passCallbacks(argumentValues: SymbolicValue[], loc: SourceLocation, walkState: WalkState): void {
    if (!this.#interpreter.handlerEffects) this.addDeferredCallbacks(argumentValues, loc);
    else for (const argument of argumentValues) this.#visitArgument(argument, walkState);
  }

  addEffectCall(
    hookKind: HookKind,
    callback: SymbolicValue,
    dependenciesPlace: Place | undefined,
    loc: SourceLocation,
  ): void {
    this.#interpreter.effectCalls.push({
      hookKind,
      callback,
      callbackArguments: [],
      dependencies: dependenciesPlace
        ? this.#interpreter.resolver.getSourceText(dependenciesPlace.loc)
        : null,
      loc,
    });
  }

  addDeferredCallbacks(argumentValues: SymbolicValue[], loc: SourceLocation): void {
    for (const callback of getPassedCallbacks(argumentValues)) {
      if (callback.kind !== "Function") continue;
      const parameters = this.#interpreter.functions.get(callback.functionId)?.params ?? [];
      this.#interpreter.effectCalls.push({
        hookKind: "Custom",
        callback,
        callbackArguments: parameters.map(() => createUnknown("callback-argument", callback.loc)),
        dependencies: null,
        loc,
      });
    }
  }
}
