import type { CallExpression, Expression, Node, Statement } from "oxc-parser";
import { forEachChildNode, unwrapExpression } from "../parse/ast-walk.js";
import type { ModuleRecord } from "../types.js";

export interface RootRenderCall {
  element: Expression;
  api: "createRoot" | "hydrateRoot" | "render" | "hydrate";
  call: CallExpression;
  /**
   * For calls nested in blocks (a `DOMContentLoaded` handler, an `if`), the
   * statements of each enclosing block that run before the call, outermost
   * first; module-level statements are excluded because module bindings are
   * resolved lazily.
   */
  enclosingStatements: Statement[][];
}

const getCalleeName = (callee: Expression): string | null => {
  if (callee.type === "Identifier") return callee.name;
  if (
    callee.type === "MemberExpression" &&
    !callee.computed &&
    callee.property.type === "Identifier"
  ) {
    return callee.property.name;
  }
  return null;
};

const isRootFactory = (callee: Expression): boolean => {
  const name = getCalleeName(callee);
  return name === "createRoot" || name === "hydrateRoot";
};

const collectCall = (
  call: CallExpression,
  enclosingStatements: Statement[][],
  out: RootRenderCall[],
): void => {
  const callee = unwrapExpression(call.callee);
  const name = getCalleeName(callee);
  if (!name) return;
  const firstArgument = call.arguments[0];
  const secondArgument = call.arguments[1];
  if (name === "render" && callee.type === "MemberExpression") {
    const receiver = unwrapExpression(callee.object);
    if (receiver.type === "CallExpression" && isRootFactory(unwrapExpression(receiver.callee))) {
      if (firstArgument && firstArgument.type !== "SpreadElement") {
        out.push({ element: firstArgument, api: "createRoot", call, enclosingStatements });
      }
      return;
    }
    if (receiver.type === "Identifier" && receiver.name.toLowerCase().includes("root")) {
      if (firstArgument && firstArgument.type !== "SpreadElement") {
        out.push({ element: firstArgument, api: "createRoot", call, enclosingStatements });
      }
      return;
    }
  }
  if (name === "hydrateRoot" && secondArgument && secondArgument.type !== "SpreadElement") {
    out.push({ element: secondArgument, api: "hydrateRoot", call, enclosingStatements });
    return;
  }
  if (
    (name === "render" || name === "hydrate") &&
    call.arguments.length >= 2 &&
    firstArgument &&
    firstArgument.type !== "SpreadElement"
  ) {
    const isReactDomCall =
      callee.type === "Identifier" ||
      (callee.type === "MemberExpression" &&
        callee.object.type === "Identifier" &&
        /react/i.test(callee.object.name));
    if (isReactDomCall) out.push({ element: firstArgument, api: name, call, enclosingStatements });
  }
};

const statementsBefore = (node: Node, key: string, index: number): Statement[] | null =>
  key === "body" && node.type === "BlockStatement" ? node.body.slice(0, index) : null;

const walk = (
  node: Node,
  enclosingStatements: Statement[][],
  visit: (node: Node, enclosingStatements: Statement[][]) => void,
): void => {
  visit(node, enclosingStatements);
  forEachChildNode(node, (child, key, index) => {
    const preceding = statementsBefore(node, key, index);
    walk(child, preceding ? [...enclosingStatements, preceding] : enclosingStatements, visit);
  });
};

export const findRootRenderCalls = (module: ModuleRecord): RootRenderCall[] => {
  const calls: RootRenderCall[] = [];
  walk(module.file.program, [], (node, enclosingStatements) => {
    if (node.type === "CallExpression") collectCall(node, enclosingStatements, calls);
  });
  return calls;
};
