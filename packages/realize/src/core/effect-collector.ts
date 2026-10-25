import type { SourceLocation } from "../react-compiler/HIR/HIR";
import { GeneratedSource } from "../react-compiler/HIR/HIR";
import type { Binding, Claim, StateUpdate, SymbolicValue, WarningKind } from "./types";
import { isStateBinding } from "./utils/is-state-binding";
import { isWholeBinding } from "./utils/is-whole-binding";
import { forEachSymbolicValue } from "./utils/for-each-symbolic-value";
import { mapSymbolicValue } from "./utils/map-symbolic-value";
import { createBindingValue, createUnknown } from "./symbolic-values";

export interface CollectedEffects {
  updates: StateUpdate[];
  delegates: string[];
  pendingMutations: Binding[];
  claims: Claim[];
}

export interface UpdateCondition {
  guards: SymbolicValue[];
  isAsync: boolean;
  isRepeated?: boolean;
}

const UNCONDITIONAL_UPDATE: UpdateCondition = { guards: [], isAsync: false };

const LITERAL_KINDS = new Set(["Primitive", "ObjectExpression", "ArrayExpression"]);

const isLiteral = (value: SymbolicValue): boolean => {
  let isLiteral = true;
  forEachSymbolicValue(value, (part) => {
    if (!LITERAL_KINDS.has(part.kind)) isLiteral = false;
  });
  return isLiteral;
};

const FRESH_KINDS = new Set(["ObjectExpression", "ArrayExpression", "Function"]);

