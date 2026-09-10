import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { UNDEFINED_VALUE, describeValue } from "../src/evaluate/values.js";
import { createStaticRenderer } from "../src/index.js";

const BRANCHED_SOURCE = `
declare const isWide: boolean;
const isLarge = (value: string) => value === "lg";

export const narrowedByEquality = () => {
  const size = isWide ? "lg" : "sm";
  if (size === "lg") return size.toUpperCase();
  return size;
};

export const narrowedByDiscriminant = () => {
  const shape = isWide ? { kind: "circle", radius: 1 } : { kind: "rect", width: 2 };
  return shape.kind === "circle" ? shape.radius : shape.width;
};

export const narrowedByMethodCall = () => {
  const color = isWide ? "#fff" : "rgb(0, 0, 0)";
  return color.charAt(0) === "#" ? color.slice(1) : color;
};

export const notNarrowedByFunctionCall = () => {
  const size = isWide ? "lg" : "sm";
  return isLarge(size) ? size.toUpperCase() : size;
};

export const regExpFromBranch = () => {
  const pattern = isWide ? "a+" : "b+";
  return new RegExp(pattern, "g");
};

export const matchWithBranch = () => {
  const pattern = isWide ? "a+" : "b+";
  return "aaab".match(new RegExp(pattern));
};

export const startsWithBranch = () => {
  const prefix = isWide ? "#" : "rgb";
  return "#fff".startsWith(prefix);
};

export const sliceWithTwoBranches = () => {
  const start = isWide ? 0 : 1;
  const end = isWide ? 2 : 3;
  return "abcd".slice(start, end);
};
`;

const MUTATION_SOURCE = `
declare const outerSize: number;
declare const items: number[];

export const indexAssignmentAppends = () => {
  const list: number[] = [];
  for (let index = 0; index < 3; index++) list[index] = index * 10;
  return [list.length, list[2]];
};

export const indexAssignmentFillsHoles = () => {
  const list = [1];
  list[3] = 4;
  return list;
};

export const lengthAssignmentTruncates = () => {
  const list = [1, 2, 3];
  list.length = 1;
  return list;
};

export const indexAssignmentPastRepeatIsDropped = () => {
  const list = [0, ...items];
  list[0] = 9;
  list[1] = 8;
  return list;
};

export const loopCarriedCounter = () => {
  let count = 0;
  let offset = 0;
  while (offset < outerSize) {
    offset += 100;
    count++;
  }
  return count;
};

export const loopInvariantStaysExact = () => {
  const label = "row";
  let offset = 0;
  while (offset < outerSize) offset += 100;
  return label;
};
`;

const CONTROL_FLOW_SOURCE = `
declare const isWide: boolean;

export const switchOnBranch = () => {
  const step = isWide ? 8 : 4;
  switch (step) {
    case 0:
      return "zero";
    case 4:
      return "four";
    case 8:
      return "eight";
    case 10:
      return "ten";
  }
  return "none";
};

export const switchWithSharedCase = () => {
  const step = isWide ? 8 : 4;
  switch (step) {
    case 4:
    case 8:
      return "either";
    default:
      return "neither";
  }
};

const machine = { prev: 0, next: 0 };

export const returnOrBreakInSwitchLoop = () => {
  machine.next = 0;
  let spinCount = 0;
  while (1) {
    spinCount += 1;
    if (spinCount > 20) return "spun out";
    switch ((machine.prev = machine.next)) {
      case 0:
        if (!isWide) {
          machine.next = 8;
          break;
        }
        machine.next = 4;
        return "beacon";
      case 4:
        return "unreachable";
      case 8:
        machine.next = 10;
        return "fetch";
      case 10:
        return "done";
    }
  }
  return "fell out";
};

export const machineStateAfterLoop = () => {
  returnOrBreakInSwitchLoop();
  return machine.next;
};

export const returnOrContinueInLoop = () => {
  const state = { next: 0 };
  let spinCount = 0;
  while (1) {
    spinCount += 1;
    if (spinCount > 20) return "spun out";
    if (state.next === 0) {
      if (!isWide) {
        state.next = 8;
        continue;
      }
      state.next = 4;
      return "beacon";
    }
    if (state.next === 8) return "fetch";
    return "unreachable " + state.next;
  }
  return "fell out";
};
`;

const COLLECTION_SOURCE = `
declare const salt: string;

const fill = (size: number) => {
  const cache = new Map<string, number>();
  for (let index = 0; index < size; index++) cache.set(salt + index, index);
  return cache;
};

export const smallDynamicMapEnumerates = () => fill(2).get(salt);

export const largeDynamicMapIsUnknown = () => fill(9).get(salt);

export const largeDynamicMapKeepsDecidedMembership = () => {
  const cache = fill(9);
  cache.set("pinned", 1);
  return cache.has("pinned");
};
`;

const EXTERNAL_SOURCE = `
import { cache } from "opaque-store";
declare const isWide: boolean;

export const sameMemberOfEitherLookup = () =>
  isWide ? cache.get("a").error : cache.get("b").error;

export const differentMembersOfEitherLookup = () =>
  isWide ? cache.get("a").error : cache.get("b").result;
`;

