import type { SourceLocation } from "../react-compiler/HIR/HIR";
import { GeneratedSource } from "../react-compiler/HIR/HIR";
import type { Binding, StateUpdate, SymbolicValue, WarningKind } from "./types";
import { isWholeBinding } from "./utils/checks";
import { mapSymbolicValue } from "./utils/traverse";
import { createUnknown } from "./symbolic-values";

export interface CollectedEffects {
  updates: StateUpdate[];
  delegates: string[];
}

interface Mutation {
  binding: Binding;
  loc: SourceLocation;
}

interface WarnCallback {
  (kind: WarningKind, message: string, loc: SourceLocation): void;
}

export class EffectCollector {
  readonly #updates: StateUpdate[] = [];
  readonly #delegates: string[] = [];
  readonly #mutationsByBinding = new Map<number, Mutation>();
  readonly #possiblyMutatedBindings = new Map<number, Binding>();
  readonly #warn: WarnCallback;

  constructor(warn: WarnCallback) {
    this.#warn = warn;
  }

  addMutation(binding: Binding, loc: SourceLocation): void {
    if (!this.#mutationsByBinding.has(binding.id))
      this.#mutationsByBinding.set(binding.id, { binding, loc });
  }

  addPossibleMutation(binding: Binding): void {
    this.#possiblyMutatedBindings.set(binding.id, binding);
  }

  addDelegate(delegateName: string): void {
    this.#delegates.push(delegateName);
  }

  forgetMutatedBindings(value: SymbolicValue): SymbolicValue {
    return mapSymbolicValue(value, (part) =>
      part.kind === "Binding" && this.#isMutated(part.binding)
        ? createUnknown("mutated", GeneratedSource)
        : part,
    );
  }

  addUpdate(
    binding: Binding,
    value: SymbolicValue,
    guards: SymbolicValue[],
    isAsync: boolean,
  ): void {
    this.#updates.push({ binding, value, guards, isAsync });
  }

  hasUpdate(binding: Binding): boolean {
    return this.#updates.some((update) => update.binding.id === binding.id);
  }

  recordSetterCall(
    binding: Binding,
    nextValue: SymbolicValue,
    context: Pick<StateUpdate, "guards" | "isAsync">,
  ): void {
    const mutation = this.#mutationsByBinding.get(binding.id);
    if (mutation) {
      const isSameReference = isWholeBinding(nextValue, binding);
      this.#warn(
        isSameReference ? "lost-update" : "state-mutation",
        isSameReference
          ? `sets ${binding.name} to the array or object it mutated, so React skips the update`
          : `mutates ${binding.name} in place before setting it`,
        mutation.loc,
      );
    }
    const knownValue = this.forgetMutatedBindings(nextValue);
    this.addUpdate(
      binding,
      context.isAsync && knownValue.kind !== "Primitive"
        ? createUnknown("async", GeneratedSource)
        : knownValue,
      context.guards,
      context.isAsync,
    );
  }

  finish(): CollectedEffects {
    for (const { binding, loc } of this.#mutationsByBinding.values()) {
      if (this.hasUpdate(binding)) continue;
      this.#warn(
        "state-mutation",
        `mutates ${binding.name} without setting it, so the change shows only on the next render`,
        loc,
      );
      this.addUpdate(binding, createUnknown("mutated", GeneratedSource), [], false);
    }
    for (const binding of this.#possiblyMutatedBindings.values())
      if (!this.hasUpdate(binding))
        this.addUpdate(binding, createUnknown("mutated", GeneratedSource), [], false);
    return { updates: this.#updates, delegates: this.#delegates };
  }

  #isMutated(binding: Binding): boolean {
    return (
      this.#mutationsByBinding.has(binding.id) || this.#possiblyMutatedBindings.has(binding.id)
    );
  }
}
