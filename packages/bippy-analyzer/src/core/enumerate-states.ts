import { GeneratedSource } from "../react-compiler/HIR/HIR";
import DisjointSet from "../react-compiler/Utils/DisjointSet";
import type { Bound, Constraints } from "./constraints";
import {
  assume,
  cloneConstraints,
  dedupeValues,
  evaluate,
  forgetBinding,
  getLengthAtom,
  resolveLiteral,
} from "./constraints";
import type {
  AbstractValue,
  Binding,
  ComponentAnalysis,
  ConditionalValue,
  Place,
  UnreachableBranch,
  Domain,
  Transition,
  State,
  Region,
  StateReport,
  SymbolicValue,
  Handler,
  StateUpdate,
} from "./types";
import {
  forEachJsxElement,
  forEachRenderNode,
  forEachSymbolicValue,
  mapSymbolicValue,
} from "./utils/traverse";
import { formatNegated, formatSymbolicValue } from "./format";
import { getValueKey } from "./utils/value-key";
import {
  PlaceMap,
  getBindingPlace,
  getValuePlace,
  isPlacePrefix,
  isSamePlace,
} from "./utils/place";
import { getTestExpression, getTruthiness, negate } from "./utils/truthiness";
import {
  isExternalSource,
  isRenderingNothingWhenFalse,
  isStateBinding,
  isWholeBinding,
} from "./utils/checks";

const MAX_ALTERNATIVES = 256;
const MAX_REACHABILITY_ROUNDS = 8;

interface Enumerator {
  enumerate: (value: SymbolicValue, constraints: Constraints) => Alternative[];
  getIsTruncated: () => boolean;
}

interface Alternative {
  constraints: Constraints;
  render: SymbolicValue;
  fragments: SymbolicValue[];
  conditions: string[];
  branches: ReadonlySet<string>;
}

interface PartialChildren extends Omit<Alternative, "render"> {
  children: SymbolicValue[];
}

interface RegionBranches {
  branchKeys: Set<string>;
  bindingIds: Set<number>;
  places: string[];
}

const NO_BRANCHES: ReadonlySet<string> = new Set();

const createLeaf = (constraints: Constraints, render: SymbolicValue): Alternative => ({
  constraints,
  render,
  fragments: [],
  conditions: [],
  branches: NO_BRANCHES,
});

const getStateKey = (alternative: Alternative): string =>
  [...alternative.branches].sort().join("|");

type DecisionOutcomes = Map<string, Set<boolean>>;

type FieldCases = AbstractValue[] | "unchanged" | null;

const getBranchKey = (conditional: ConditionalValue): string => {
  const { branch } = conditional;
  return branch.loc === GeneratedSource
    ? `${branch.file}:generated:${branch.terminalId}`
    : `${branch.file}:${branch.loc.start.index}:${branch.loc.end.index}:${branch.terminalId}`;
};

const getLiteralCases = (
  value: SymbolicValue,
  constraints: Constraints | null,
): AbstractValue[] | null => {
  if (value.kind === "Primitive") return [{ kind: "Literal", value: value.value }];
  if (value.kind !== "Conditional") return null;
  const decided = constraints ? evaluate(getTestExpression(value), constraints) : null;
  if (decided !== null)
    return getLiteralCases(decided ? value.consequent : value.alternate, constraints);
  const consequent = getLiteralCases(value.consequent, constraints);
  const alternate = getLiteralCases(value.alternate, constraints);
  return consequent && alternate ? [...consequent, ...alternate] : null;
};

const simplify = (value: SymbolicValue, constraints: Constraints): SymbolicValue =>
  mapSymbolicValue(value, (part) => {
    if (part.kind !== "Conditional") return part;
    const decided = evaluate(getTestExpression(part), constraints);
    return decided === null ? part : decided ? part.consequent : part.alternate;
  });

const getFieldCases = (
  value: SymbolicValue | null,
  path: string[],
  binding: Binding,
  constraints: Constraints | null,
): FieldCases => {
  if (!value) return null;
  if (path.length === 0) return getLiteralCases(value, constraints);
  if (isWholeBinding(value, binding)) return "unchanged";
  if (value.kind !== "ObjectExpression") return null;
  const [field, ...restPath] = path;
  const assigned = value.properties.findLast((property) => property.key === field);
  if (assigned) return getFieldCases(assigned.value, restPath, binding, constraints);
  return value.spreads.some((spread) => isWholeBinding(spread, binding)) ? "unchanged" : null;
};

