import type { Node } from "typescript/unstable/ast";
import type { Checker, Type } from "typescript/unstable/sync";
import { queryType } from "./query-type";

const typesByChecker = new WeakMap<Checker, WeakMap<Node, Type | undefined>>();

export const getTypeAtLocation = (checker: Checker, node: Node): Type | undefined => {
  const typesByNode = typesByChecker.get(checker) ?? new WeakMap<Node, Type | undefined>();
  typesByChecker.set(checker, typesByNode);
  if (typesByNode.has(node)) return typesByNode.get(node);
  const type = queryType(() => checker.getTypeAtLocation(node)) ?? undefined;
  typesByNode.set(node, type);
  return type;
};
