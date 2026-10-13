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

type Warn = (kind: WarningKind, message: string, loc: SourceLocation) => void;

/** The state updates one handler or effect makes, and the state it mutates on the way. */
export class EffectCollector {
  readonly #updates: StateUpdate[] = [];
  readonly #delegates: string[] = [];
  readonly #mutations = new Map<number, Mutation>();
  /** State passed to a function that may mutate it, like a library's `remove(items, item)`. */
  readonly #possibleMutations = new Map<number, Binding>();
  readonly #warn: Warn;

  constructor(warn: Warn) {
    this.#warn = warn;
  }

  addMutation(binding: Binding, loc: SourceLocation): void {
    if (!this.#mutations.has(binding.id)) this.#mutations.set(binding.id, { binding, loc });
  }

  addPossibleMutation(binding: Binding): void {
    this.#possibleMutations.set(binding.id, binding);
  }

  addDelegate(name: string): void {
    this.#delegates.push(name);
  }

  forgetMutations(value: SymbolicValue): SymbolicValue {
    return mapSymbolicValue(value, (part) =>
      part.kind === "Binding" &&
      (this.#mutations.has(part.binding.id) || this.#possibleMutations.has(part.binding.id))
        ? createUnknown("mutated", GeneratedSource)
        : part,
    );
  }

  push(binding: Binding, value: SymbolicValue, guards: SymbolicValue[], isAsync: boolean): void {
    this.#updates.push({ binding, value, guards, isAsync });
  }

  hasUpdate(binding: Binding): boolean {
    return this.#updates.some((update) => update.binding.id === binding.id);
  }

  record(
    binding: Binding,
    value: SymbolicValue,
    context: Pick<StateUpdate, "guards" | "isAsync">,
  ): void {
    const mutation = this.#mutations.get(binding.id);
    if (mutation) {
      const isSameReference = isWholeBinding(value, binding);
      this.#warn(
        isSameReference ? "lost-update" : "state-mutation",
        isSameReference
          ? `sets ${binding.name} to the array or object it mutated, so React skips the update`
          : `mutates ${binding.name} in place before setting it`,
        mutation.loc,
      );
    }
    const knownValue = this.forgetMutations(value);
    this.push(
      binding,
      context.isAsync && knownValue.kind !== "Primitive"
        ? createUnknown("async", GeneratedSource)
        : knownValue,
      context.guards,
      context.isAsync,
    );
  }

  // Mutated-but-unset state shows on the next re-render, so forget it to keep later states sound.
  finish(): CollectedEffects {
    for (const { binding, loc } of this.#mutations.values()) {
      if (this.hasUpdate(binding)) continue;
      this.#warn(
        "state-mutation",
        `mutates ${binding.name} without setting it, so the change shows only on the next render`,
        loc,
      );
      this.push(binding, createUnknown("mutated", GeneratedSource), [], false);
    }
    for (const binding of this.#possibleMutations.values())
      if (!this.hasUpdate(binding))
        this.push(binding, createUnknown("mutated", GeneratedSource), [], false);
    return { updates: this.#updates, delegates: this.#delegates };
  }
}