const getToggleCases = (
  value: SymbolicValue,
  place: Place,
  current: AbstractValue[] | undefined,
): AbstractValue[] | null => {
  if (
    !current ||
    value.kind !== "UnaryExpression" ||
    value.operator !== "!" ||
    value.value.kind !== "Binding"
  )
    return null;
  if (!isSamePlace(getValuePlace(value.value), place)) return null;
  return current.map((candidate): AbstractValue => ({
    kind: "Literal",
    value: getTruthiness(candidate) === "falsy",
  }));
};

const getReachableCases = (
  analysis: ComponentAnalysis,
  binding: Binding,
  path: string[],
  domain: Domain,
): AbstractValue[] | null => {
  const typeCases = domain.kind === "Cases" ? domain.cases : null;
  const updates = analysis.handlers
    .flatMap((handler) => handler.updates)
    .filter((update) => update.binding.id === binding.id);
  // HACK: an untyped `useState()` is typed `undefined` though handlers set it, so ignore its type.
  const isUntypedState =
    typeCases?.every((value) => value.kind === "Literal" && value.value === undefined) ?? false;
  if (isUntypedState && updates.length > 0) return null;
  const initialCases = getFieldCases(binding.initial, path, binding, null);
  if (!Array.isArray(initialCases)) return typeCases;
  let reachable = dedupeValues(initialCases);
  const place = getBindingPlace(binding, path);
  for (let round = 0; round < MAX_REACHABILITY_ROUNDS; round++) {
    const previousCount = reachable.length;
    for (const update of updates) {
      const cases =
        getFieldCases(update.value, path, binding, null) ??
        getToggleCases(update.value, place, reachable);
      if (cases === "unchanged") continue;
      if (!cases) return typeCases;
      reachable = dedupeValues([...reachable, ...cases]);
    }
    if (reachable.length === previousCount) return reachable;
  }
  return typeCases;
};

const getLengthLimitBounds = (binding: Binding): Bound[] => {
  if (!binding.lengthLimit) return [];
  const { arrayLength, isSameLength } = binding.lengthLimit;
  const resultLength = getLengthAtom(binding.id);
  const isNoLonger: Bound = {
    left: resultLength,
    right: arrayLength,
    constant: 0,
    isStrict: false,
  };
  const isNoShorter: Bound = {
    left: arrayLength,
    right: resultLength,
    constant: 0,
    isStrict: false,
  };
  return isSameLength ? [isNoLonger, isNoShorter] : [isNoLonger];
};

const createInitialConstraints = (analysis: ComponentAnalysis): Constraints => {
  const values = new PlaceMap<AbstractValue[]>();
  const bindingsById = new Map(analysis.bindings.map((binding) => [binding.id, binding]));
  for (const [place, domain] of analysis.placeDomains) {
    const binding = bindingsById.get(place.bindingId);
    const cases =
      binding && isStateBinding(binding)
        ? getReachableCases(analysis, binding, place.path, domain)
        : domain.kind === "Cases"
          ? domain.cases
          : null;
    if (cases) values.set(place, cases);
  }
  return {
    values,
    assumptions: new Map(),
    bounds: [],
    invariants: analysis.bindings.flatMap(getLengthLimitBounds),
    unionMemberValues: analysis.unionMemberValues,
    members: new Map(),
  };
};

const isLengthPreserving = (value: SymbolicValue, binding: Binding): boolean => {
  if (value.kind === "ArrayMap") return isWholeBinding(value.array, binding);
  return (
    value.kind === "ArrayExpression" &&
    value.elements.length === 0 &&
    value.spreads.length === 1 &&
    isWholeBinding(value.spreads[0], binding)
  );
};

const getLengthBounds = (value: SymbolicValue, binding: Binding): Bound[] => {
  if (value.kind !== "ArrayExpression") return [];
  const lengthAtom = getLengthAtom(binding.id);
  const minimum: Bound = {
    left: null,
    right: lengthAtom,
    constant: -value.elements.length,
    isStrict: false,
  };
  if (value.spreads.length > 0) return [minimum];
  return [
    minimum,
    {
      left: lengthAtom,
      right: null,
      constant: value.elements.length,
      isStrict: false,
    },
  ];
};

const getDependents = (bindings: Binding[]): Map<number, number[]> => {
  const dependents = new Map<number, number[]>();
  for (const binding of bindings)
    for (const { bindingId } of binding.inputPlaces)
      dependents.set(bindingId, [...(dependents.get(bindingId) ?? []), binding.id]);
  const collect = (bindingId: number, collected: Set<number>): Set<number> => {
    for (const dependentId of dependents.get(bindingId) ?? [])
      if (!collected.has(dependentId)) collect(dependentId, collected.add(dependentId));
    return collected;
  };
  return new Map(
    [...dependents.keys()].map((bindingId) => [bindingId, [...collect(bindingId, new Set())]]),
  );
};

