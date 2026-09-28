export { evaluateSymbolicExpression } from "./symbolic/evaluate.js";
export type {
  GuardedOutcome,
  NormalObservation,
  ScalarObservation,
  SymbolicExpressionResult,
  SymbolicOptions,
  ThrowObservation,
} from "./symbolic/evaluate.js";
export type {
  Guard,
  GuardAnd,
  GuardConstant,
  GuardNot,
  GuardTruthy,
  SymbolicVariable,
} from "./symbolic/guards.js";
export { SymbolicEngineError } from "./symbolic/errors.js";
