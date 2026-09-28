import type {
  AgentHostDefined,
  Evaluator,
  ParseNode,
  Value,
  ValueCompletion,
  ValueEvaluator,
} from "../../engine/dist/declaration/index.mjs";
import { SymbolicEngineError } from "./errors.js";
import { andGuard, negateGuard, truthyGuard, type Guard } from "./guards.js";
import { getSymbolicEngine, type SymbolicEngine } from "./load-engine.js";
import { getExpressionPlan, type ExpressionPlan } from "./validate-expression.js";
import type { ScalarOperation } from "./scalar-operation.js";

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
  scope: "engine262-pure-scalar-expression-v2";
  inputs: string[];
  outcomes: GuardedOutcome[];
  steps: number;
  visitedExpressions: string[];
  originalEngineSha256: string;
  patchedEngineSha256: string;
}

interface GuardedValue {
  assignments: ReadonlyMap<string, boolean>;
  completion: ValueCompletion;
}

class SymbolicEvaluation {
  private readonly choices = new Map<Value, GuardedValue[]>();
  private assignments = new Map<string, boolean>();
  private replacements = new Map<ParseNode, Value>();
  private plan: ExpressionPlan = { operations: new Map() };
  private readonly visitedExpressions: string[] = [];
  private steps = 0;

  constructor(
    private readonly engine: SymbolicEngine,
    private readonly maxSteps: number,
    private readonly maxOutcomes: number,
  ) {}

  private createChoice = (alternatives: GuardedValue[]): Value => {
    if (alternatives.length === 0) throw new SymbolicEngineError("No feasible scalar alternatives");
    const value = this.engine.api.OrdinaryObjectCreate(this.engine.api.Value.null);
    this.choices.set(value, alternatives);
    return value;
  };

  private getAlternatives = (result: ValueCompletion): GuardedValue[] => {
    const { api } = this.engine;
    const completion = api.EnsureCompletion(result);
    if (!(completion instanceof api.ThrowCompletion)) {
      const alternatives = this.choices.get(completion.Value);
      if (alternatives) return alternatives;
    }
    return [{ assignments: new Map(this.assignments), completion }];
  };

  private getAssignments = (alternative: GuardedValue): Map<string, boolean> | undefined => {
    const assignments = new Map(this.assignments);
    for (const [input, value] of alternative.assignments) {
      if (assignments.has(input) && assignments.get(input) !== value) return undefined;
      assignments.set(input, value);
    }
    return assignments;
  };

  private appendAlternatives = (outcomes: GuardedValue[], result: ValueCompletion): void => {
    for (const alternative of this.getAlternatives(result)) {
      const assignments = this.getAssignments(alternative);
      if (!assignments) continue;
      if (outcomes.length >= this.maxOutcomes)
        throw new SymbolicEngineError(
          "Symbolic outcome budget exceeded; no complete result produced",
        );
      outcomes.push({ assignments, completion: alternative.completion });
    }
  };

  private *getValue(node: ParseNode.Expression): ValueEvaluator {
    const { api } = this.engine;
    const reference = api.EnsureCompletion(yield* api.Evaluate(node));
    if (reference instanceof api.ThrowCompletion) return reference;
    return yield* api.GetValue(reference.Value);
  }

  private *evaluateOperands(
    operation: ScalarOperation,
    values: Value[],
    outcomes: GuardedValue[],
  ): Evaluator<void> {
    const { api } = this.engine;
    if (values.length === operation.operandCount) {
      const previous = this.replacements;
      this.replacements = new Map(previous);
      values.forEach((value, index) => this.replacements.set(operation.children[index], value));
      try {
        this.appendAlternatives(outcomes, yield* operation.evaluate(api));
      } finally {
        this.replacements = previous;
      }
      return;
    }
    const result = yield* this.getValue(operation.children[values.length]);
    for (const alternative of this.getAlternatives(result)) {
      const assignments = this.getAssignments(alternative);
      if (!assignments) continue;
      const previous = this.assignments;
      this.assignments = assignments;
      try {
        const completion = api.EnsureCompletion(alternative.completion);
        if (completion instanceof api.ThrowCompletion)
          this.appendAlternatives(outcomes, completion);
        else yield* this.evaluateOperands(operation, [...values, completion.Value], outcomes);
      } finally {
        this.assignments = previous;
      }
    }
  }

  private *evaluateOperation(operation: ScalarOperation): ValueEvaluator {
    const outcomes: GuardedValue[] = [];
    yield* this.evaluateOperands(operation, [], outcomes);
    return this.createChoice(outcomes);
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
    const outcomes: GuardedValue[] = [];
    this.appendAlternatives(outcomes, result);
    return outcomes.map((outcome) => {
      const completion = api.EnsureCompletion(outcome.completion);
      return {
        guard: andGuard(
          Array.from(outcome.assignments, ([input, value]) => {
            const guard = truthyGuard({ input, path: [], measure: "value" });
            return value ? guard : negateGuard(guard);
          }),
        ),
        completion:
          completion instanceof api.ThrowCompletion
            ? {
                kind: "throw",
                name: this.getErrorField(completion.Value, "name"),
                message: this.getErrorField(completion.Value, "message"),
              }
            : { kind: "normal", value: this.getScalar(completion.Value) },
      };
    });
  };

  evaluate = (source: string, inputs: string[]): SymbolicExpressionResult => {
    const { api } = this.engine;
    const previousAgent = api.surroundingAgent;
    const options: AgentHostDefined = { startEventLoop: false };
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
            this.createChoice(
              [true, false].map((value) => ({
                assignments: new Map([[input, value]]),
                completion: api.Value(value),
              })),
            ),
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
        if (!this.replacements.has(node)) this.visitedExpressions.push(node.sourceText);
      };
      options.evaluateNode = (node) => {
        const replacement = this.replacements.get(node);
        if (replacement !== undefined) return api.GetValue(replacement);
        const operation = this.plan.operations.get(node);
        return operation ? this.evaluateOperation(operation) : undefined;
      };
      const outcomes = this.getOutcomes(realm.evaluateScriptSkipDebugger(parsed.Value));
      return {
        scope: "engine262-pure-scalar-expression-v2",
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
