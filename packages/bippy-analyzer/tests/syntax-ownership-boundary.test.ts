import { runInNewContext } from "node:vm";
import { expect, it } from "vite-plus/test";
import type {
  ParseNode,
  ReferenceRecord,
  ScriptSyntaxRegion,
  StateCheckpoint,
} from "../engine/dist/declaration/index.mjs";
import { createBooleanSnapshotExplorer, specializeGuardedHostTree } from "../src/index.js";
import { withAbstractFixture } from "./helpers/abstract-fixture.js";

const source = `
  var prefix = 0;
  prefix++;
  function combine(prefix, value, tail) { return value + tail; }
  combine("prefix", flag ? 1 : 2, 10);
`;

it.each(
  [false, true].flatMap((trueFirst) =>
    [0, 1, 2].flatMap((tamperAt) =>
      [false, true].map((isSyntaxOwned) => ({ trueFirst, tamperAt, isSyntaxOwned })),
    ),
  ),
)("checks original syntax: %j", async ({ trueFirst, tamperAt, isSyntaxOwned }) => {
  const explorer = await createBooleanSnapshotExplorer();
  await withAbstractFixture((fixture) => {
    const { api, agent, realm, compile } = fixture;
    const flag = fixture.createBoolean("flag");
    agent.hostDefinedOptions.scriptSyntax = isSyntaxOwned ? {} : undefined;
    let region: ScriptSyntaxRegion | undefined;
    let argumentsList: readonly ParseNode[] | undefined;
    let tail: ParseNode | undefined;
    let prefixes = 0,
      observations = 0;
    agent.hostDefinedOptions.onNodeEvaluation = (node) => {
      if (isSyntaxOwned) region ??= api.getScriptSyntaxRegion(node);
      if (node.type === "UpdateExpression" && node.sourceText === "prefix++") prefixes++;
      if (node.type === "CallExpression" && "Arguments" in node) {
        argumentsList = node.Arguments;
        tail = node.Arguments[2];
      }
    };
    agent.evaluate(compile(source), () => {}, false);
    const explore = () =>
      explorer.explore({
        agent,
        inputs: [{ name: "flag", value: flag }],
        trueFirst,
        createOwner: () => {
          const contexts = [...agent.executionContextStack];
          let storage: StateCheckpoint | undefined;
          const lists = new Set<unknown[]>();
          const references = new Set<ReferenceRecord>();
          return {
            references: (value: object) => {
              if (value instanceof api.ReferenceRecord) references.add(value);
              if (
                Array.isArray(value) &&
                value.length === 1 &&
                value[0] instanceof api.JSStringValue &&
                value[0].stringValue() === "prefix"
              )
                lists.add(value);
              return [];
            },
            capture: () => {
              if (isSyntaxOwned) {
                if (!region) throw new Error("Missing syntax region");
                expect(region.root.sourceText).toBe(source);
                region.validate();
              }
              if (!argumentsList || !tail || tail.type !== "NumericLiteral")
                throw new Error("Missing original call syntax");
              expect(Object.hasOwn(argumentsList, "location")).toBe(true);
              const originalArguments = argumentsList;
              if (!Array.isArray(originalArguments)) throw new Error("Expected syntax list");
              expect(() => api.createStateCheckpoint({ nativeLists: [originalArguments] })).toThrow(
                "Checkpoint requires canonical native list entries",
              );
              expect(lists.size).toBeGreaterThan(0);
              storage = api.createStateCheckpoint({
                objects: [realm.GlobalObject],
                environments: [realm.GlobalEnv.DeclarativeRecord],
                nativeLists: [...lists],
                referenceRecords: [...references],
              });
              return {
                restore: () => {
                  region?.validate();
                  storage?.restore();
                  agent.executionContextStack.splice(
                    0,
                    agent.executionContextStack.length,
                    ...contexts,
                  );
                },
              };
            },
            release: () => storage?.release(),
          };
        },
        observe: (completion) => {
          expect(completion.Type).toBe("normal");
          if (!(completion.Value instanceof api.NumberValue)) throw new Error("Expected number");
          if (!tail) throw new Error("Missing original tail syntax");
          observations++;
          if (observations === tamperAt) expect(Reflect.set(tail, "value", 100)).toBe(true);
          return {
            kind: "commit",
            snapshot: JSON.stringify(String(completion.Value.numberValue())),
          };
        },
      });
    if (tamperAt && isSyntaxOwned) {
      let failure: unknown;
      try {
        explore();
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(Error);
      if (!(failure instanceof Error)) throw new Error("Missing restore failure");
      expect(failure.message).toBe("Read-only script syntax changed");
      expect(observations).toBe(tamperAt);
      expect(prefixes).toBe(1);
      return;
    }
    const report = explore();
    expect(prefixes).toBe(1);
    expect(report.execution).toBe("not-verified");
    expect(report.coverage).toBe("not-verified");
    for (const choice of [false, true]) {
      const selected = specializeGuardedHostTree(report, new Map([["flag", choice]]));
      if (selected.kind !== "selected" || selected.outcome.kind !== "commit")
        throw new Error("Expected commit");
      expect(JSON.parse(selected.outcome.snapshot)).toBe(
        String((choice === trueFirst || tamperAt !== 1 ? 10 : 100) + (choice ? 1 : 2)),
      );
      expect(runInNewContext(source, { flag: choice })).toBe(choice ? 11 : 12);
    }
  });
});

it("requires caller validation before accepting a no-fork observation", async () => {
  const explorer = await createBooleanSnapshotExplorer();
  await withAbstractFixture(({ api, agent, realm }) => {
    agent.hostDefinedOptions.scriptSyntax = {};
    const script = api.ParseScript("1;", realm);
    if (Array.isArray(script)) throw new Error("Expected script");
    const region = api.getScriptSyntaxRegion(script.ECMAScriptCode);
    if (!region) throw new Error("Missing syntax region");
    agent.evaluate(api.ScriptEvaluation(script), () => {}, false);
    let captures = 0,
      observations = 0;
    const exploreAndValidate = () => {
      region.validate();
      const report = explorer.explore({
        agent,
        inputs: [],
        createOwner: () => {
          captures++;
          throw new Error("Unexpected fork");
        },
        observe: () => {
          observations++;
          Reflect.set(region.root.location, "startIndex", 1);
          return { kind: "commit", snapshot: '"1"' };
        },
      });
      region.validate();
      return report;
    };
    expect(exploreAndValidate).toThrow("Read-only script syntax changed");
    expect(captures).toBe(0);
    expect(observations).toBe(1);
  });
});