const applyUpdates = (
  updates: StateUpdate[],
  constraints: Constraints,
  reachable: Constraints,
  dependents: Map<number, number[]>,
): Constraints => {
  const next = cloneConstraints(constraints);
  for (const update of updates) {
    for (const [place, reachableValues] of reachable.values) {
      if (place.bindingId !== update.binding.id) continue;
      const current = constraints.values.get(place);
      const cases =
        getFieldCases(update.value, place.path, update.binding, constraints) ??
        getToggleCases(update.value, place, current);
      if (cases === "unchanged") continue;
      next.values.set(place, cases ? dedupeValues(cases) : reachableValues);
    }
    forgetBinding(next, update.binding.id, isLengthPreserving(update.value, update.binding));
    next.bounds.push(...getLengthBounds(update.value, update.binding));
    const dependentIds = new Set(dependents.get(update.binding.id));
    for (const [place, values] of reachable.values)
      if (dependentIds.has(place.bindingId)) next.values.set(place, values);
    for (const dependentId of dependentIds) forgetBinding(next, dependentId, false);
  }
  return next;
};

const getGuardKeys = (update: StateUpdate): string[] => update.guards.map(getValueKey);

const isGuardPrefix = (prefix: string[], guardKeys: string[]): boolean =>
  prefix.every((guardKey, index) => guardKeys[index] === guardKey);

const applyTransition = (
  handler: Handler,
  constraints: Constraints,
  reachable: Constraints,
  dependents: Map<number, number[]>,
): Constraints[] => {
  const pathGuardKeys = new Map(
    handler.updates.map((update) => {
      const guardKeys = getGuardKeys(update);
      return [guardKeys.join("\0"), guardKeys];
    }),
  );
  const applied = [...pathGuardKeys.values()].map((guardKeys) =>
    applyUpdates(
      handler.updates.filter((update) => isGuardPrefix(getGuardKeys(update), guardKeys)),
      constraints,
      reachable,
      dependents,
    ),
  );
  // A guarded update may not run, so the starting constraints stay reachable.
  return handler.updates.some((update) => update.guards.length > 0)
    ? [constraints, ...applied]
    : applied;
};

const createEnumerator = (outcomes: DecisionOutcomes, region: RegionBranches): Enumerator => {
  let isTruncated = false;
  const cache = new WeakMap<SymbolicValue, WeakMap<Constraints, Alternative[]>>();
  const enumerate = (value: SymbolicValue, constraints: Constraints): Alternative[] => {
    let cacheByConstraints = cache.get(value);
    if (!cacheByConstraints) {
      cacheByConstraints = new WeakMap();
      cache.set(value, cacheByConstraints);
    }
    const cached = cacheByConstraints.get(constraints);
    if (cached) return cached;
    const alternatives = enumerateUncached(value, constraints);
    cacheByConstraints.set(constraints, alternatives);
    return alternatives;
  };
  const enumerateUncached = (value: SymbolicValue, constraints: Constraints): Alternative[] => {
    switch (value.kind) {
      case "Conditional": {
        const key = getBranchKey(value);
        if (!region.branchKeys.has(key)) return [createLeaf(constraints, value)];
        const alternatives: Alternative[] = [];
        const test = getTestExpression(value);
        const isDecided = evaluate(test, constraints) !== null;
        for (const outcome of [true, false]) {
          const assumed = assume(test, outcome, constraints);
          if (!assumed) continue;
          outcomes.set(key, new Set([...(outcomes.get(key) ?? []), outcome]));
          const simplified = simplify(test, constraints);
          const label = outcome ? formatSymbolicValue(simplified) : formatNegated(simplified);
          for (const alternative of enumerate(
            outcome ? value.consequent : value.alternate,
            assumed,
          )) {
            if (alternatives.length >= MAX_ALTERNATIVES) {
              isTruncated = true;
              break;
            }
            alternatives.push({
              ...alternative,
              fragments: [alternative.render],
              conditions: isDecided ? alternative.conditions : [label, ...alternative.conditions],
              branches: new Set([...alternative.branches, `${key}:${outcome}`]),
            });
          }
        }
        return alternatives;
      }
      case "JsxExpression":
      case "JsxFragment": {
        let partials: PartialChildren[] = [
          { constraints, children: [], fragments: [], conditions: [], branches: NO_BRANCHES },
        ];
        for (const child of value.children) {
          const nextPartials: PartialChildren[] = [];
          for (const partial of partials) {
            if (nextPartials.length >= MAX_ALTERNATIVES) {
              isTruncated = true;
              break;
            }
            for (const childAlternative of enumerate(child, partial.constraints)) {
              if (nextPartials.length >= MAX_ALTERNATIVES) {
                isTruncated = true;
                break;
              }
              nextPartials.push({
                constraints: childAlternative.constraints,
                children: [...partial.children, childAlternative.render],
                fragments: [...partial.fragments, ...childAlternative.fragments],
                conditions: [...partial.conditions, ...childAlternative.conditions],
                branches: new Set([...partial.branches, ...childAlternative.branches]),
              });
            }
          }
          partials = nextPartials;
        }
        return partials.map((partial) => ({
          constraints: partial.constraints,
          render: { ...value, children: partial.children },
          fragments: partial.fragments,
          conditions: partial.conditions,
          branches: partial.branches,
        }));
      }
      default:
        return [createLeaf(constraints, resolveLiteral(value, constraints))];
    }
  };
  return { enumerate, getIsTruncated: () => isTruncated };
};

