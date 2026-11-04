import type { SourceLocation } from "../../react-compiler/HIR/HIR";
import { createUnknown } from "../values/symbolic-values";
import type { SymbolicValue } from "../types";
import type { PathState } from "./path-state";

export type CellTable = "ref" | "context";

interface CellStore {
  pathState: PathState;
  generation: number;
  value: SymbolicValue;
}

const isDominatedBy = (pathState: PathState, store: CellStore): boolean =>
  store.pathState.isAsync === pathState.isAsync &&
  store.pathState.frame === pathState.frame &&
  store.pathState.guards.every((guard, index) => pathState.guards[index] === guard);

const isNestedIn = (store: CellStore, pathState: PathState): boolean =>
  store.pathState.guards.length > pathState.guards.length &&
  pathState.guards.every((guard, index) => store.pathState.guards[index] === guard);

const isNegationOf = (guard: SymbolicValue, other: SymbolicValue): boolean =>
  guard.kind === "UnaryExpression" && guard.operator === "!" && guard.value === other;

const isOnOtherSide = (store: CellStore, pathState: PathState): boolean => {
  const index = store.pathState.guards.findIndex(
    (guard, position) => pathState.guards[position] !== guard,
  );
  const storeGuard = store.pathState.guards[index];
  const readGuard = pathState.guards[index];
  return (
    storeGuard !== undefined &&
    readGuard !== undefined &&
    (isNegationOf(storeGuard, readGuard) || isNegationOf(readGuard, storeGuard))
  );
};

const isMaybeOverwrittenBy = (store: CellStore, pathState: PathState): boolean =>
  isNestedIn(store, pathState) ||
  (store.pathState.isAsync === pathState.isAsync &&
    store.pathState.frame === pathState.frame &&
    !isDominatedBy(pathState, store) &&
    !isOnOtherSide(store, pathState));

export class Cells {
  readonly #stores: Record<CellTable, CellStore[][]> = { ref: [], context: [] };
  #generation = 0;

  passAwait(): void {
    this.#generation++;
  }

  store(table: CellTable, id: number, value: SymbolicValue, pathState: PathState): void {
    const stores = this.#stores[table];
    stores[id] ??= [];
    stores[id].push({ pathState, generation: this.#generation, value });
  }

  read(
    table: CellTable,
    id: number,
    liveValue: SymbolicValue,
    loc: SourceLocation,
    pathState: PathState,
  ): SymbolicValue {
    const stores = this.#stores[table][id] ?? [];
    const storeIndex = stores.findLastIndex(
      (candidate) =>
        isDominatedBy(pathState, candidate) &&
        (!pathState.isAsync || candidate.generation === this.#generation),
    );
    const isMaybeOverwritten = stores
      .slice(storeIndex + 1)
      .some((candidate) => isMaybeOverwrittenBy(candidate, pathState));
    if (isMaybeOverwritten) return createUnknown("cell", loc);
    const store = stores[storeIndex];
    if (store) return store.value;
    return pathState.isAsync ? createUnknown("async", loc) : liveValue;
  }
}
