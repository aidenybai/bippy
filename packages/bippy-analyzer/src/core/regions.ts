import DisjointSet from "../react-compiler/Utils/DisjointSet";
import type { BindingPlace, BindingValue, ConditionalValue, SymbolicValue } from "./types";
import { forEachSymbolicValue } from "./utils/traverse";
import { formatSymbolicValue } from "./format";
import { getLocationKey } from "./utils/hir";
import {
  PlaceMap,
  getBindingPlace,
  getValuePlace,
  isPlacePrefix,
  isSamePlace,
} from "./utils/place";
import { getTestExpression } from "./utils/truthiness";
import { isExternalSource } from "./utils/checks";

interface TestedPlace {
  name: string;
  branchKey: string;
}

interface BranchTests {
  allBranchKeys: string[];
  branchGroups: DisjointSet<string>;
  branchKeysByPlace: PlaceMap<string[]>;
  testedPlaces: PlaceMap<TestedPlace>;
}

export interface RegionBranches {
  branchKeys: Set<string>;
  bindingIds: Set<number>;
  placeNames: string[];
}

export const getBranchKey = (conditional: ConditionalValue): string =>
  `${conditional.branch.file}:${getLocationKey(conditional.branch.loc)}:${conditional.branch.terminalId}`;

const getDecidingPlaces = (testedValue: BindingValue): BindingPlace[] => [
  isExternalSource(testedValue.binding)
    ? getBindingPlace(testedValue.binding)
    : getValuePlace(testedValue),
  ...testedValue.binding.inputPlaces,
];

const recordTestedPlaces = (
  branchTests: BranchTests,
  conditional: ConditionalValue,
  branchKey: string,
): void =>
  forEachSymbolicValue(getTestExpression(conditional), (part) => {
    if (part.kind !== "Binding") return;
    for (const place of getDecidingPlaces(part))
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
};

const collectBranchTests = (render: SymbolicValue): BranchTests => {
  const branchTests: BranchTests = {
    allBranchKeys: [],
    branchGroups: new DisjointSet<string>(),
    branchKeysByPlace: new PlaceMap<string[]>(),
    testedPlaces: new PlaceMap<TestedPlace>(),
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
    const branchKey = getBranchKey(value);
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

export const findRegions = (render: SymbolicValue): RegionBranches[] =>
  groupIntoRegions(collectBranchTests(render));
