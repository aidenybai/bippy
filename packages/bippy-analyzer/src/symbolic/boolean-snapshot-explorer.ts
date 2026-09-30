import type {
  Agent,
  BooleanValue,
  ContinuationStateOwner,
  EvaluationCheckpoint,
  NormalCompletion,
  ThrowCompletion,
  Value,
} from "../../engine/dist/declaration/index.mjs";
import { createGuardedHostTreeReport } from "../report/host-tree-report.js";
import type {
  GuardedHostTreeInput,
  GuardedHostTreeReport,
  HostTreeReportOptions,
} from "../report/host-tree-types.js";
import { andGuard, constantGuard, negateGuard, truthyGuard, type Guard } from "./guards.js";
import { getSymbolicEngine } from "./load-engine.js";

export interface BooleanSnapshotInput {
  readonly name: string;
  readonly value: BooleanValue;
}

export interface BooleanSnapshotStateOwner extends ContinuationStateOwner {
  release: () => void;
}

export interface BooleanSnapshotExplorationOptions {
  readonly agent: Agent;
  readonly inputs: readonly BooleanSnapshotInput[];
  readonly createOwner: () => BooleanSnapshotStateOwner;
  readonly observe: (
    completion: NormalCompletion<Value> | ThrowCompletion,
  ) => GuardedHostTreeInput["outcome"];
  readonly maxForks?: number;
  readonly maxResumes?: number;
  readonly trueFirst?: boolean;
  readonly reportOptions?: HostTreeReportOptions;
}

export interface BooleanSnapshotTraversal {
  readonly scope: "caller-owned-boolean-evaluation-v1";
  readonly ownership: "not-verified";
  readonly maxForks: number;
  readonly maxResumes: number;
  readonly trueFirst: boolean;
  readonly forks: number;
  readonly resumes: number;
}

export interface BooleanSnapshotExploration extends GuardedHostTreeReport {
  readonly exploration: BooleanSnapshotTraversal;
}

export interface BooleanSnapshotExplorer {
  explore: (options: BooleanSnapshotExplorationOptions) => BooleanSnapshotExploration;
}

const activeAgents = new WeakSet<Agent>();

const getLimit = (value: number | undefined, fallback: number, maximum: number): number => {
  const limit = value ?? fallback;
  if (!Number.isSafeInteger(limit) || limit < 0 || limit > maximum)
    throw new RangeError(`Exploration limit must be an integer between 0 and ${maximum}`);
  return limit;
};

const copyOutcome = (outcome: GuardedHostTreeInput["outcome"]): GuardedHostTreeInput["outcome"] => {
  const kind = outcome.kind;
  if (kind === "commit") return { kind, snapshot: outcome.snapshot };
  const message = outcome.message;
  const name = outcome.name;
  return name === undefined ? { kind, message } : { kind, message, name };
};

