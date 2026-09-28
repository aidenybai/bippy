import type {
  AbstractNumberOperation,
  AgentHostDefined,
  BooleanValue,
  NumberValue,
} from "../../engine/dist/declaration/index.mjs";
import { SymbolicEngineError } from "./errors.js";
import { getSymbolicEngine } from "./load-engine.js";

export interface NumericInputExpression {
  readonly kind: "input";
  readonly name: string;
}

export interface NumericConstantExpression {
  readonly kind: "constant";
  readonly value: string;
}

export interface NumericOperationExpression {
  readonly kind: "operation";
  readonly operator: AbstractNumberOperation["operator"];
  readonly operands: readonly NumericExpression[];
}

export type NumericExpression =
  | NumericInputExpression
  | NumericConstantExpression
  | NumericOperationExpression;

export interface NumericConstantPredicate {
  readonly kind: "constant";
  readonly value: boolean;
}

export interface NumericSameValuePredicate {
  readonly kind: "same-value";
  readonly left: NumericExpression;
  readonly right: NumericExpression;
}

export type NumericPredicate = NumericConstantPredicate | NumericSameValuePredicate;

export interface NumericDomainOptions {
  maxInputs?: number;
  maxOperations?: number;
  maxPredicates?: number;
}

export interface NumericDomain {
  readonly scope: "engine262-additive-number-domain-v1";
  readonly agentOptions: Readonly<
    Required<Pick<AgentHostDefined, "evaluateAbstractNumber" | "evaluateAbstractNumberPredicate">>
  >;
  createInput: (name: string) => NumberValue;
  getExpression: (value: NumberValue) => NumericExpression;
  getPredicate: (value: BooleanValue) => NumericPredicate;
}

export const createNumericDomain = async (
  options: NumericDomainOptions = {},
): Promise<NumericDomain> => {
  const { maxInputs = 128, maxOperations = 10000, maxPredicates = 10000 } = options;
  if (
    !Number.isSafeInteger(maxInputs) ||
    maxInputs <= 0 ||
    !Number.isSafeInteger(maxOperations) ||
    maxOperations <= 0 ||
    !Number.isSafeInteger(maxPredicates) ||
    maxPredicates <= 0
  )
    throw new SymbolicEngineError("Numeric domain budgets must be positive safe integers");
  const { api } = await getSymbolicEngine();
  const inputs = new Map<string, NumberValue>();
  const expressions = new WeakMap<NumberValue, NumericExpression>();
  const predicates = new WeakMap<BooleanValue, NumericSameValuePredicate>();
  const predicateCache = new Map<NumberValue | string, Map<NumberValue | string, BooleanValue>>();
  let operations = 0;
  let predicateCount = 0;

  const getExpression = (value: NumberValue): NumericExpression => {
    if (!(value instanceof api.NumberValue))
      throw new SymbolicEngineError("Expected an engine Number value");
    const expression = expressions.get(value);
    if (expression) return expression;
    if (api.NumberValue.isAbstract(value))
      throw new SymbolicEngineError("Abstract Number belongs to another numeric domain");
    const number = value.numberValue();
    return Object.freeze({
      kind: "constant",
      value: Object.is(number, -0) ? "-0" : String(number),
    });
  };

  const agentOptions: NumericDomain["agentOptions"] = Object.freeze({
    evaluateAbstractNumberPredicate: ({ operator, operands }) => {
      if (operator !== "sameValue" || operands.length !== 2)
        throw new SymbolicEngineError("Unsupported abstract numeric predicate");
      const [left, right] = operands;
      const leftExpression = getExpression(left);
      const rightExpression = getExpression(right);
      if (!operands.some(api.NumberValue.isAbstract))
        throw new SymbolicEngineError("Expected an abstract numeric operand");
      if (left === right) return api.Value.true;
      const leftKey = leftExpression.kind === "constant" ? leftExpression.value : left;
      const rightKey = rightExpression.kind === "constant" ? rightExpression.value : right;
      const existing =
        predicateCache.get(leftKey)?.get(rightKey) ?? predicateCache.get(rightKey)?.get(leftKey);
      if (existing) return existing;
      if (predicateCount >= maxPredicates)
        throw new SymbolicEngineError("Abstract numeric predicate budget exceeded");
      const value = api.BooleanValue.createAbstract();
      predicates.set(
        value,
        Object.freeze({
          kind: "same-value",
          left: leftExpression,
          right: rightExpression,
        }),
      );
      let row = predicateCache.get(leftKey);
      if (!row) {
        row = new Map();
        predicateCache.set(leftKey, row);
      }
      row.set(rightKey, value);
      predicateCount++;
      return value;
    },
    evaluateAbstractNumber: ({ operator, operands }) => {
      if (
        !["add", "subtract", "unaryMinus"].includes(operator) ||
        operands.length !== (operator === "unaryMinus" ? 1 : 2)
      )
        throw new SymbolicEngineError("Unsupported abstract numeric operation");
      if (operations >= maxOperations)
        throw new SymbolicEngineError("Abstract numeric operation budget exceeded");
      const operandExpressions = operands.map(getExpression);
      if (!operands.some(api.NumberValue.isAbstract))
        throw new SymbolicEngineError("Expected an abstract numeric operand");
      const value = api.NumberValue.createAbstract();
      expressions.set(
        value,
        Object.freeze({
          kind: "operation",
          operator,
          operands: Object.freeze(operandExpressions),
        }),
      );
      operations++;
      return value;
    },
  });

  return Object.freeze({
    scope: "engine262-additive-number-domain-v1",
    agentOptions,
    createInput: (name: string): NumberValue => {
      if (typeof name !== "string" || name.length === 0 || name.length > 128)
        throw new SymbolicEngineError("Numeric input names must contain 1 to 128 UTF-16 units");
      const existing = inputs.get(name);
      if (existing) return existing;
      if (inputs.size >= maxInputs) throw new SymbolicEngineError("Numeric input budget exceeded");
      const value = api.NumberValue.createAbstract();
      expressions.set(value, Object.freeze({ kind: "input", name }));
      inputs.set(name, value);
      return value;
    },
    getExpression,
    getPredicate: (value: BooleanValue): NumericPredicate => {
      if (!(value instanceof api.BooleanValue))
        throw new SymbolicEngineError("Expected an engine Boolean value");
      const predicate = predicates.get(value);
      if (predicate) return predicate;
      if (api.BooleanValue.isAbstract(value))
        throw new SymbolicEngineError("Abstract Boolean belongs to another numeric domain");
      return Object.freeze({ kind: "constant", value: value.booleanValue() });
    },
  });
};