const findRegions = (render: SymbolicValue): RegionBranches[] => {
  const decisionSets = new DisjointSet<string>();
  const branchKeys: string[] = [];
  const decisionsByPlace = new PlaceMap<string[]>();
  const places = new PlaceMap<{ name: string; branchKey: string }>();
  const visited = new WeakMap<SymbolicValue, Set<string | null>>();
  const visit = (value: SymbolicValue, enclosingKey: string | null): void => {
    const enclosingKeys = visited.get(value) ?? new Set();
    if (enclosingKeys.has(enclosingKey)) return;
    visited.set(value, enclosingKeys.add(enclosingKey));
    switch (value.kind) {
      case "Conditional": {
        const key = getBranchKey(value);
        if (!branchKeys.includes(key)) branchKeys.push(key);
        decisionSets.union(enclosingKey ? [key, enclosingKey] : [key]);
        forEachSymbolicValue(getTestExpression(value), (part) => {
          if (part.kind !== "Binding") return;
          // Fields of a hook result or context change together, so they join the whole binding.
          const decidingPlaces = [
            isExternalSource(part.binding) ? getBindingPlace(part.binding) : getValuePlace(part),
            ...part.binding.inputPlaces,
          ];
          for (const place of decidingPlaces)
            decisionsByPlace.set(place, [...(decisionsByPlace.get(place) ?? []), key]);
          places.set(getValuePlace(part), {
            name: formatSymbolicValue(part),
            branchKey: key,
          });
        });
        visit(value.consequent, key);
        visit(value.alternate, key);
        return;
      }
      case "JsxExpression":
      case "JsxFragment":
        for (const child of value.children) visit(child, enclosingKey);
        return;
      default:
        return;
    }
  };
  visit(render, null);
  for (const [place, keys] of decisionsByPlace)
    for (const [otherPlace, otherKeys] of decisionsByPlace)
      if (isPlacePrefix(place, otherPlace)) decisionSets.union([...keys, ...otherKeys]);

  const regions = new Map<string, RegionBranches>();
  const getRegion = (key: string): RegionBranches => {
    const root = decisionSets.find(key) ?? key;
    const region = regions.get(root) ?? {
      branchKeys: new Set(),
      bindingIds: new Set(),
      places: [],
    };
    regions.set(root, region);
    return region;
  };
  for (const key of branchKeys) getRegion(key).branchKeys.add(key);
  for (const [place, keys] of decisionsByPlace)
    for (const key of keys) getRegion(key).bindingIds.add(place.bindingId);
  for (const [place, { name, branchKey }] of places) {
    const isNested = places
      .places()
      .some((other) => !isSamePlace(other, place) && isPlacePrefix(other, place));
    const region = getRegion(branchKey);
    if (!isNested && !region.places.includes(name)) region.places.push(name);
  }
  return regions.size > 0
    ? [...regions.values()]
    : [{ branchKeys: new Set(), bindingIds: new Set(), places: [] }];
};

const collectHandlerIds = (render: SymbolicValue, handlerIds: Set<string>): void =>
  forEachJsxElement(render, (element) => {
    for (const prop of element.props) if (prop.handlerId) handlerIds.add(prop.handlerId);
  });

// States don't decide branches nested in tests, so either side may run.
const collectTestedBranchKeys = (render: SymbolicValue): Set<string> => {
  const keys = new Set<string>();
  forEachRenderNode(render, (value) => {
    if (value.kind !== "Conditional") return;
    forEachSymbolicValue(getTestExpression(value), (part) => {
      if (part.kind === "Conditional") keys.add(getBranchKey(part));
    });
  });
  return keys;
};