export const createBooleanSnapshotExplorer = async (): Promise<BooleanSnapshotExplorer> => {
  const { api } = await getSymbolicEngine();
  return {
    explore: (options) => {
      const agent = options.agent;
      if (!(agent instanceof api.Agent)) throw new TypeError("Expected a source-built Agent");
      if (activeAgents.has(agent))
        throw new Error("Boolean exploration is already active for this Agent");
      activeAgents.add(agent);
      const previous = api.surroundingAgent;
      try {
        const { createOwner, observe } = options;
        if (typeof createOwner !== "function" || typeof observe !== "function")
          throw new TypeError(
            "Boolean exploration requires synchronous owner and observation callbacks",
          );
        const maxForks = getLimit(options.maxForks, 127, 255);
        const maxResumes = getLimit(options.maxResumes, 10000, 1000000);
        const trueFirst = options.trueFirst ?? false;
        if (typeof trueFirst !== "boolean") throw new TypeError("trueFirst must be a Boolean");
        const reportOptions = { ...options.reportOptions };
        const names: string[] = [];
        const inputs = new Map<BooleanValue, string>();
        for (const input of options.inputs) {
          if (names.length >= 128) throw new RangeError("At most 128 Boolean inputs are supported");
          const { name, value } = input;
          if (!(value instanceof api.BooleanValue) || !api.BooleanValue.isAbstract(value))
            throw new TypeError("Exploration inputs must be opaque engine Booleans");
          if (inputs.has(value))
            throw new TypeError("Exploration inputs must have distinct identities");
          names.push(name);
          inputs.set(value, name);
        }
        const observations: GuardedHostTreeInput[] = [];
        let report = createGuardedHostTreeReport(names, observations, reportOptions);
        let forks = 0;
        let resumes = 0;
        const append = (guard: Guard, outcome: GuardedHostTreeInput["outcome"]): void => {
          observations.push({
            id: `observation-${String(observations.length).padStart(3, "0")}`,
            guard,
            outcome: copyOutcome(outcome),
          });
          report = createGuardedHostTreeReport(names, observations, reportOptions);
        };
        const incomplete = (guard: Guard, message: string): void => {
          append(guard, { kind: "incomplete", message });
        };
        const withCheckpoint = (run: (restore: () => void) => void): void => {
          const owner = createOwner();
          const releaseOwner = owner?.release;
          if (typeof releaseOwner !== "function")
            throw new TypeError("Exploration owner requires release");
          let checkpoint: EvaluationCheckpoint | undefined;
          let failure: unknown;
          let isFailed = false;
          try {
            checkpoint = agent.captureEvaluation(owner);
            run(checkpoint.restore);
            checkpoint.restore();
          } catch (error) {
            isFailed = true;
            failure = error;
          }
          const cleanupErrors: unknown[] = [];
          try {
            checkpoint?.release();
          } catch (error) {
            cleanupErrors.push(error);
          }
          try {
            releaseOwner.call(owner);
          } catch (error) {
            cleanupErrors.push(error);
          }
          if (isFailed && cleanupErrors.length)
            throw new AggregateError(
              [failure, ...cleanupErrors],
              "Boolean exploration and cleanup failed",
            );
          if (isFailed) throw failure;
          if (cleanupErrors.length === 1) throw cleanupErrors[0];
          if (cleanupErrors.length)
            throw new AggregateError(cleanupErrors, "Boolean exploration cleanup failed");
        };
        const visit = (
          initial: ReturnType<Agent["resumeEvaluate"]>,
          assignments: ReadonlyMap<BooleanValue, boolean>,
          guard: Guard,
        ): void => {
          let step = initial;
          while (!step.done) {
            const decision = step.value;
            if (!decision) {
              append(guard, {
                kind: "unsupported",
                message: "Evaluation suspended without a Boolean decision",
              });
              return;
            }
            const name = inputs.get(decision.value);
            if (name === undefined) {
              append(guard, {
                kind: "unsupported",
                message: "Evaluation requested an undeclared Boolean input",
              });
              return;
            }
            const existing = assignments.get(decision.value);
            if (existing !== undefined) {
              if (resumes >= maxResumes) {
                incomplete(guard, "Exploration resume limit reached");
                return;
              }
              resumes++;
              step = agent.resumeEvaluate({
                noBreakpoint: true,
                abstractBooleanDecision: { resume: "abstract-boolean", decision, value: existing },
              });
              continue;
            }
            if (forks >= maxForks) {
              incomplete(guard, "Exploration fork limit reached");
              return;
            }
            if (resumes >= maxResumes) {
              incomplete(guard, "Exploration resume limit reached");
              return;
            }
            forks++;
            withCheckpoint((restore) => {
              for (const choice of trueFirst ? [true, false] : [false, true]) {
                restore();
                const condition = truthyGuard({ input: name, path: [], measure: "value" });
                const branchGuard = andGuard([guard, choice ? condition : negateGuard(condition)]);
                if (resumes >= maxResumes) {
                  incomplete(branchGuard, "Exploration resume limit reached");
                  continue;
                }
                const branch = new Map(assignments);
                branch.set(decision.value, choice);
                resumes++;
                visit(
                  agent.resumeEvaluate({
                    noBreakpoint: true,
                    abstractBooleanDecision: {
                      resume: "abstract-boolean",
                      decision,
                      value: choice,
                    },
                  }),
                  branch,
                  branchGuard,
                );
              }
            });
            return;
          }
          const completion = api.EnsureCompletion(step.value);
          agent.withGCRoots([completion], () => append(guard, observe(completion)));
        };
        api.setSurroundingAgent(agent);
        if (maxResumes === 0) incomplete(constantGuard(true), "Exploration resume limit reached");
        else {
          resumes++;
          visit(
            agent.resumeEvaluate({ pauseOnAbstractBoolean: true, noBreakpoint: true }),
            new Map(),
            constantGuard(true),
          );
        }
        return Object.freeze({
          ...report,
          exploration: Object.freeze({
            scope: "caller-owned-boolean-evaluation-v1",
            ownership: "not-verified",
            maxForks,
            maxResumes,
            trueFirst,
            forks,
            resumes,
          }),
        });
      } finally {
        api.setSurroundingAgent(previous);
        activeAgents.delete(agent);
      }
    },
  };
};
