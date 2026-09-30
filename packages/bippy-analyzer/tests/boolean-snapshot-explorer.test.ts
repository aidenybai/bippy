import { runInNewContext } from "node:vm";
import { expect, it } from "vite-plus/test";
import type { StateCheckpoint } from "../engine/dist/declaration/index.mjs";
import {
  createBooleanSnapshotExplorer,
  specializeGuardedHostTree,
  type BooleanSnapshotExplorationOptions,
} from "../src/index.js";
import { withAbstractFixture, type AbstractFixture } from "./helpers/abstract-fixture.js";

const createOwner = ({ api, agent, realm }: AbstractFixture) => {
  let storage: StateCheckpoint | undefined;
  const contexts = [...agent.executionContextStack];
  return {
    capture: () => {
      storage = api.createStateCheckpoint({
        objects: [realm.GlobalObject],
        environments: [realm.GlobalEnv.DeclarativeRecord],
      });
      return {
        restore: () => {
          storage?.restore();
          agent.executionContextStack.splice(0, agent.executionContextStack.length, ...contexts);
        },
      };
    },
    release: () => storage?.release(),
  };
};

const source = `
  var prefix = 0, count = 0;
  prefix++;
  if (enabled) count = 1;
  if (enabled) count += 2;
  if (details) count += 4;
  JSON.stringify({type: 'output', props: {count, prefix}, children: [String(count)]});
`;

it.each([false, true])(
  "explores correlated shared-prefix snapshots, trueFirst=%s",
  async (trueFirst) => {
    const explorer = await createBooleanSnapshotExplorer();
    await withAbstractFixture((fixture) => {
      const { api, agent, createBoolean, compile } = fixture;
      const enabled = createBoolean("enabled");
      const details = createBoolean("details");
      const unused = createBoolean("unused");
      let prefixVisits = 0,
        captures = 0,
        releases = 0;
      agent.hostDefinedOptions.onNodeEvaluation = (node) => {
        if (node.type === "UpdateExpression" && node.sourceText === "prefix++") prefixVisits++;
      };
      agent.evaluate(compile(source), () => {}, false);
      const report = explorer.explore({
        agent,
        inputs: [
          { name: "enabled", value: enabled },
          { name: "details", value: details },
          { name: "unused", value: unused },
        ],
        trueFirst,
        createOwner: () => {
          captures++;
          const owner = createOwner(fixture);
          return {
            ...owner,
            release: () => {
              owner.release();
              releases++;
            },
          };
        },
        observe: (completion) => {
          expect(completion.Type).toBe("normal");
          if (!(completion.Value instanceof api.JSStringValue))
            throw new Error("Expected snapshot");
          agent.AgentRecord.KeptAlive.clear();
          api.gc();
          return { kind: "commit", snapshot: completion.Value.stringValue() };
        },
      });
      expect(prefixVisits).toBe(1);
      expect(captures).toBe(3);
      expect(releases).toBe(3);
      expect(report.observations).toHaveLength(4);
      expect(report.exploration).toEqual({
        scope: "caller-owned-boolean-evaluation-v1",
        ownership: "not-verified",
        maxForks: 127,
        maxResumes: 10000,
        trueFirst,
        forks: 3,
        resumes: 9,
      });
      expect(Object.isFrozen(report.exploration)).toBe(true);
      expect(report.execution).toBe("not-verified");
      expect(report.coverage).toBe("not-verified");
      for (const enabled of [false, true])
        for (const details of [false, true])
          for (const unused of [false, true]) {
            const selected = specializeGuardedHostTree(
              report,
              new Map(Object.entries({ enabled, details, unused })),
            );
            expect(selected.kind).toBe("selected");
            if (selected.kind !== "selected" || selected.outcome.kind !== "commit")
              throw new Error("Expected commit");
            expect(JSON.parse(selected.outcome.snapshot)).toEqual(
              JSON.parse(runInNewContext(source, { enabled, details, unused })),
            );
          }
      const pause = agent.resumeEvaluate({ pauseOnAbstractBoolean: true });
      expect(pause.done).toBe(false);
      if (pause.done || !pause.value) throw new Error("Expected restored pause");
      expect(pause.value.value).toBe(enabled);
      expect(fixture.realm.GlobalObject.properties.get("count")?.Value).toEqual(api.Value(0));
      expect(() => agent.assertCanPerformHostEffect()).not.toThrow();
    });
  },
);

