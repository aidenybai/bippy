import type { BinaryOperator } from "../types";

export const LOOSE_EQUALITY_OPERATORS = new Set<BinaryOperator>(["==", "!="]);
export const EQUALITY_OPERATORS = new Set(["===", "!==", "==", "!="]);
