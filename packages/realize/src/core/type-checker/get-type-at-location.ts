import type { Node } from "typescript/unstable/ast";
import type { Checker, Type } from "typescript/unstable/sync";
import { queryType } from "./query-type";

export const getTypeAtLocation = (checker: Checker, node: Node): Type | undefined =>
  queryType(() => checker.getTypeAtLocation(node)) ?? undefined;