it.each([
  { maxForks: 0, maxResumes: 10 },
  { maxForks: 3, maxResumes: 0 },
  { maxForks: 1, maxResumes: 10 },
  { maxForks: 3, maxResumes: 2 },
])("reports unexplored guards on budget exhaustion: %j", async (limits) => {
  const explorer = await createBooleanSnapshotExplorer();
  await withAbstractFixture((fixture) => {
    const enabled = fixture.createBoolean("enabled");
    const details = fixture.createBoolean("details");
    fixture.agent.evaluate(fixture.compile(source), () => {}, false);
    const report = explorer.explore({
      agent: fixture.agent,
      inputs: [
        { name: "enabled", value: enabled },
        { name: "details", value: details },
      ],
      createOwner: () => createOwner(fixture),
      observe: () => ({ kind: "commit", snapshot: '"done"' }),
      ...limits,
    });
    expect(
      report.observations.some((observation) => observation.outcome.kind === "incomplete"),
    ).toBe(true);
    for (const enabled of [false, true])
      for (const details of [false, true])
        expect(
          specializeGuardedHostTree(report, new Map(Object.entries({ enabled, details }))).kind,
        ).toBe("selected");
    expect(() => fixture.agent.assertCanPerformHostEffect()).not.toThrow();
  });
});

it("bounds repeated correlated decisions without allocating more forks", async () => {
  const explorer = await createBooleanSnapshotExplorer();
  await withAbstractFixture((fixture) => {
    const enabled = fixture.createBoolean("enabled");
    fixture.agent.evaluate(
      fixture.compile('var count = 0; while (true) { if (enabled) count++; else break; } "done";'),
      () => {},
      false,
    );
    let captures = 0;
    const report = explorer.explore({
      agent: fixture.agent,
      inputs: [{ name: "enabled", value: enabled }],
      maxResumes: 6,
      createOwner: () => {
        captures++;
        return createOwner(fixture);
      },
      observe: () => ({ kind: "commit", snapshot: '"done"' }),
    });
    expect(captures).toBe(1);
    expect(report.observations.map((observation) => observation.outcome.kind)).toEqual([
      "commit",
      "incomplete",
    ]);
  });
});

it("reports an undeclared decision without guessing or observing a completion", async () => {
  const explorer = await createBooleanSnapshotExplorer();
  await withAbstractFixture((fixture) => {
    fixture.createBoolean("enabled");
    fixture.agent.evaluate(fixture.compile('enabled ? "yes" : "no"'), () => {}, false);
    const report = explorer.explore({
      agent: fixture.agent,
      inputs: [],
      createOwner: () => {
        throw new Error("Unexpected capture");
      },
      observe: () => {
        throw new Error("Unexpected observation");
      },
    });
    expect(report.observations[0].outcome.kind).toBe("unsupported");
  });
});

it("leaves concrete completion and guest throw interpretation to the synchronous observer", async () => {
  const explorer = await createBooleanSnapshotExplorer();
  await withAbstractFixture((fixture) => {
    fixture.agent.evaluate(fixture.compile("throw 7"), () => {}, false);
    const report = explorer.explore({
      agent: fixture.agent,
      inputs: [],
      createOwner: () => {
        throw new Error("Unexpected capture");
      },
      observe: (completion) => {
        expect(completion.Type).toBe("throw");
        expect(completion.Value).toEqual(fixture.api.Value(7));
        return { kind: "throw", message: "seven" };
      },
    });
    expect(report.observations[0].outcome).toEqual({ kind: "throw", message: "seven" });
  });
});

