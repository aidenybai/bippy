import type { CallExpression, Expression, Node } from "oxc-parser";
import type { ModuleRecord } from "../types.js";

export interface RootRenderCall {
  element: Expression;
  api: "createRoot" | "hydrateRoot" | "render" | "hydrate";
  call: CallExpression;
}

const isRootFactory = (callee: Expression): boolean => {
  if (callee.type === "Identifier")
    return callee.name === "createRoot" || callee.name === "hydrateRoot";
  if (
    callee.type === "MemberExpression" &&
    !callee.computed &&
    callee.property.type === "Identifier"
  ) {
    return callee.property.name === "createRoot" || callee.property.name === "hydrateRoot";
  }
  return false;
};

const calleeName = (callee: Expression): string | null => {
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

const unwrapCallee = (callee: Expression): Expression => {
  let current = callee;
  while (
    current.type === "TSNonNullExpression" ||
    current.type === "TSAsExpression" ||
    current.type === "ParenthesizedExpression"
  ) {
    current = current.expression;
  }
  return current;
};

const collectCall = (call: CallExpression, out: RootRenderCall[]): void => {
  const callee = unwrapCallee(call.callee);
  const name = calleeName(callee);
  if (!name) return;
  const firstArgument = call.arguments[0];
  const secondArgument = call.arguments[1];
  if (name === "render" && callee.type === "MemberExpression") {
    const receiver = unwrapCallee(callee.object);
    if (receiver.type === "CallExpression" && isRootFactory(unwrapCallee(receiver.callee))) {
      if (firstArgument && firstArgument.type !== "SpreadElement") {
        out.push({ element: firstArgument, api: "createRoot", call });
      }
      return;
    }
    if (receiver.type === "Identifier" && receiver.name.toLowerCase().includes("root")) {
      if (firstArgument && firstArgument.type !== "SpreadElement") {
        out.push({ element: firstArgument, api: "createRoot", call });
      }
      return;
    }
  }
  if (name === "hydrateRoot" && secondArgument && secondArgument.type !== "SpreadElement") {
    out.push({ element: secondArgument, api: "hydrateRoot", call });
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
    if (isReactDomCall) out.push({ element: firstArgument, api: name, call });
  }
};

const walk = (node: Node, visit: (node: Node) => void): void => {
  visit(node);
  for (const key of Object.keys(node)) {
    if (key === "parent" || key === "type" || key === "start" || key === "end") continue;
    const child: unknown = node[key as keyof Node];
    if (Array.isArray(child)) {
      for (const item of child) if (isNode(item)) walk(item, visit);
    } else if (isNode(child)) {
      walk(child, visit);
    }
  }
};

const isNode = (value: unknown): value is Node =>
  typeof value === "object" &&
  value !== null &&
  "type" in value &&
  typeof (value as { type: unknown }).type === "string";

export const findRootRenderCalls = (module: ModuleRecord): RootRenderCall[] => {
  const calls: RootRenderCall[] = [];
  walk(module.file.program, (node) => {
    if (node.type === "CallExpression") collectCall(node, calls);
  });
  return calls;
};
