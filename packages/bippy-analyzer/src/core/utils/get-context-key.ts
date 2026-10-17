import type { Checker } from "typescript/unstable/sync";
import type { Node } from "typescript/unstable/ast";
import { isPropertyAccessExpression } from "typescript/unstable/ast/is";
import { getDeclarationKey } from "./typescript";

export const getContextKey = (checker: Checker, node: Node): string | null =>
  isPropertyAccessExpression(node) && node.name.text === "Provider"
    ? getDeclarationKey(checker, node.expression)
    : getDeclarationKey(checker, node);
