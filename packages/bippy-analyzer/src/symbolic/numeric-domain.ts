import type {
  AbstractNumberOperation,
  AgentHostDefined,
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

export interface NumericDomainOptions {
  maxInputs?: number;
  maxOperations?: number;
}

export interface NumericDomain {
  readonly scope: "engine262-additive-number-domain-v1";
  readonly agentOptions: Readonly<Required<Pick<AgentHostDefined, "evaluateAbstractNumber">>>;
  createInput: (name: string) => NumberValue;
  getExpression: (value: NumberValue) => NumericExpression;
}

export const createNumericDomain = async (
  options: NumericDomainOptions = {},
): Promise<NumericDomain> => {
  const { maxInputs = 128, maxOperations = 10000 } = options;
  if (
    !Number.isSafeInteger(maxInputs) ||
    maxInputs <= 0 ||
    !Number.isSafeInteger(maxOperations) ||
    maxOperations <= 0
  )
    throw new SymbolicEngineError("Numeric domain budgets must be positive safe integers");
  const { api } = await getSymbolicEngine();
  const inputs = new Map<string, NumberValue>();
  const expressions = new WeakMap<NumberValue, NumericExpression>();
  let operations = 0;

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
  });
};