const isSurelyChanged = (value: SymbolicValue, binding: Binding): boolean => {
  if (FRESH_KINDS.has(value.kind)) return true;
  if (value.kind === "UnaryExpression")
    return value.operator === "!" && isWholeBinding(value.value, binding);
  if (value.kind !== "BinaryExpression" || (value.operator !== "+" && value.operator !== "-"))
    return false;
  const { left, right } = value;
  return (
    isWholeBinding(left, binding) &&
    right.kind === "Primitive" &&
    typeof right.value === "number" &&
    right.value !== 0
  );
};

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
  readonly #claims: Claim[] = [];
  readonly #mutationsByBinding = new Map<number, Mutation>();
  readonly #possiblyMutatedBindings = new Map<number, Binding>();
  readonly #sameReferenceSets = new Set<number>();
  #callsImportedCode = false;
  #callsOpaqueCode = false;
  readonly #warn: WarnCallback;

  constructor(warn: WarnCallback) {
    this.#warn = warn;
  }

  get updateCount(): number {
    return this.#updates.length;
  }

  forgetRenderValues(firstUpdate: number): void {
    const forget = (value: SymbolicValue): SymbolicValue =>
      mapSymbolicValue(value, (part) =>
        part.kind === "Binding" ? createUnknown("previous-render", GeneratedSource) : part,
      );
    for (const [index, update] of this.#updates.entries())
      if (index >= firstUpdate)
        this.#updates[index] = {
          ...update,
          value: forget(update.value),
          guards: update.guards.map(forget),
        };
  }

  addMutation(binding: Binding, loc: SourceLocation): void {
    if (!this.#mutationsByBinding.has(binding.id))
      this.#mutationsByBinding.set(binding.id, { binding, loc });
  }

  addPossibleMutation(binding: Binding): void {
    this.#possiblyMutatedBindings.set(binding.id, binding);
  }

  addImportedCall(): void {
    this.#callsImportedCode = true;
  }

  addOpaqueCall(): void {
    this.#callsOpaqueCode = true;
  }

  get callsOutside(): boolean {
    return this.#callsImportedCode || this.#callsOpaqueCode;
  }

  get mutatesModule(): boolean {
    return [...this.#possiblyMutatedBindings.values()].some((binding) => binding.kind === "module");
  }

  addDelegate(delegateName: string): void {
    this.#delegates.push(delegateName);
  }

  addClaim(claim: Claim): void {
    this.#claims.push(claim);
  }

  forgetMutatedBindings(value: SymbolicValue): SymbolicValue {
    return mapSymbolicValue(value, (part) =>
      part.kind === "Binding" && this.#isMutated(part.binding)
        ? createUnknown("mutated", GeneratedSource)
        : part,
    );
  }

  addUpdate(binding: Binding, value: SymbolicValue, condition: UpdateCondition): void {
    const hasMutations =
      this.#mutationsByBinding.size > 0 || this.#possiblyMutatedBindings.size > 0;
    const guards = hasMutations
      ? condition.guards.map((guard) =>
          mapSymbolicValue(guard, (part) =>
            part.kind === "Binding" && isStateBinding(part.binding) && this.#isMutated(part.binding)
              ? createUnknown("mutated", GeneratedSource)
              : part,
          ),
        )
      : condition.guards;
    this.#updates.push({
      binding,
      value,
      guards,
      isAsync: condition.isAsync,
      ...(condition.isRepeated && { isRepeated: true }),
    });
  }

  getQueuedValue(binding: Binding, condition: UpdateCondition): SymbolicValue {
    const queued = this.#updates.findLast((update) => update.binding.id === binding.id);
    if (!queued || queued.isAsync || condition.isAsync) return createBindingValue(binding);
    return queued.guards.every((guard) => condition.guards.includes(guard))
      ? queued.value
      : createUnknown("queued-update", GeneratedSource);
  }

  hasUpdate(binding: Binding): boolean {
    return this.#updates.some((update) => update.binding.id === binding.id);
  }

  recordSetterCall(binding: Binding, nextValue: SymbolicValue, condition: UpdateCondition): void {
    const isSameReference = isWholeBinding(nextValue, binding);
    const mutation = this.#mutationsByBinding.get(binding.id);
    if (mutation) {
      this.#warn(
        isSameReference ? "lost-update" : "state-mutation",
        isSameReference
          ? `sets ${binding.name} to the array or object it mutated, so React skips the update`
          : `mutates ${binding.name} in place before setting it`,
        mutation.loc,
      );
    }
    if (isSameReference && !this.hasUpdate(binding)) {
      this.#sameReferenceSets.add(binding.id);
      return;
    }
    const knownValue = this.forgetMutatedBindings(nextValue);
    this.addUpdate(
      binding,
      condition.isAsync && !isLiteral(knownValue)
        ? createUnknown("async", GeneratedSource)
        : knownValue,
      condition,
    );
  }

  finish(): CollectedEffects {
    const rendersSurely = this.#updates.some(
      (update) => update.guards.length === 0 && isSurelyChanged(update.value, update.binding),
    );
    const pendingMutations = rendersSurely
      ? []
      : [
          ...[...this.#mutationsByBinding.values()].map((mutation) => mutation.binding),
          ...this.#possiblyMutatedBindings.values(),
        ];
    const mayRender =
      this.#updates.length > 0 || this.#delegates.length > 0 || this.#callsImportedCode;
    for (const { binding, loc } of this.#mutationsByBinding.values()) {
      if (this.hasUpdate(binding)) continue;
      if (!this.#sameReferenceSets.has(binding.id))
        this.#warn(
          "state-mutation",
          `mutates ${binding.name} without setting it, so the change shows only on the next render`,
          loc,
        );
      if (mayRender)
        this.addUpdate(binding, createUnknown("mutated", GeneratedSource), UNCONDITIONAL_UPDATE);
    }
    for (const binding of this.#possiblyMutatedBindings.values())
      if (!this.hasUpdate(binding) && (mayRender || binding.kind === "module"))
        this.addUpdate(binding, createUnknown("mutated", GeneratedSource), UNCONDITIONAL_UPDATE);
    return {
      updates: this.#updates,
      delegates: this.#delegates,
      pendingMutations,
      claims: this.#claims,
    };
  }

  #isMutated(binding: Binding): boolean {
    return (
      this.#mutationsByBinding.has(binding.id) || this.#possiblyMutatedBindings.has(binding.id)
    );
  }
}
