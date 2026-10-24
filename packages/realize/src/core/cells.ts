import type { SourceLocation } from "../react-compiler/HIR/HIR";
import { createUnknown } from "./symbolic-values";
import type { SymbolicValue } from "./types";
import type { WalkState } from "./walk-state";

interface CellStore {
  key: string;
  walkState: WalkState;
  generation: number;
  value: SymbolicValue;
}

const isDominatedBy = (walkState: WalkState, store: CellStore): boolean =>
  store.walkState.isAsync === walkState.isAsync &&
  store.walkState.guards.every((guard, index) => walkState.guards[index] === guard);

const isNestedIn = (store: CellStore, walkState: WalkState): boolean =>
  store.walkState.guards.length > walkState.guards.length &&
  walkState.guards.every((guard, index) => store.walkState.guards[index] === guard);

export class Cells {
  #stores: CellStore[] = [];
  #generation = 0;

  passAwait(): void {
    this.#generation++;
  }

  store(key: string, value: SymbolicValue, walkState: WalkState): void {
    this.#stores.push({ key, walkState, generation: this.#generation, value });
  }

  read(
    key: string,
    liveValue: SymbolicValue,
    loc: SourceLocation,
    walkState: WalkState,
  ): SymbolicValue {
    const storeIndex = this.#stores.findLastIndex(
      (candidate) =>
        candidate.key === key &&
        isDominatedBy(walkState, candidate) &&
        (!walkState.isAsync || candidate.generation === this.#generation),
    );
    const isMaybeOverwritten = this.#stores
      .slice(storeIndex + 1)
      .some((candidate) => candidate.key === key && isNestedIn(candidate, walkState));
    if (isMaybeOverwritten) return createUnknown("cell", loc);
    const store = this.#stores[storeIndex];
    if (store) return store.value;
    return walkState.isAsync ? createUnknown("async", loc) : liveValue;
  }
}
