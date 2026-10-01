import type { Node, Statement } from "oxc-parser";
import type { ModuleRecord } from "../graph/module-types.js";
import { forEachChildNode } from "../parse/ast-walk.js";

const strictRegions = new WeakMap<ModuleRecord, Node[]>();

const hasStrictDirective = (statements: Statement[]): boolean =>
  statements.some((statement) => "directive" in statement && statement.directive === "use strict");

const beginsStrictCode = (node: Node): boolean => {
  switch (node.type) {
    case "ClassDeclaration":
    case "ClassExpression":
      return true;
    case "Program":
      return hasStrictDirective(node.body);
    case "FunctionDeclaration":
    case "FunctionExpression":
    case "ArrowFunctionExpression":
      return node.body?.type === "BlockStatement" && hasStrictDirective(node.body.body);
    default:
      return false;
  }
};

export const isStrictCode = (module: ModuleRecord, node: Node): boolean => {
  if (!module.isCommonJs) return true;
  let regions = strictRegions.get(module);
  if (!regions) {
    regions = [];
    const pending: Node[] = [module.file.program];
    while (pending.length > 0) {
      const current = pending.pop();
      if (!current) break;
      if (beginsStrictCode(current)) regions.push(current);
      else forEachChildNode(current, (child) => pending.push(child));
    }
    strictRegions.set(module, regions);
  }
  return regions.some((region) => region.start <= node.start && region.end >= node.end);
};
