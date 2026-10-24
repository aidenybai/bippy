import DisjointSet from "../react-compiler/Utils/DisjointSet";
import type { Binding, BindingPlace, BindingValue, ConditionalValue, SymbolicValue } from "./types";
import { forEachSymbolicValue } from "./utils/for-each-symbolic-value";
import { formatSymbolicValue } from "./format";
import { PlaceMap } from "./utils/place-map";
import { getBindingPlace } from "./utils/get-binding-place";
import { getValuePlace } from "./utils/get-value-place";
import { isPlacePrefix } from "./utils/is-place-prefix";
import { isSamePlace } from "./utils/is-same-place";
import { getTestExpression } from "./utils/get-test-expression";
import { isExternalSource } from "./utils/is-external-source";
import { getBranchKey } from "./control-flow";
import { getValueKey } from "./utils/get-value-key";

interface TestedPlace {
  name: string;
  branchKey: string;
}

interface BranchTests {
  allBranchKeys: string[];
  branchGroups: DisjointSet<string>;
  branchKeysByPlace: PlaceMap<string[]>;
  branchKeysByUnknown: Map<string, string[]>;
  testedPlaces: PlaceMap<TestedPlace>;
  unknownTestBranchKeys: Set<string>;
  bindingsById: Map<number, Binding>;
}

export interface RegionBranches {
  branchKeys: Set<string>;
  bindingIds: Set<number>;
  placeNames: string[];
  hasUnknownTest: boolean;
}

const getTransitiveInputPlaces = (
  binding: Binding,
  bindingsById: Map<number, Binding>,
): BindingPlace[] => {
  const inputPlaces: BindingPlace[] = [];
  const visitedIds = new Set([binding.id]);
  const pendingPlaces = [...binding.inputPlaces];
  for (let place = pendingPlaces.pop(); place; place = pendingPlaces.pop()) {
    inputPlaces.push(place);
    const inputBinding = bindingsById.get(place.bindingId);
    if (!inputBinding || visitedIds.has(inputBinding.id)) continue;
    visitedIds.add(inputBinding.id);
    pendingPlaces.push(...inputBinding.inputPlaces);
  }
  return inputPlaces;
};

const getDecidingPlaces = (
  testedValue: BindingValue,
  bindingsById: Map<number, Binding>,
): BindingPlace[] => [
  isExternalSource(testedValue.binding)
    ? getBindingPlace(testedValue.binding)
    : getValuePlace(testedValue),
  ...getTransitiveInputPlaces(testedValue.binding, bindingsById),
];

const recordTestedPlaces = (
  branchTests: BranchTests,
  conditional: ConditionalValue,
  branchKey: string,
): void =>
  forEachSymbolicValue(getTestExpression(conditional), (part) => {
    if (part.kind === "Unknown") {
      branchTests.unknownTestBranchKeys.add(branchKey);
      const unknownKey = getValueKey(part);
      branchTests.branchKeysByUnknown.set(unknownKey, [
        ...(branchTests.branchKeysByUnknown.get(unknownKey) ?? []),
        branchKey,
      ]);
    }
    if (part.kind !== "Binding") return;
    for (const place of getDecidingPlaces(part, branchTests.bindingsById))
      branchTests.branchKeysByPlace.set(place, [
        ...(branchTests.branchKeysByPlace.get(place) ?? []),
        branchKey,
      ]);
    branchTests.testedPlaces.set(getValuePlace(part), {
      name: formatSymbolicValue(part),
      branchKey,
    });
  });

const groupBranchesOnNestedPlaces = (branchTests: BranchTests): void => {
  for (const [place, branchKeys] of branchTests.branchKeysByPlace)
    for (const [otherPlace, otherBranchKeys] of branchTests.branchKeysByPlace)
      if (isPlacePrefix(place, otherPlace))
        branchTests.branchGroups.union([...branchKeys, ...otherBranchKeys]);
  for (const branchKeys of branchTests.branchKeysByUnknown.values())
    branchTests.branchGroups.union(branchKeys);
};

const collectBranchTests = (render: SymbolicValue, bindings: Binding[]): BranchTests => {
  const branchTests: BranchTests = {
    allBranchKeys: [],
    branchGroups: new DisjointSet<string>(),
    branchKeysByPlace: new PlaceMap<string[]>(),
    branchKeysByUnknown: new Map(),
    testedPlaces: new PlaceMap<TestedPlace>(),
    unknownTestBranchKeys: new Set(),
    bindingsById: new Map(bindings.map((binding) => [binding.id, binding])),
  };
  const visitedEnclosingKeys = new WeakMap<SymbolicValue, Set<string | null>>();
  const visit = (value: SymbolicValue, enclosingKey: string | null): void => {
    const enclosingKeys = visitedEnclosingKeys.get(value) ?? new Set();
    if (enclosingKeys.has(enclosingKey)) return;
    visitedEnclosingKeys.set(value, enclosingKeys.add(enclosingKey));
    if (value.kind === "JsxExpression" || value.kind === "JsxFragment") {
      for (const child of value.children) visit(child, enclosingKey);
      return;
    }
    if (value.kind !== "Conditional") return;
    const branchKey = getBranchKey(value.branch);
    if (!branchTests.allBranchKeys.includes(branchKey)) branchTests.allBranchKeys.push(branchKey);
    branchTests.branchGroups.union(enclosingKey ? [branchKey, enclosingKey] : [branchKey]);
    recordTestedPlaces(branchTests, value, branchKey);
    visit(value.consequent, branchKey);
    visit(value.alternate, branchKey);
  };
  visit(render, null);
  groupBranchesOnNestedPlaces(branchTests);
  return branchTests;
};

const createEmptyRegion = (): RegionBranches => ({
  branchKeys: new Set(),
  bindingIds: new Set(),
  placeNames: [],
  hasUnknownTest: false,
});

const groupIntoRegions = (branchTests: BranchTests): RegionBranches[] => {
  const regionsByGroup = new Map<string, RegionBranches>();
  const getRegion = (branchKey: string): RegionBranches => {
    const groupKey = branchTests.branchGroups.find(branchKey) ?? branchKey;
    const region = regionsByGroup.get(groupKey) ?? createEmptyRegion();
    regionsByGroup.set(groupKey, region);
    return region;
  };
  for (const branchKey of branchTests.allBranchKeys) getRegion(branchKey).branchKeys.add(branchKey);
  for (const [place, branchKeys] of branchTests.branchKeysByPlace)
    for (const branchKey of branchKeys) getRegion(branchKey).bindingIds.add(place.bindingId);
  for (const branchKey of branchTests.unknownTestBranchKeys)
    getRegion(branchKey).hasUnknownTest = true;
  const testedPlaces = branchTests.testedPlaces.places();
  for (const [place, { name, branchKey }] of branchTests.testedPlaces) {
    const isNested = testedPlaces.some(
      (otherPlace) => !isSamePlace(otherPlace, place) && isPlacePrefix(otherPlace, place),
    );
    const region = getRegion(branchKey);
    if (!isNested && !region.placeNames.includes(name)) region.placeNames.push(name);
  }
  return regionsByGroup.size > 0 ? [...regionsByGroup.values()] : [createEmptyRegion()];
};

export const findRegions = (render: SymbolicValue, bindings: Binding[]): RegionBranches[] =>
  groupIntoRegions(collectBranchTests(render, bindings));