const evaluateExports = async (
  source: string,
  exportNames: string[],
): Promise<Record<string, string>> => {
  const rootDirectory = mkdtempSync(join(tmpdir(), "bippy-parser-evaluate-"));
  const entryFile = join(rootDirectory, "module.ts");
  writeFileSync(entryFile, source);
  const renderer = await createStaticRenderer({ rootDirectory });
  const described: Record<string, string> = {};
  await renderer.renderWith((interpreter) => {
    const module = renderer.loadModule(entryFile);
    if (!module) throw new Error(`could not parse ${entryFile}`);
    const context = interpreter.createModuleContext(module);
    for (const exportName of exportNames) {
      const exported = interpreter.evaluateModuleExport(module, exportName);
      described[exportName] = describeValue(interpreter.callValue(exported, [], context, null));
    }
    return UNDEFINED_VALUE;
  });
  return described;
};

describe("branch-valued primitives", () => {
  it("narrows a branched binding by evaluating a pure test once per alternative", async () => {
    const results = await evaluateExports(BRANCHED_SOURCE, [
      "narrowedByEquality",
      "narrowedByDiscriminant",
      "narrowedByMethodCall",
      "notNarrowedByFunctionCall",
    ]);
    expect(results).toEqual({
      narrowedByEquality: 'branch("LG" | "sm")',
      narrowedByDiscriminant: "branch(1 | 2)",
      narrowedByMethodCall: 'branch("fff" | "rgb(0, 0, 0)")',
      notNarrowedByFunctionCall: 'branch("LG" | "SM" | "lg" | "sm")',
    });
  });

  it("distributes builtin calls over a single branched primitive argument", async () => {
    const results = await evaluateExports(BRANCHED_SOURCE, [
      "regExpFromBranch",
      "matchWithBranch",
      "startsWithBranch",
      "sliceWithTwoBranches",
    ]);
    expect(results).toEqual({
      regExpFromBranch: "branch(/a+/g | /b+/g)",
      matchWithBranch: 'branch(["aaa"] | ["b"])',
      startsWithBranch: "branch(true | false)",
      sliceWithTwoBranches: "<string: slice()>",
    });
  });
});

describe("list mutation and uncertain loops", () => {
  it("grows a list through index and length assignment", async () => {
    const results = await evaluateExports(MUTATION_SOURCE, [
      "indexAssignmentAppends",
      "indexAssignmentFillsHoles",
      "lengthAssignmentTruncates",
      "indexAssignmentPastRepeatIsDropped",
    ]);
    expect(results).toEqual({
      indexAssignmentAppends: "[3, 20]",
      indexAssignmentFillsHoles: "[1, undefined, undefined, 4]",
      lengthAssignmentTruncates: "[1]",
      indexAssignmentPastRepeatIsDropped: "[9, repeat(unknown)]",
    });
  });

  it("widens bindings a loop of unknown length keeps changing", async () => {
    const results = await evaluateExports(MUTATION_SOURCE, [
      "loopCarriedCounter",
      "loopInvariantStaysExact",
    ]);
    expect(results).toEqual({
      loopCarriedCounter: "<number: loop-carried value>",
      loopInvariantStaysExact: '"row"',
    });
  });
});

describe("switch dispatch and mixed loop exits", () => {
  it("runs only the cases a branched discriminant can reach", async () => {
    const results = await evaluateExports(CONTROL_FLOW_SOURCE, [
      "switchOnBranch",
      "switchWithSharedCase",
    ]);
    expect(results).toEqual({
      switchOnBranch: 'branch("eight" | "four")',
      switchWithSharedCase: '"either"',
    });
  });

  it("keeps returning paths apart from the paths that go on looping", async () => {
    const results = await evaluateExports(CONTROL_FLOW_SOURCE, [
      "returnOrBreakInSwitchLoop",
      "machineStateAfterLoop",
      "returnOrContinueInLoop",
    ]);
    expect(results).toEqual({
      returnOrBreakInSwitchLoop: 'branch("beacon" | "fetch")',
      machineStateAfterLoop: "branch(4 | 10)",
      returnOrContinueInLoop: 'branch("beacon" | "fetch")',
    });
  });
});

describe("values derived from external packages", () => {
  it("keeps one alternative for derivations analysis cannot tell apart", async () => {
    const results = await evaluateExports(EXTERNAL_SOURCE, [
      "sameMemberOfEitherLookup",
      "differentMembersOfEitherLookup",
    ]);
    expect(results).toEqual({
      sameMemberOfEitherLookup: "opaque-store#cache.get().error",
      differentMembersOfEitherLookup:
        "branch(opaque-store#cache.get().error | opaque-store#cache.get().result)",
    });
  });
});

describe("collections written under dynamic keys", () => {
  it("enumerates a few stored values and gives up on many", async () => {
    const results = await evaluateExports(COLLECTION_SOURCE, [
      "smallDynamicMapEnumerates",
      "largeDynamicMapIsUnknown",
      "largeDynamicMapKeepsDecidedMembership",
    ]);
    expect(results).toEqual({
      smallDynamicMapEnumerates: "branch(0 | 1 | undefined)",
      largeDynamicMapIsUnknown: "unknown(Map.get() with a dynamic key)",
      largeDynamicMapKeepsDecidedMembership: "true",
    });
  });
});
