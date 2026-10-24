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
    const store = this.#stores.findLast(
      (candidate) =>
        candidate.key === key &&
        isDominatedBy(walkState, candidate) &&
        (!walkState.isAsync || candidate.generation === this.#generation),
    );
    if (store) return store.value;
    return walkState.isAsync ? createUnknown("async", loc) : liveValue;
  }
}
