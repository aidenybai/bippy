import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import {
  type ConcolicExploration,
  type ConcolicPath,
  explorePaths,
} from "../src/concolic/explore.js";
import { instrumentSource, SiteTable } from "../src/concolic/instrument.js";
import { TransformCache } from "../src/concolic/realm.js";
import { createSpaRunner } from "../src/concolic/spa-runner.js";
import { assembleStateSpace } from "../src/concolic/state-space.js";
import { SPA_PROFILE } from "../src/frameworks/index.js";
import { ModuleResolver } from "../src/graph/module-resolver.js";
import type { RuntimeFiberSnapshot } from "../src/harness/snapshot.js";
import { MARKER_NAMES } from "../src/materialize/markers.js";

const FIXTURES = join(import.meta.dirname, "concolic-fixtures");

const explore = (fixture: string, maxPaths = 8): Promise<ConcolicExploration> => {
  const rootDirectory = join(FIXTURES, fixture);
  return explorePaths({
    realm: {
      rootDirectory,
      servedDirectory: rootDirectory,
      url: "http://localhost:3000/",
      resolver: new ModuleResolver({ rootDirectory }),
      isApplicationFile: (filePath) => !filePath.includes("/node_modules/"),
      environment: { declared: null, defines: {} },
      cache: new TransformCache(),
      globals: {},
    },
    runner: createSpaRunner(
      { servedDirectory: rootDirectory, entry: null, rootComponent: null, bootstrap: [] },
      rootDirectory,
    ),
    settleMs: 100,
    maxPaths,
  });
};

const collectNames = (fibers: RuntimeFiberSnapshot[], names: string[] = []): string[] => {
  for (const fiber of fibers) {
    if (fiber.name !== null) names.push(fiber.name);
    collectNames(fiber.children, names);
  }
  return names;
};

const namesOf = (path: ConcolicPath): string[] => collectNames(path.snapshot.roots);

const componentNamesOf = (path: ConcolicPath): string[] =>
  collectNames(path.snapshot.roots.flatMap((root) => root.children)).filter(
    (name) => name !== "App" && /^[A-Z]/.test(name),
  );

const freshDecisionsOf = (path: ConcolicPath) =>
  path.decisions.filter((decision) => decision.isFresh);

