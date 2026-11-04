import type { Binding, SymbolicValue } from "../types";
import { forEachSymbolicValue } from "../values/for-each-symbolic-value";

export const collectBindingIds = (values: SymbolicValue[]): Set<number> => {
  const ids = new Set<number>();
  for (const value of values)
    forEachSymbolicValue(value, (part) => {
      if (part.kind === "Binding") ids.add(part.binding.id);
    });
  return ids;
};

const closeOver = (
  seeds: Iterable<number>,
  getEdges: (id: number) => Iterable<number>,
): Set<number> => {
  const closure = new Set<number>();
  const pending = [...seeds];
  for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
    if (closure.has(id)) continue;
    closure.add(id);
    for (const next of getEdges(id)) pending.push(next);
  }
  return closure;
};

export const getInputClosure = (bindings: Binding[], seeds: Iterable<number>): Set<number> =>
  closeOver(seeds, (id) => bindings[id]?.inputPlaces.map((place) => place.bindingId) ?? []);

export const getDependentClosure = (bindings: Binding[], seeds: Iterable<number>): Set<number> => {
  const dependents: number[][] = [];
  for (const binding of bindings)
    for (const place of binding.inputPlaces) (dependents[place.bindingId] ??= []).push(binding.id);
  return closeOver(seeds, (id) => dependents[id] ?? []);
};
