import type {
  AgentHostDefined,
  ParseNode,
  Value,
  ValueCompletion,
  ValueEvaluator,
} from "@engine262/engine262";
import { SymbolicEngineError } from "./errors.js";
import { andGuard, evaluateGuard, negateGuard, truthyGuard, type Guard } from "./guards.js";
import { getSymbolicEngine, type SymbolicEngine } from "./load-engine.js";
import { getExpressionPlan, type ExpressionPlan } from "./validate-expression.js";

export interface SymbolicOptions {
  maxSteps?: number;
  maxOutcomes?: number;
}

export interface ScalarObservation {
  type: "Undefined" | "Null" | "Boolean" | "String" | "Number" | "BigInt";
  value: string | boolean | null;
}

export interface NormalObservation {
  kind: "normal";
  value: ScalarObservation;
}

export interface ThrowObservation {
  kind: "throw";
  name: string;
  message: string;
}

export interface GuardedOutcome {
  guard: Guard;
  completion: NormalObservation | ThrowObservation;
}

export interface SymbolicExpressionResult {
  scope: "engine262-pure-conditional-expression-v1";
  inputs: string[];
  outcomes: GuardedOutcome[];
  steps: number;
  visitedExpressions: string[];
  originalEngineSha256: string;
  patchedEngineSha256: string;
}

interface ExtendedAgentOptions extends AgentHostDefined {
  evaluateNode?: (node: ParseNode) => ValueEvaluator | undefined;
}

interface BooleanDecision {
  input: string;
  isPositive: boolean;
}

const getBooleanDecision = (guard: Guard): BooleanDecision => {
  if (guard.kind === "truthy") return { input: guard.variable.input, isPositive: true };
  if (guard.kind === "not") {
    const decision = getBooleanDecision(guard.operand);
    return { ...decision, isPositive: !decision.isPositive };
  }
  throw new SymbolicEngineError("Expected a Boolean input guard");
};

class SymbolicEvaluation {
  private readonly booleans = new Map<Value, Guard>();
  private readonly choices = new Map<Value, GuardedOutcome[]>();
  private readonly assignments = new Map<string, boolean>();
  private readonly guards: Guard[] = [];
  private plan: ExpressionPlan = { conditions: new Set(), negations: new Set() };
  private readonly visitedExpressions: string[] = [];
  private outcomeCount = 0;
  private steps = 0;

  constructor(
    private readonly engine: SymbolicEngine,
    private readonly maxSteps: number,
    private readonly maxOutcomes: number,
  ) {}

  private createBoolean = (guard: Guard): Value => {
    const value = this.engine.api.OrdinaryObjectCreate(this.engine.api.Value.null);
    this.booleans.set(value, guard);
    return value;
  };

  private *getValue(node: ParseNode.Expression): ValueEvaluator {
    const { api } = this.engine;
    const reference = api.EnsureCompletion(yield* api.Evaluate(node));
    if (reference instanceof api.ThrowCompletion) return reference;
    return yield* api.GetValue(reference.Value);
  }

  private *evaluateNegation(node: ParseNode.UnaryExpression): ValueEvaluator {
    const { api } = this.engine;
    const value = api.EnsureCompletion(yield* this.getValue(node.UnaryExpression));
    if (value instanceof api.ThrowCompletion) return value;
    const guard = this.booleans.get(value.Value);
    if (!guard) throw new SymbolicEngineError("Expected an internal Boolean token");
    return this.createBoolean(negateGuard(guard));
  }

  private *evaluateConditional(node: ParseNode.ConditionalExpression): ValueEvaluator {
    const { api } = this.engine;
    const condition = api.EnsureCompletion(yield* this.getValue(node.ShortCircuitExpression));
    if (condition instanceof api.ThrowCompletion) return condition;
    const guard = this.booleans.get(condition.Value);
    if (!guard) throw new SymbolicEngineError("Expected a symbolic conditional test");
    const resolved = evaluateGuard(guard, this.assignments);
    if (resolved !== undefined)
      return yield* this.getValue(
        resolved ? node.AssignmentExpression_a : node.AssignmentExpression_b,
      );
    const decision = getBooleanDecision(guard);
    const outcomes: GuardedOutcome[] = [];
    for (const isTrue of [true, false]) {
      this.assignments.set(decision.input, isTrue === decision.isPositive);
      this.guards.push(isTrue ? guard : negateGuard(guard));
      try {
        const value = api.EnsureCompletion(
          yield* this.getValue(isTrue ? node.AssignmentExpression_a : node.AssignmentExpression_b),
        );
        outcomes.push(...this.getOutcomes(value));
      } finally {
        this.guards.pop();
        this.assignments.delete(decision.input);
      }
    }
    const value = api.OrdinaryObjectCreate(api.Value.null);
    this.choices.set(value, outcomes);
    return value;
  }

  private getScalar = (value: Value): ScalarObservation => {
    const { api } = this.engine;
    if (value instanceof api.UndefinedValue) return { type: "Undefined", value: null };
    if (value instanceof api.NullValue) return { type: "Null", value: null };
    if (value instanceof api.BooleanValue) return { type: "Boolean", value: value.value };
    if (value instanceof api.JSStringValue) return { type: "String", value: value.stringValue() };
    if (value instanceof api.NumberValue) {
      const number = value.numberValue();
      return { type: "Number", value: Object.is(number, -0) ? "-0" : String(number) };
    }
    if (value instanceof api.BigIntValue)
      return { type: "BigInt", value: String(value.bigintValue()) };
    throw new SymbolicEngineError("An unsupported value escaped the pure-expression boundary");
  };

