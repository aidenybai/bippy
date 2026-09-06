import { describe, expect, it } from "vite-plus/test";
import {
  type BranchSnapshot,
  type FiberSnapshot,
  formatMismatches,
  type ListSnapshot,
  matchSnapshots,
  type NodeSnapshot,
  type UnknownSnapshot,
} from "@bippy/parser";

type FiberOverrides = Partial<Omit<FiberSnapshot, "kind" | "children">>;

const fiber = (
  tag: FiberSnapshot["tag"],
  name: string | null = null,
  children: NodeSnapshot[] = [],
  overrides: FiberOverrides = {},
): FiberSnapshot => ({
  kind: "fiber",
  id: 0,
  owner: null,
  tag,
  name,
  key: null,
  text: null,
  children,
  hooks: null,
  annotations: [],
  fallback: null,
  location: null,
  ...overrides,
});

const host = (tagName: string, children: NodeSnapshot[] = [], overrides: FiberOverrides = {}) =>
  fiber("HostComponent", tagName, children, overrides);
const textFiber = (text: string | null) => fiber("HostText", null, [], { text });
const branch = (test: string, ...alternatives: NodeSnapshot[][]): BranchSnapshot => ({
  kind: "branch",
  test,
  alternatives,
});
const list = (items: NodeSnapshot[]): ListSnapshot => ({
  kind: "list",
  description: "items",
  items,
});
const anything = (): UnknownSnapshot => ({ kind: "unknown", description: "?" });
const root = (children: NodeSnapshot[]) => fiber("HostRoot", null, children);