it("releases a rejected owner and retains the original capture failure", async () => {
  const explorer = await createBooleanSnapshotExplorer();
  await withAbstractFixture((fixture) => {
    const enabled = fixture.createBoolean("enabled");
    const failure = new Error("unowned state");
    let releases = 0;
    fixture.agent.evaluate(fixture.compile('enabled ? "yes" : "no"'), () => {}, false);
    expect(() =>
      explorer.explore({
        agent: fixture.agent,
        inputs: [{ name: "enabled", value: enabled }],
        createOwner: () => ({
          capture: () => {
            throw failure;
          },
          release: () => {
            releases++;
          },
        }),
        observe: () => {
          throw new Error("Unexpected observation");
        },
      }),
    ).toThrow(failure);
    expect(releases).toBe(1);
    expect(() => fixture.agent.assertCanPerformHostEffect()).not.toThrow();
  });
});

it("retains primary and cleanup failures and releases the evaluation guard", async () => {
  const explorer = await createBooleanSnapshotExplorer();
  await withAbstractFixture((fixture) => {
    const enabled = fixture.createBoolean("enabled");
    const failure = new Error("observation failed"),
      cleanup = new Error("cleanup failed");
    fixture.agent.evaluate(fixture.compile('enabled ? "yes" : "no"'), () => {}, false);
    let caught: unknown;
    try {
      explorer.explore({
        agent: fixture.agent,
        inputs: [{ name: "enabled", value: enabled }],
        createOwner: () => {
          const owner = createOwner(fixture);
          return {
            ...owner,
            release: () => {
              owner.release();
              throw cleanup;
            },
          };
        },
        observe: () => {
          throw failure;
        },
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AggregateError);
    if (!(caught instanceof AggregateError)) throw new Error("Expected aggregate");
    expect(caught.errors).toEqual([failure, cleanup]);
    expect(() => fixture.agent.assertCanPerformHostEffect()).not.toThrow();
  });
});

it("keeps the host-effect guard enabled and returns no partial report on failure", async () => {
  const explorer = await createBooleanSnapshotExplorer();
  await withAbstractFixture((fixture) => {
    const enabled = fixture.createBoolean("enabled");
    let observations = 0,
      releases = 0;
    fixture.agent.evaluate(fixture.compile('if (enabled) Math.random(); "done";'), () => {}, false);
    let failure: unknown, report: unknown;
    try {
      report = explorer.explore({
        agent: fixture.agent,
        inputs: [{ name: "enabled", value: enabled }],
        createOwner: () => {
          const owner = createOwner(fixture);
          return {
            ...owner,
            release: () => {
              owner.release();
              releases++;
            },
          };
        },
        observe: () => {
          observations++;
          return { kind: "commit", snapshot: '"done"' };
        },
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect(String(failure)).toContain("Host effects are unsupported during evaluation checkpoints");
    expect(report).toBeUndefined();
    expect(observations).toBe(1);
    expect(releases).toBe(1);
    let retainedFailure: unknown;
    try {
      fixture.agent.resumeEvaluate();
    } catch (error) {
      retainedFailure = error;
    }
    expect(retainedFailure).toBe(failure);
  });
});

it("copies outcomes before another observer call can mutate them", async () => {
  const explorer = await createBooleanSnapshotExplorer();
  await withAbstractFixture((fixture) => {
    const enabled = fixture.createBoolean("enabled");
    fixture.agent.evaluate(fixture.compile('enabled ? "yes" : "no"'), () => {}, false);
    let snapshot = '"first"',
      count = 0;
    const report = explorer.explore({
      agent: fixture.agent,
      inputs: [{ name: "enabled", value: enabled }],
      createOwner: () => createOwner(fixture),
      observe: () => {
        snapshot = JSON.stringify(String(++count));
        return {
          kind: "commit",
          get snapshot() {
            return snapshot;
          },
        };
      },
    });
    expect(specializeGuardedHostTree(report, new Map([["enabled", false]]))).toMatchObject({
      outcome: { kind: "commit", snapshot: '"1"' },
    });
    expect(specializeGuardedHostTree(report, new Map([["enabled", true]]))).toMatchObject({
      outcome: { kind: "commit", snapshot: '"2"' },
    });
  });
});

it("rejects same-Agent reentrancy across explorer instances", async () => {
  const explorer = await createBooleanSnapshotExplorer();
  const nested = await createBooleanSnapshotExplorer();
  await withAbstractFixture((fixture) => {
    const enabled = fixture.createBoolean("enabled");
    fixture.agent.evaluate(fixture.compile('enabled ? "yes" : "no"'), () => {}, false);
    const options: BooleanSnapshotExplorationOptions = {
      agent: fixture.agent,
      inputs: [{ name: "enabled", value: enabled }],
      createOwner: () => createOwner(fixture),
      observe: () => {
        expect(() => nested.explore(options)).toThrow("already active");
        return { kind: "commit", snapshot: '"done"' };
      },
    };
    expect(explorer.explore(options).observations).toHaveLength(2);
  });
});

it.each([-1, 1.5, Infinity, 256])(
  "validates fork limits before executing the prefix: %s",
  async (maxForks) => {
    const explorer = await createBooleanSnapshotExplorer();
    await withAbstractFixture((fixture) => {
      fixture.agent.evaluate(fixture.compile('var prefix = 1; "done";'), () => {}, false);
      expect(() =>
        explorer.explore({
          agent: fixture.agent,
          inputs: [],
          maxForks,
          createOwner: () => createOwner(fixture),
          observe: () => ({ kind: "commit", snapshot: '"done"' }),
        }),
      ).toThrow(RangeError);
      expect(fixture.realm.GlobalObject.properties.has("prefix")).toBe(false);
    });
  },
);

it("rejects ambiguous input identities before executing the prefix", async () => {
  const explorer = await createBooleanSnapshotExplorer();
  await withAbstractFixture((fixture) => {
    const enabled = fixture.createBoolean("enabled");
    fixture.agent.evaluate(fixture.compile("var prefix = 1; enabled;"), () => {}, false);
    expect(() =>
      explorer.explore({
        agent: fixture.agent,
        inputs: [
          { name: "first", value: enabled },
          { name: "second", value: enabled },
        ],
        createOwner: () => createOwner(fixture),
        observe: () => ({ kind: "commit", snapshot: '"done"' }),
      }),
    ).toThrow("distinct identities");
    expect(fixture.realm.GlobalObject.properties.has("prefix")).toBe(false);
  });
});

it.each(["restore", "observe", "release"])(
  "cleans nested snapshots in LIFO order after %s failure",
  async (stage) => {
    const explorer = await createBooleanSnapshotExplorer();
    await withAbstractFixture((fixture) => {
      const enabled = fixture.createBoolean("enabled"),
        details = fixture.createBoolean("details");
      fixture.agent.evaluate(fixture.compile(source), () => {}, false);
      const failure = new Error(stage);
      const releases: number[] = [];
      let owners = 0,
        observations = 0,
        caught: unknown,
        report: unknown;
      try {
        report = explorer.explore({
          agent: fixture.agent,
          inputs: [
            { name: "enabled", value: enabled },
            { name: "details", value: details },
          ],
          createOwner: () => {
            const index = ++owners;
            const owner = createOwner(fixture);
            return {
              capture: () => {
                const checkpoint = owner.capture();
                return {
                  restore: () => {
                    checkpoint.restore();
                    if (stage === "restore" && index === 2) throw failure;
                  },
                };
              },
              release: () => {
                owner.release();
                releases.push(index);
                if (stage === "release" && index === 2) throw failure;
              },
            };
          },
          observe: () => {
            observations++;
            if (stage === "observe") throw failure;
            return { kind: "commit", snapshot: '"done"' };
          },
        });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBe(failure);
      expect(report).toBeUndefined();
      expect(owners).toBe(2);
      expect(releases).toEqual([2, 1]);
      expect(observations).toBe(stage === "restore" ? 0 : stage === "observe" ? 1 : 2);
      expect(() => fixture.agent.assertCanPerformHostEffect()).not.toThrow();
    });
  },
);

it("locks the Agent before option getters can reenter exploration", async () => {
  const explorer = await createBooleanSnapshotExplorer();
  const nested = await createBooleanSnapshotExplorer();
  await withAbstractFixture((fixture) => {
    const enabled = fixture.createBoolean("enabled");
    fixture.agent.evaluate(fixture.compile('enabled ? "yes" : "no"'), () => {}, false);
    const options: BooleanSnapshotExplorationOptions = {
      agent: fixture.agent,
      inputs: [{ name: "enabled", value: enabled }],
      createOwner: () => createOwner(fixture),
      observe: () => ({ kind: "commit", snapshot: '"done"' }),
    };
    expect(
      explorer.explore({
        ...options,
        get maxForks() {
          expect(() => nested.explore(options)).toThrow("already active");
          return 3;
        },
      }).observations,
    ).toHaveLength(2);
  });
});

it("does not certify isolation when a supplied owner omits guest storage", async () => {
  const explorer = await createBooleanSnapshotExplorer();
  await withAbstractFixture((fixture) => {
    const enabled = fixture.createBoolean("enabled");
    const program = "var count = 0; if(enabled) count++; JSON.stringify(String(count));";
    fixture.agent.evaluate(fixture.compile(program), () => {}, false);
    const report = explorer.explore({
      agent: fixture.agent,
      inputs: [{ name: "enabled", value: enabled }],
      trueFirst: true,
      createOwner: () => {
        const contexts = [...fixture.agent.executionContextStack];
        return {
          capture: () => ({
            restore: () => {
              fixture.agent.executionContextStack.splice(
                0,
                fixture.agent.executionContextStack.length,
                ...contexts,
              );
            },
          }),
          release: () => {},
        };
      },
      observe: (completion) => {
        if (!(completion.Value instanceof fixture.api.JSStringValue))
          throw new Error("Expected text");
        return { kind: "commit", snapshot: completion.Value.stringValue() };
      },
    });
    const result = specializeGuardedHostTree(report, new Map([["enabled", false]]));
    expect(result).toMatchObject({ outcome: { kind: "commit", snapshot: '"1"' } });
    expect(runInNewContext(program, { enabled: false })).toBe('"0"');
    expect(report.execution).toBe("not-verified");
    expect(report.coverage).toBe("not-verified");
  });
});

it("releases snapshots after a report budget failure without returning partial output", async () => {
  const explorer = await createBooleanSnapshotExplorer();
  await withAbstractFixture((fixture) => {
    const enabled = fixture.createBoolean("enabled");
    fixture.agent.evaluate(fixture.compile("enabled ? 1 : 0"), () => {}, false);
    let releases = 0;
    expect(() =>
      explorer.explore({
        agent: fixture.agent,
        inputs: [{ name: "enabled", value: enabled }],
        reportOptions: { maxSnapshotCharacters: 1 },
        createOwner: () => {
          const owner = createOwner(fixture);
          return {
            ...owner,
            release: () => {
              owner.release();
              releases++;
            },
          };
        },
        observe: () => ({ kind: "commit", snapshot: '"too long"' }),
      }),
    ).toThrow("no partial result returned");
    expect(releases).toBe(1);
    expect(() => fixture.agent.assertCanPerformHostEffect()).not.toThrow();
  });
});

it("bounds input discovery before executing the prefix", async () => {
  const explorer = await createBooleanSnapshotExplorer();
  await withAbstractFixture((fixture) => {
    const inputs = Array.from({ length: 129 }, (_, index) => ({
      name: `input${index}`,
      value: fixture.api.BooleanValue.createAbstract(),
    }));
    fixture.agent.evaluate(fixture.compile("var prefix = 1;"), () => {}, false);
    expect(() =>
      explorer.explore({
        agent: fixture.agent,
        inputs,
        createOwner: () => createOwner(fixture),
        observe: () => ({ kind: "commit", snapshot: "null" }),
      }),
    ).toThrow("At most 128");
    expect(fixture.realm.GlobalObject.properties.has("prefix")).toBe(false);
  });
});

it("restores the surrounding Agent on observation failure", async () => {
  const explorer = await createBooleanSnapshotExplorer();
  await withAbstractFixture((fixture) => {
    const previous = new fixture.api.Agent({ startEventLoop: false });
    fixture.agent.evaluate(fixture.compile('"done"'), () => {}, false);
    fixture.api.setSurroundingAgent(previous);
    const failure = new Error("observer failed");
    try {
      expect(() =>
        explorer.explore({
          agent: fixture.agent,
          inputs: [],
          createOwner: () => createOwner(fixture),
          observe: () => {
            throw failure;
          },
        }),
      ).toThrow(failure);
      expect(fixture.api.surroundingAgent).toBe(previous);
    } finally {
      fixture.api.setSurroundingAgent(fixture.agent);
    }
  });
});