const collectUnreachableBranches = (
  render: SymbolicValue,
  outcomes: DecisionOutcomes,
): UnreachableBranch[] => {
  const unreachableBranches: Array<UnreachableBranch & { key: string }> = [];
  const reportedKeys = collectTestedBranchKeys(render);
  const narrowedKeys = new Set<string>();
  const pathConditions = new WeakMap<SymbolicValue, Set<string>>();
  const visit = (value: SymbolicValue, conditions: string[]): void => {
    const known = pathConditions.get(value);
    if (known && conditions.every((condition) => known.has(condition))) return;
    const merged = new Set([...(known ?? []), ...conditions]);
    pathConditions.set(value, merged);
    switch (value.kind) {
      case "Conditional": {
        const key = getBranchKey(value);
        const guards = value.guardKeys;
        // Rendered under conditions it wasn't computed under, so its states say nothing about its
        // side.
        if ([...merged].some((condition) => !guards.includes(condition))) narrowedKeys.add(key);
        const reached = outcomes.get(key);
        const test = getTestExpression(value);
        if (reached && !reportedKeys.has(key)) {
          reportedKeys.add(key);
          if (!reached.has(true))
            unreachableBranches.push({
              key,
              branch: value.branch,
              side: true,
              description: `never ${formatSymbolicValue(test)}`,
            });
          if (!reached.has(false) && !isRenderingNothingWhenFalse(value)) {
            unreachableBranches.push({
              key,
              branch: value.branch,
              side: false,
              description: `never ${formatNegated(test)}`,
            });
          }
        }
        if (reached?.has(true)) visit(value.consequent, [...merged, getValueKey(test)]);
        if (reached?.has(false)) visit(value.alternate, [...merged, getValueKey(negate(test))]);
        return;
      }
      case "JsxExpression":
      case "JsxFragment":
        for (const child of value.children) visit(child, [...merged]);
        return;
      default:
        return;
    }
  };
  visit(render, []);
  return unreachableBranches.flatMap(({ key, ...unreachableBranch }) =>
    narrowedKeys.has(key) ? [] : [unreachableBranch],
  );
};

export const enumerateStates = (analysis: ComponentAnalysis): StateReport => {
  const reachable = createInitialConstraints(analysis);
  const dependents = getDependents(analysis.bindings);
  const outcomes: DecisionOutcomes = new Map();
  const regionBranches = findRegions(analysis.render);
  const effectIds = new Set(
    analysis.handlers
      .filter((handler) => handler.trigger.kind === "Effect")
      .map((handler) => handler.id),
  );

  const states: State[] = [];
  const regions: Region[] = [];
  let isTruncated = false;
  regionBranches.forEach((regionBranch, regionIndex) => {
    const enumerator = createEnumerator(outcomes, regionBranch);
    const targetEnumerator = createEnumerator(new Map(), regionBranch);
    const alternatives = enumerator.enumerate(analysis.render, reachable);
    const firstIndex = states.length;
    const stateKeys = alternatives.map(getStateKey);
    const handlers = analysis.handlers.filter((handler) =>
      handler.updates.some((update) => regionBranch.bindingIds.has(update.binding.id)),
    );
    for (const alternative of alternatives) {
      const handlerIds = new Set(effectIds);
      collectHandlerIds(alternative.render, handlerIds);
      const transitions: Transition[] = handlers
        .filter((handler) => handlerIds.has(handler.id))
        .map((handler) => {
          const targetKeys = new Set(
            applyTransition(handler, alternative.constraints, reachable, dependents).flatMap(
              (after) => targetEnumerator.enumerate(analysis.render, after).map(getStateKey),
            ),
          );
          return {
            handlerId: handler.id,
            targets: stateKeys.flatMap((stateKey, targetIndex) =>
              targetKeys.has(stateKey) ? [firstIndex + targetIndex] : [],
            ),
            isAsync: handler.updates.some((update) => update.isAsync),
          };
        });
      states.push({
        region: regionIndex,
        conditions: alternative.conditions,
        render: alternative.render,
        fragments: alternative.fragments,
        transitions,
      });
    }
    isTruncated ||= enumerator.getIsTruncated() || targetEnumerator.getIsTruncated();
    regions.push({
      places: regionBranch.places,
      bindingIds: [...regionBranch.bindingIds],
      states: alternatives.map((_, index) => firstIndex + index),
    });
  });

  return {
    places: new PlaceMap(reachable.values),
    states,
    regions,
    // A truncated enumeration may have missed sides that do run.
    unreachableBranches: isTruncated ? [] : collectUnreachableBranches(analysis.render, outcomes),
    isTruncated,
  };
};
