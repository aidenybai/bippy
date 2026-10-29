import type { Checker, Type, TypeReference } from "typescript/unstable/sync";
import { queryType } from "./query-type";

export const getTypeArguments = (checker: Checker, type: TypeReference): readonly Type[] =>
  queryType(() => checker.getTypeArguments(type)) ?? [];
