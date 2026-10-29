import { GeneratedSource } from "../../react-compiler/HIR/HIR";
import type { SourceLocation } from "../../react-compiler/HIR/HIR";
import type { EffectCollector } from "./effect-collector";
import { formatPlace } from "../values/format";
import type { CallSite, InstructionValueOfKind, Interpreter } from "./interpret";
import { UNDEFINED_VALUE, createBindingValue, createUnknown } from "../values/symbolic-values";
import type { Binding, BindingValue, StoreModel, SymbolicValue } from "../types";
import { ROOT_WALK_STATE, getAsyncWalkState } from "./walk-state";
import type { WalkState } from "./walk-state";

const STORE_METHODS = new Set(["getState", "setState"]);

export class StoreReads {
  readonly #interpreter: Interpreter;

  constructor(interpreter: Interpreter) {
    this.#interpreter = interpreter;
  }

  readStore(
    storeKey: string,
    storeModel: StoreModel,
    callSite: CallSite,
    walkState: WalkState,
  ): SymbolicValue {
    const storeHookName = callSite.callee.kind === "Global" ? callSite.callee.name : "store";
    const storeBinding = this.#getStoreBinding(storeKey, storeModel, storeHookName, callSite.loc);
    const [selector] = callSite.argumentValues;
    return selector?.kind === "Function"
      ? this.#interpreter.callFunction(
          selector,
          [createBindingValue(storeBinding)],
          callSite.loc,
          walkState,
        )
      : createBindingValue(storeBinding);
  }

  #getStoreBinding(
    storeKey: string,
    storeModel: StoreModel,
    storeHookName: string,
    loc: SourceLocation,
  ): Binding {
    return this.#interpreter.externalSources.getStoreBinding(storeKey, storeModel, () =>
      this.#interpreter.createBinding(`${storeHookName}()`, "hook", loc, {
        hookKind: "Custom",
        domain: { kind: "Opaque", typeText: storeHookName },
        initial: storeModel.initial,
      }),
    );
  }

  evaluateStoreMethod(
    methodCall: InstructionValueOfKind<"MethodCall">,
    receiver: SymbolicValue,
    methodName: string,
    argumentValues: SymbolicValue[],
    walkState: WalkState,
  ): SymbolicValue | null {
    if (receiver.kind !== "Global" || !STORE_METHODS.has(methodName)) return null;
    const storeKey = this.#interpreter.resolver.getDeclarationKey(methodCall.receiver.loc);
    const storeModel = storeKey
      ? this.#interpreter.externalSources.getStoreModel(storeKey)
      : undefined;
    if (!storeKey || !storeModel) return null;
    const storeBinding = this.#getStoreBinding(storeKey, storeModel, receiver.name, methodCall.loc);
    const state = createBindingValue(storeBinding);
    if (methodName === "getState") return state;
    const [nextState] = argumentValues;
    const base = this.#interpreter.getQueuedState(storeBinding, walkState);
    const partial =
      nextState?.kind === "Function"
        ? this.#interpreter.callFunction(nextState, [base], methodCall.loc, walkState)
        : nextState;
    this.#interpreter.handlerEffects?.recordSetterCall(
      storeBinding,
      partial?.kind === "ObjectExpression" && argumentValues.length === 1
        ? { ...partial, spreads: [base, ...partial.spreads] }
        : createUnknown("store", methodCall.loc),
      walkState,
    );
    return UNDEFINED_VALUE;
  }

  recordExternalStoreChanges(handlerEffects: EffectCollector): void {
    for (const binding of this.#interpreter.bindingTable.bindings)
      if (
        this.#interpreter.externalSources.isExternalStore(binding) &&
        !handlerEffects.hasUpdate(binding)
      )
        handlerEffects.addUpdate(
          binding,
          createUnknown("external", GeneratedSource),
          getAsyncWalkState(ROOT_WALK_STATE),
        );
  }

  recordExternalUpdate(
    handlerEffects: EffectCollector,
    callee: BindingValue,
    walkState: WalkState,
  ): void {
    handlerEffects.addDelegate(formatPlace(callee.binding, callee.path));
    const affectedBindings = this.#interpreter.bindingTable.bindings.filter(
      (binding) =>
        binding.id === callee.binding.id ||
        this.#interpreter.externalSources.isFromSameModule(callee.binding, binding),
    );
    for (const binding of affectedBindings)
      if (!handlerEffects.hasUpdate(binding))
        handlerEffects.addUpdate(
          binding,
          createUnknown("external", GeneratedSource),
          getAsyncWalkState(walkState),
        );
  }
}
