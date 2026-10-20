import { assumeCondition, type Constraints } from "./constraints";
import type { SymbolicValue } from "./types";
import { forEachSymbolicValue } from "./utils/for-each-symbolic-value";

export const assumeGuards = (
  guards: SymbolicValue[],
  constraints: Constraints,
): Constraints | null =>
  guards.reduce<Constraints | null>(
    (current, guard) => current && assumeCondition(guard, true, current),
    constraints,
  );

const getReadBindingIds = (value: SymbolicValue): Set<number> => {
  const bindingIds = new Set<number>();
  forEachSymbolicValue(value, (part) => {
    if (part.kind === "Binding") bindingIds.add(part.binding.id);
  });
  return bindingIds;
};

const getOpaqueInputBindingIds = (value: SymbolicValue): number[] => {
  const bindingIds: number[] = [];
  forEachSymbolicValue(value, (part) => {
    if (part.kind === "Binding")
      bindingIds.push(...part.binding.inputPlaces.map((place) => place.bindingId));
  });
  return bindingIds;
};

export const hasOpaqueGuardOn = (subject: SymbolicValue, guards: SymbolicValue[]): boolean => {
  const subjectBindingIds = getReadBindingIds(subject);
  return guards.some((guard) =>
    getOpaqueInputBindingIds(guard).some((bindingId) => subjectBindingIds.has(bindingId)),
  );
};