describe("concolic exploration", () => {
  it("forks on a symbolic branch and replays every alternative in a fresh realm", async () => {
    const exploration = await explore("feature-flag");
    expect(exploration.paths.map((path) => path.error)).toEqual([null, null, null, null]);
    expect(exploration.omitted).toEqual([]);

    const [first] = exploration.paths;
    expect(first.pinned).toEqual([]);
    expect(freshDecisionsOf(first).map((decision) => decision.key)).toEqual([
      "truthy environment(env.FEATURE_FLAG)",
      'truthy ===(typeof(environment(env.FEATURE_FLAG)), "string")',
    ]);

    const rendered = exploration.paths.map((path) => componentNamesOf(path));
    expect(new Set(rendered.map((names) => names.join(" ")))).toEqual(
      new Set(["Disabled Other", "Disabled Text", "Enabled Other", "Enabled Text"]),
    );
    for (const path of exploration.paths.slice(1)) {
      expect(path.pinned.length).toBeGreaterThan(0);
      for (const pinned of path.pinned) {
        const replayed = path.decisions.find((decision) => decision.key === pinned.key);
        expect(replayed?.choice).toBe(pinned.choice);
        expect(replayed?.isFresh).toBe(false);
      }
    }
  });

  it("correlates repeated reads of the same symbolic so one variable decides both uses", async () => {
    const exploration = await explore("feature-flag");
    for (const path of exploration.paths) {
      const truthyDecisions = path.decisions.filter(
        (decision) => decision.key === "truthy environment(env.FEATURE_FLAG)",
      );
      expect(truthyDecisions.length).toBe(1);
      const names = namesOf(path);
      const isEnabled = names.includes("Enabled");
      expect(names.includes("Disabled")).toBe(!isEnabled);
      expect(truthyDecisions[0].choice).toBe(isEnabled ? 1 : 0);
    }
    const symbolicKeys = exploration.paths[0].symbolics.map((symbolic) => symbolic.key);
    expect(symbolicKeys.filter((key) => key === "environment(env.FEATURE_FLAG)")).toHaveLength(1);
  });

  it("keys symbolic property paths so `user.isAdmin` is one variable across an async response", async () => {
    const exploration = await explore("response-shape");
    expect(exploration.paths.map((path) => path.error)).toEqual([null, null, null]);
    expect(exploration.omitted).toEqual([]);

    const [nullBody, ...loadedBodies] = exploration.paths;
    expect(nullBody.decisions.map((decision) => decision.key)).toEqual([
      "nullish fetch(GET /api/user).body",
    ]);
    expect(namesOf(nullBody)).toContain("span");
    expect(loadedBodies).toHaveLength(2);
    for (const path of loadedBodies) {
      expect(
        path.pinned.filter((pinned) => pinned.key === "nullish fetch(GET /api/user).body"),
      ).toHaveLength(1);
      const adminDecisions = path.decisions.filter(
        (decision) => decision.key === "truthy fetch(GET /api/user).body.isAdmin",
      );
      expect(adminDecisions).toHaveLength(1);
      const names = namesOf(path);
      expect(names.includes("Admin")).toBe(adminDecisions[0].choice === 1);
      expect(names.includes("Member")).toBe(adminDecisions[0].choice === 0);
      expect(names).toContain(MARKER_NAMES.unknown);
      expect(path.leaks.map((leak) => leak.kind)).toEqual(["native-call"]);
      expect(path.leaks[0].symbolic).toBe("fetch(GET /api/user).body");
    }
    const keys = loadedBodies[0].symbolics.map((symbolic) => symbolic.key);
    expect(keys).toContain("fetch(GET /api/user).body.isAdmin");
    expect(keys).toContain("fetch(GET /api/user).body.name");
    expect(keys.filter((key) => key === "fetch(GET /api/user).body")).toHaveLength(1);
  });

  it("records symbolics crossing into natives as leaks instead of throwing or coercing silently", async () => {
    const exploration = await explore("native-boundary", 1);
    const [path] = exploration.paths;
    expect(path.error).toBeNull();
    expect(namesOf(path)).toContain("output");
    const keys = path.symbolics.map((symbolic) => symbolic.key);
    expect(keys).toContain("JSON.stringify(environment(env.LABEL))");
    expect(keys).toContain('template("", environment(env.LABEL), "!").split("!").length');
    expect(path.leaks.length).toBeGreaterThan(0);
    for (const leak of path.leaks) {
      expect(leak.kind).toBe("concretized");
      expect(leak.symbolic).toBe("JSON.stringify(environment(env.LABEL))");
    }
  });

  it("assembles explored paths into a state space with one state per distinct tree", async () => {
    const exploration = await explore("feature-flag");
    const stateSpace = assembleStateSpace(
      exploration,
      SPA_PROFILE,
      SPA_PROFILE.defaultAnchor ?? null,
    );
    expect(stateSpace.states).toHaveLength(4);
    expect(stateSpace.omitted).toBeNull();
    expect(stateSpace.duplicatePaths).toBe(0);
  });
});

describe("instrumentation", () => {
  it("routes operators, branches and members through the hook object", () => {
    const sites = new SiteTable();
    const { code, skipped } = instrumentSource({
      filePath: "/app/example.ts",
      displayPath: "example.ts",
      sourceText: "const label = typeof user.name === 'string' ? `${user.name}!` : count + 1;",
      lang: "ts",
      sites,
    });
    expect(skipped).toBe(0);
    expect(code).toContain("J$.");
    expect(code).not.toContain("user.name ===");
    expect(code).not.toContain("count + 1");
  });
});
