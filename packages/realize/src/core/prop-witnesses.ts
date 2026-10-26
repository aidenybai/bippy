import { assumeCondition } from "./constraints";
import type { Constraints } from "./constraints";
import { createBindingValue } from "./symbolic-values";
import type {
  AbstractValue,
  Binding,
  BindingPlace,
  ComponentAnalysis,
  PrimitiveValue,
  PropWitness,
  Sample,
} from "./types";
import { getPlaceKey } from "./utils/get-place-key";

const LENGTH_FIELD = "length";
const LENGTH_CANDIDATES = [0, 1, 2, 3];
const UNDEFINED_SAMPLE: Sample = { kind: "Undefined" };

interface PropBinding {
  binding: Binding;
  propName: string;
}

const getPropBindings = (analysis: ComponentAnalysis): PropBinding[] =>
  analysis.bindings.flatMap((binding) =>
    binding.kind === "prop" && binding.propName ? [{ binding, propName: binding.propName }] : [],
  );

const getDefaultSample = (binding: Binding): Sample => binding.samples[0] ?? UNDEFINED_SAMPLE;

const toSample = (value: PrimitiveValue): Sample =>
  value === undefined ? UNDEFINED_SAMPLE : { kind: "Value", value };

const readSample = (sample: Sample | null, path: string[]): Sample | null => {
  const [field, ...rest] = path;
  if (field === undefined || sample === null) return sample;
  if (sample.kind === "Array" && field === LENGTH_FIELD && rest.length === 0)
    return { kind: "Value", value: sample.items.length };
  if (sample.kind !== "Object") return null;
  const fieldSample = sample.fields[field] ?? (sample.isOpen ? null : UNDEFINED_SAMPLE);
  return readSample(fieldSample, rest);
};

const getArrayItem = (samples: Sample[]): Sample | undefined =>
  samples.flatMap((sample) => (sample.kind === "Array" ? sample.items : []))[0];

const writeSample = (
  sample: Sample,
  path: string[],
  value: Sample,
  fallbackItem?: Sample,
): Sample | null => {
  const [field, ...rest] = path;
  if (field === undefined) return value;
  if (sample.kind === "Array" && field === LENGTH_FIELD && rest.length === 0) {
    const item = sample.items[0] ?? fallbackItem;
    if (value.kind !== "Value" || typeof value.value !== "number") return null;
    if (value.value > 0 && !item) return null;
    return { kind: "Array", items: item ? Array.from({ length: value.value }, () => item) : [] };
  }
  if (sample.kind !== "Object") return null;
  const written = writeSample(sample.fields[field] ?? UNDEFINED_SAMPLE, rest, value);
  return written && { ...sample, fields: { ...sample.fields, [field]: written } };
};

const getLiteral = (sample: Sample | null): { value: PrimitiveValue } | null => {
  if (sample?.kind === "Value") return { value: sample.value };
  if (sample?.kind === "Undefined") return { value: undefined };
  return null;
};

const assumeSample = (
  binding: Binding,
  path: string[],
  sample: Sample,
  constraints: Constraints,
): Constraints | null => {
  const place = createBindingValue(binding, path);
  const literal = getLiteral(sample);
  if (!literal) return assumeCondition(place, true, constraints);
  return assumeCondition(
    {
      kind: "BinaryExpression",
      operator: "===",
      left: place,
      right: { kind: "Primitive", value: literal.value },
    },
    true,
    constraints,
  );
};

const getLiteralCases = (values: AbstractValue[] | undefined): PrimitiveValue[] =>
  (values ?? []).flatMap((value) => (value.kind === "Literal" ? [value.value] : []));

const getCandidates = (binding: Binding, path: string[], constraints: Constraints): Sample[] => [
  ...getLiteralCases(constraints.possibleValues.get({ bindingId: binding.id, path })).map(toSample),
  ...(path.length === 0 ? binding.samples : []),
  ...(path.at(-1) === LENGTH_FIELD ? LENGTH_CANDIDATES.map(toSample) : []),
];

const getConstrainedPlaces = (
  constraints: Constraints,
  reachable: Constraints,
  bindingIds: Set<number>,
): BindingPlace[] => {
  const places = new Map<string, BindingPlace>();
  const addPlace = (place: BindingPlace | null): void => {
    if (place && bindingIds.has(place.bindingId)) places.set(getPlaceKey(place), place);
  };
  for (const [place, values] of constraints.possibleValues)
    if (values !== reachable.possibleValues.get(place)) addPlace(place);
  for (const [key, assumption] of constraints.assumptions)
    if (reachable.assumptions.get(key) !== assumption) assumption.places.forEach(addPlace);
  const reachableBounds = new Set(reachable.bounds);
  for (const bound of constraints.bounds)
    if (!reachableBounds.has(bound)) [bound.left, bound.right].forEach(addPlace);
  return [...places.values()].sort((left, right) => left.path.length - right.path.length);
};

const findWitness = (
  bindingsById: Map<number, PropBinding>,
  places: BindingPlace[],
  stateConstraints: Constraints,
): Record<string, Sample> | null => {
  const samples = new Map(
    [...bindingsById].map(([bindingId, { binding }]) => [bindingId, getDefaultSample(binding)]),
  );
  let constraints = stateConstraints;
  const changedIds = new Set<number>();
  for (const place of places) {
    const prop = bindingsById.get(place.bindingId);
    const current = samples.get(place.bindingId);
    if (!prop || !current) continue;
    const currentSample = readSample(current, place.path);
    const kept =
      currentSample && assumeSample(prop.binding, place.path, currentSample, constraints);
    if (kept) {
      constraints = kept;
      continue;
    }
    for (const candidate of getCandidates(prop.binding, place.path, constraints)) {
      const assumed = assumeSample(prop.binding, place.path, candidate, constraints);
      const fallbackItem = place.path.length === 1 ? getArrayItem(prop.binding.samples) : undefined;
      const written = assumed && writeSample(current, place.path, candidate, fallbackItem);
      if (!assumed || !written) continue;
      constraints = assumed;
      samples.set(place.bindingId, written);
      changedIds.add(place.bindingId);
      break;
    }
  }
  if (changedIds.size === 0) return null;
  return Object.fromEntries(
    [...changedIds].flatMap((bindingId) => {
      const prop = bindingsById.get(bindingId);
      const sample = samples.get(bindingId);
      return prop && sample ? [[prop.propName, sample]] : [];
    }),
  );
};

export const findPropWitnesses = (
  analysis: ComponentAnalysis,
  constraintsByState: Constraints[],
  reachable: Constraints,
): PropWitness[] => {
  const bindingsById = new Map(getPropBindings(analysis).map((prop) => [prop.binding.id, prop]));
  if (bindingsById.size === 0) return [];
  const bindingIds = new Set(bindingsById.keys());
  const witnessesByKey = new Map<string, PropWitness>();
  constraintsByState.forEach((constraints, stateIndex) => {
    const places = getConstrainedPlaces(constraints, reachable, bindingIds);
    const props = places.length > 0 ? findWitness(bindingsById, places, constraints) : null;
    if (!props) return;
    const key = JSON.stringify(props);
    const witness = witnessesByKey.get(key) ?? { props, states: [] };
    witness.states.push(stateIndex);
    witnessesByKey.set(key, witness);
  });
  return [...witnessesByKey.values()];
};