  private getErrorField = (value: Value, name: string): string => {
    const { api } = this.engine;
    if (!(value instanceof api.ObjectValue))
      throw new SymbolicEngineError("Expected an engine-created error object");
    const result = api.EnsureCompletion(api.skipDebugger(api.Get(value, api.Value(name))));
    if (result instanceof api.ThrowCompletion || !(result.Value instanceof api.JSStringValue))
      throw new SymbolicEngineError("Cannot observe the engine exception without loss");
    return result.Value.stringValue();
  };

  private getOutcomes = (result: ValueCompletion): GuardedOutcome[] => {
    const { api } = this.engine;
    const completion = api.EnsureCompletion(result);
    if (!(completion instanceof api.ThrowCompletion)) {
      const outcomes = this.choices.get(completion.Value);
      if (outcomes) return outcomes;
    }
    if (++this.outcomeCount > this.maxOutcomes)
      throw new SymbolicEngineError(
        "Symbolic outcome budget exceeded; no complete result produced",
      );
    return [
      {
        guard: andGuard([...this.guards]),
        completion:
          completion instanceof api.ThrowCompletion
            ? {
                kind: "throw",
                name: this.getErrorField(completion.Value, "name"),
                message: this.getErrorField(completion.Value, "message"),
              }
            : { kind: "normal", value: this.getScalar(completion.Value) },
      },
    ];
  };

  evaluate = (source: string, inputs: string[]): SymbolicExpressionResult => {
    const { api } = this.engine;
    const previousAgent = api.surroundingAgent;
    const options: ExtendedAgentOptions = { startEventLoop: false };
    const agent = new api.Agent(options);
    api.setSurroundingAgent(agent);
    try {
      const realm = new api.ManagedRealm();
      const parsed = api.EnsureCompletion(
        realm.compileScript(`(${source}\n)`, { specifier: "symbolic-expression.js" }),
      );
      if (parsed instanceof api.ThrowCompletion)
        throw new SymbolicEngineError(
          `Cannot parse symbolic expression: ${this.getErrorField(parsed.Value, "message")}`,
        );
      const statements = parsed.Value.ECMAScriptCode.ScriptBody?.StatementList;
      if (statements?.length !== 1 || statements[0].type !== "ExpressionStatement")
        throw new SymbolicEngineError("Pass exactly one expression");
      this.plan = getExpressionPlan(statements[0].Expression, new Set(inputs));
      for (const input of inputs) {
        const declaration = api.EnsureCompletion(realm.compileScript(input));
        const statement =
          declaration instanceof api.NormalCompletion
            ? declaration.Value.ECMAScriptCode.ScriptBody?.StatementList[0]
            : undefined;
        if (
          statement?.type !== "ExpressionStatement" ||
          statement.Expression.type !== "IdentifierReference" ||
          statement.Expression.name !== input ||
          ["undefined", "NaN", "Infinity"].includes(input)
        )
          throw new SymbolicEngineError(`Invalid Boolean input name: ${input}`);
        const defined = api.skipDebugger(
          api.CreateDataPropertyOrThrow(
            realm.GlobalObject,
            api.Value(input),
            this.createBoolean(truthyGuard({ input, path: [], measure: "value" })),
          ),
        );
        if (defined instanceof api.ThrowCompletion)
          throw new SymbolicEngineError(`Cannot install Boolean input: ${input}`);
      }
      options.onNodeEvaluation = (node) => {
        if (++this.steps > this.maxSteps)
          throw new SymbolicEngineError(
            "Engine evaluation step budget exceeded; no complete result produced",
          );
        this.visitedExpressions.push(node.sourceText);
      };
      options.evaluateNode = (node) => {
        if (node.type === "ConditionalExpression" && this.plan.conditions.has(node))
          return this.evaluateConditional(node);
        if (node.type === "UnaryExpression" && this.plan.negations.has(node))
          return this.evaluateNegation(node);
        return undefined;
      };
      const outcomes = this.getOutcomes(realm.evaluateScriptSkipDebugger(parsed.Value));
      return {
        scope: "engine262-pure-conditional-expression-v1",
        inputs: [...inputs],
        outcomes,
        steps: this.steps,
        visitedExpressions: [...this.visitedExpressions],
        originalEngineSha256: this.engine.originalSha256,
        patchedEngineSha256: this.engine.patchedSha256,
      };
    } finally {
      api.setSurroundingAgent(previousAgent);
    }
  };
}

export const evaluateSymbolicExpression = async (
  source: string,
  inputs: readonly string[],
  options: SymbolicOptions = {},
): Promise<SymbolicExpressionResult> => {
  const inputNames = [...inputs];
  const maxSteps = options.maxSteps ?? 10000;
  const maxOutcomes = options.maxOutcomes ?? 64;
  if (
    !Number.isSafeInteger(maxSteps) ||
    maxSteps <= 0 ||
    !Number.isSafeInteger(maxOutcomes) ||
    maxOutcomes <= 0
  )
    throw new SymbolicEngineError("Symbolic budgets must be positive safe integers");
  if (
    source.length > 4096 ||
    inputNames.length > 8 ||
    inputNames.some((input) => input.length > 128) ||
    new Set(inputNames).size !== inputNames.length
  )
    throw new SymbolicEngineError("Expression/input budget exceeded or duplicate input names");
  const engine = await getSymbolicEngine();
  return new SymbolicEvaluation(engine, maxSteps, maxOutcomes).evaluate(source, inputNames);
};
