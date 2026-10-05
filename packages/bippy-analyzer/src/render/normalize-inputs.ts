import type { RuntimeFiberSnapshot, RuntimeSnapshot } from "../harness/snapshot.js";
import { MARKER_NAMES } from "../materialize/markers.js";
import {
  collectGuardVariables,
  type Guard,
  type SymbolicCardinality,
  type SymbolicPredicate,
} from "../symbolic/guards.js";
import { InputRenamer } from "../symbolic/input-renamer.js";
import {
  parseSymbolicCardinality,
  parseSymbolicPredicate,
  serializeSymbolicCardinality,
  serializeSymbolicPredicate,
} from "../symbolic/serialization.js";
import type { StaticRenderResult } from "./types.js";

interface FiberInputMetadata {
  predicate?: SymbolicPredicate;
  cardinality?: SymbolicCardinality;
}

export const normalizeRenderInputs = (result: StaticRenderResult): StaticRenderResult => {
  const identities = new Set<string>();
  const metadata = new WeakMap<RuntimeFiberSnapshot, FiberInputMetadata>();
  const collectGuard = (guard: Guard): void => {
    for (const variable of collectGuardVariables(guard)) identities.add(variable.input);
  };
  const collectFiber = (fiber: RuntimeFiberSnapshot): void => {
    if (metadata.has(fiber)) return;
    const inputs: FiberInputMetadata = {};
    metadata.set(fiber, inputs);
    if (fiber.name === MARKER_NAMES.branch && typeof fiber.props.predicate === "string") {
      const predicate = parseSymbolicPredicate(fiber.props.predicate);
      inputs.predicate = predicate;
      for (const input of predicate.inputs) identities.add(input.id);
      if (predicate.formula) collectGuard(predicate.formula);
      if (predicate.choice) identities.add(predicate.choice.input);
      for (const guard of predicate.guards ?? []) collectGuard(guard);
    }
    if (fiber.name === MARKER_NAMES.repeat && typeof fiber.props.cardinality === "string") {
      const cardinality = parseSymbolicCardinality(fiber.props.cardinality);
      inputs.cardinality = cardinality;
      identities.add(cardinality.variable.input);
      for (const input of cardinality.inputs) identities.add(input.id);
    }
    for (const child of fiber.children) collectFiber(child);
  };
  for (const snapshot of [...result.commits, result.snapshot]) {
    for (const root of snapshot.roots) collectFiber(root);
  }
  for (const cause of result.commitCauses ?? []) {
    collectGuard(cause.guard);
    for (const input of cause.inputs) identities.add(input.id);
  }
  if (identities.size === 0) return result;
  const renamer = new InputRenamer(identities);
  const renameFiber = (fiber: RuntimeFiberSnapshot): RuntimeFiberSnapshot => {
    const inputs = metadata.get(fiber);
    const props = { ...fiber.props };
    if (inputs?.predicate)
      props.predicate = serializeSymbolicPredicate(renamer.renamePredicate(inputs.predicate));
    if (inputs?.cardinality)
      props.cardinality = serializeSymbolicCardinality(
        renamer.renameCardinality(inputs.cardinality),
      );
    return { ...fiber, props, children: fiber.children.map(renameFiber) };
  };
  const renameSnapshot = (snapshot: RuntimeSnapshot): RuntimeSnapshot => ({
    ...snapshot,
    roots: snapshot.roots.map(renameFiber),
  });
  return {
    ...result,
    snapshot: renameSnapshot(result.snapshot),
    commits: result.commits.map(renameSnapshot),
    commitCauses: result.commitCauses?.map((cause) => renamer.renameContext(cause)),
  };
};
