export interface SymbolicVariable {
  input: string;
  path: string[];
  measure: "value";
}

export interface GuardConstant {
  kind: "constant";
  value: boolean;
}

export interface GuardTruthy {
  kind: "truthy";
  variable: SymbolicVariable;
}

export interface GuardNot {
  kind: "not";
  operand: Guard;
}

export interface GuardAnd {
  kind: "and";
  operands: Guard[];
}

export type Guard = GuardConstant | GuardTruthy | GuardNot | GuardAnd;

export const truthyGuard = (variable: SymbolicVariable): Guard => ({ kind: "truthy", variable });
export const constantGuard = (value: boolean): Guard => ({ kind: "constant", value });

export const negateGuard = (guard: Guard): Guard => {
  if (guard.kind === "not") return guard.operand;
  if (guard.kind === "constant") return constantGuard(!guard.value);
  return { kind: "not", operand: guard };
};

export const andGuard = (operands: Guard[]): Guard => {
  const flattened = operands.flatMap((guard) => (guard.kind === "and" ? guard.operands : [guard]));
  if (flattened.some((guard) => guard.kind === "constant" && !guard.value))
    return constantGuard(false);
  const remaining = flattened.filter((guard) => guard.kind !== "constant");
  if (remaining.length === 0) return constantGuard(true);
  if (remaining.length === 1) return remaining[0];
  return { kind: "and", operands: remaining };
};

export const evaluateGuard = (
  guard: Guard,
  inputs: ReadonlyMap<string, boolean>,
): boolean | undefined => {
  switch (guard.kind) {
    case "constant":
      return guard.value;
    case "truthy":
      return inputs.get(guard.variable.input);
    case "not": {
      const result = evaluateGuard(guard.operand, inputs);
      return result === undefined ? undefined : !result;
    }
    case "and": {
      const results = guard.operands.map((operand) => evaluateGuard(operand, inputs));
      if (results.includes(false)) return false;
      return results.includes(undefined) ? undefined : true;
    }
  }
};