describe("matchSnapshots", () => {
  it("accepts identical trees and explains every runtime fiber", () => {
    const tree = root([host("div", [textFiber("hi"), host("span")])]);
    const result = matchSnapshots(tree, tree);
    expect(result.isMatch).toBe(true);
    expect(result.runtimeFiberCount).toBe(4);
    expect(result.explainedFiberCount).toBe(4);
  });

  it("reports the first structural divergence with a readable path", () => {
    const expected = root([host("div", [host("span"), host("em")])]);
    const actual = root([host("div", [host("span"), host("strong")])]);
    const result = matchSnapshots(expected, actual);
    expect(result.isMatch).toBe(false);
    expect(result.explainedFiberCount).toBe(0);
    expect(formatMismatches(result.mismatches)).toBe(
      "HostRoot › div\n    child 2 is strong; expected em",
    );
  });

  it("checks names, keys and text on identified fibers only", () => {
    const named = (name: string, key: string | null = null) =>
      root([fiber("FunctionComponent", name, [], { key })]);
    expect(matchSnapshots(named("App"), named("Other")).mismatches[0].message).toBe(
      "child 1 is Other; expected App",
    );
    expect(matchSnapshots(named("App", "a"), named("App", "b")).mismatches[0].message).toBe(
      'child 1 is App key="b"; expected App key="a"',
    );
    expect(matchSnapshots(named("App"), named("App", "b")).isMatch).toBe(true);
    expect(matchSnapshots(root([textFiber("yes")]), root([textFiber("no")])).isMatch).toBe(false);
    expect(matchSnapshots(root([textFiber(null)]), root([textFiber("any")])).isMatch).toBe(true);
    const anonymous = root([fiber(null, null, [host("div")])]);
    expect(matchSnapshots(anonymous, named("App")).isMatch).toBe(false);
    expect(matchSnapshots(anonymous, root([host("section", [host("div")])])).isMatch).toBe(true);
  });

  it("describes attribute mismatches at the root, which has no siblings to summarize", () => {
    const expected = fiber("HostRoot", null, [], { key: "a" });
    expect(matchSnapshots(expected, root([])).mismatches[0].message).toBe(
      'key null where "a" was expected',
    );
  });

  it("matches any alternative of a branch, including the empty one", () => {
    const expected = root([
      host("ul", [branch("isOpen", [host("li", [], { key: "open" })], []), host("footer")]),
    ]);
    expect(matchSnapshots(expected, root([host("ul", [host("footer")])])).isMatch).toBe(true);
    expect(
      matchSnapshots(
        expected,
        root([host("ul", [host("li", [], { key: "open" }), host("footer")])]),
      ).isMatch,
    ).toBe(true);
    const result = matchSnapshots(
      expected,
      root([host("ul", [host("li", [], { key: "closed" }), host("footer")])]),
    );
    expect(result.isMatch).toBe(false);
    expect(result.mismatches).toEqual([
      {
        path: "HostRoot › ul",
        message: 'child 1 is li key="closed"; expected li key="open" | footer',
      },
    ]);
  });

  it("matches lists as zero or more repetitions of their item sequence", () => {
    const expected = root([host("ul", [list([host("li", [textFiber(null)])])])]);
    expect(matchSnapshots(expected, root([host("ul")])).isMatch).toBe(true);
    const three = root([
      host("ul", [
        host("li", [textFiber("a")]),
        host("li", [textFiber("b")]),
        host("li", [textFiber("c")]),
      ]),
    ]);
    const result = matchSnapshots(expected, three);
    expect(result.isMatch).toBe(true);
    expect(result.explainedFiberCount).toBe(result.runtimeFiberCount);
    const broken = root([host("ul", [host("li", [textFiber("a")]), host("li")])]);
    expect(matchSnapshots(expected, broken).mismatches[0].message).toBe(
      'children ended after 0; expected "?"',
    );
  });

  it("lets unknown nodes absorb siblings without counting them as explained", () => {
    const expected = root([host("div", [host("header"), anything(), host("footer")])]);
    const actual = root([
      host("div", [host("header"), host("p", [textFiber("x")]), host("aside"), host("footer")]),
    ]);
    const result = matchSnapshots(expected, actual);
    expect(result.isMatch).toBe(true);
    expect(result.runtimeFiberCount).toBe(7);
    expect(result.explainedFiberCount).toBe(4);
  });

  it("prefers the path that explains the most fibers when several accept", () => {
    const expected = root([host("div", [anything(), branch("flag", [host("footer")], [])])]);
    const actual = root([host("div", [host("main"), host("footer")])]);
    const result = matchSnapshots(expected, actual);
    expect(result.isMatch).toBe(true);
    expect(result.explainedFiberCount).toBe(3);
  });

  it("surfaces nested mismatches instead of the sibling that contains them", () => {
    const expected = root([host("section", [host("article", [host("h1"), host("p")])])]);
    const actual = root([host("section", [host("article", [host("h1"), host("h2")])])]);
    expect(formatMismatches(matchSnapshots(expected, actual).mismatches)).toBe(
      "HostRoot › section › article\n    child 2 is h2; expected p",
    );
  });

  it("matches a suspended Suspense boundary against its fallback", () => {
    const primary = fiber("OffscreenComponent", null, [fiber("FunctionComponent", "Lazy")]);
    const expected = root([
      fiber("SuspenseComponent", null, [primary], {
        fallback: [host("p", [textFiber("loading")])],
      }),
    ]);
    const suspended = root([
      fiber("SuspenseComponent", null, [
        fiber("OffscreenComponent"),
        fiber("Fragment", null, [host("p", [textFiber("loading")])]),
      ]),
    ]);
    const resolved = root([fiber("SuspenseComponent", null, [primary])]);
    const suspendedResult = matchSnapshots(expected, suspended);
    expect(suspendedResult.isMatch).toBe(true);
    expect(suspendedResult.explainedFiberCount).toBe(suspendedResult.runtimeFiberCount);
    expect(matchSnapshots(expected, resolved).isMatch).toBe(true);
    const wrongFallback = root([
      fiber("SuspenseComponent", "Suspense", [
        fiber("OffscreenComponent"),
        fiber("Fragment", null, [host("p", [textFiber("busy")])]),
      ]),
    ]);
    expect(formatMismatches(matchSnapshots(expected, wrongFallback).mismatches)).toBe(
      'HostRoot › Suspense › fallback › p\n    child 1 is "busy"; expected "loading"',
    );
  });
});
