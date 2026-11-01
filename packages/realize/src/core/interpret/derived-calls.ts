import { dedupeAbstractValues } from "../values/abstract-values";
import type { Domain, PrimitiveValue, SymbolicValue } from "../types";
import { applyPureFunctionToCases, isPureFunction } from "../interpret/pure-functions";

export interface PureCall {
  callee: string;
  operands: SymbolicValue[];
}

export const getMathCall = (
  methodName: string,
  argumentValues: SymbolicValue[],
): PureCall | null =>
  isPureFunction(`Math.${methodName}`)
    ? { callee: `Math.${methodName}`, operands: argumentValues }
    : null;

export const getLiteralArrayCall = (
  receiver: SymbolicValue,
  methodName: string,
  argumentValues: SymbolicValue[],
): PureCall | null => {
  const [searched] = argumentValues;
  const isLiteralArray =
    receiver.kind === "ArrayExpression" &&
    receiver.spreads.length === 0 &&
    receiver.elements.every((element) => element.kind === "Primitive");
  return isLiteralArray &&
    searched &&
    argumentValues.length === 1 &&
    isPureFunction(`Array.${methodName}`)
    ? { callee: `Array.${methodName}`, operands: [searched, ...receiver.elements] }
    : null;
};

const getDomainLiterals = (value: SymbolicValue): PrimitiveValue[] | null => {
  if (value.kind === "Primitive") return [value.value];
  if (value.kind !== "Binding" || value.path.length > 0) return null;
  const { domain } = value.binding;
  if (domain.kind !== "Cases") return null;
  return domain.cases.every((candidate) => candidate.kind === "Literal")
    ? domain.cases.map((candidate) => candidate.value)
    : null;
};

export const getPureCallDomain = (call: PureCall): Domain | null => {
  const operandCases = call.operands.map(getDomainLiterals);
  if (!operandCases.every((cases): cases is PrimitiveValue[] => cases !== null)) return null;
  const results = applyPureFunctionToCases(call.callee, operandCases);
  return results
    ? {
        kind: "Cases",
        cases: dedupeAbstractValues(results.map((value) => ({ kind: "Literal", value }))),
        origin: "call-sites",
      }
    : null;
};
