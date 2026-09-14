import type {
  ArrowFunctionExpression,
  CallExpression,
  Expression,
  Function,
  Node,
  Statement,
} from "oxc-parser";
import { forEachChildNode, unwrapExpression } from "../parse/ast-walk.js";
import type { ModuleRecord } from "../types.js";

type EnclosingFunction = Function | ArrowFunctionExpression;

/** A block the root render call is nested in: the statements that run before the call and the one containing it. */
interface EnclosingBlock {
  statementsBefore: Statement[];
  statement: Statement;
}

export interface RootRenderCall {
  element: Expression;
  api: "createRoot" | "hydrateRoot" | "render" | "hydrate";
  call: CallExpression;
  /**
   * For calls nested in blocks (a `DOMContentLoaded` handler, an `if`, an async
   * `main`), each enclosing block outermost first; module-level statements are
   * excluded because module bindings are resolved lazily.
   */
  enclosingBlocks: EnclosingBlock[];
  /** The innermost function the call sits in: a callback that runs after the module body has. */
  enclosingFunction: EnclosingFunction | null;
}

interface RootCallSite {
  enclosingBlocks: EnclosingBlock[];
  enclosingFunction: EnclosingFunction | null;
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

const collectCall = (call: CallExpression, site: RootCallSite, out: RootRenderCall[]): void => {
  const callee = unwrapExpression(call.callee);
  const name = getCalleeName(callee);
  if (!name) return;
  const firstArgument = call.arguments[0];
  const secondArgument = call.arguments[1];
  if (name === "render" && callee.type === "MemberExpression") {
    const receiver = unwrapExpression(callee.object);
    if (receiver.type === "CallExpression" && isRootFactory(unwrapExpression(receiver.callee))) {
      if (firstArgument && firstArgument.type !== "SpreadElement") {
        out.push({ ...site, element: firstArgument, api: "createRoot", call });
      }
      return;
    }
    if (receiver.type === "Identifier" && receiver.name.toLowerCase().includes("root")) {
      if (firstArgument && firstArgument.type !== "SpreadElement") {
        out.push({ ...site, element: firstArgument, api: "createRoot", call });
      }
      return;
    }
  }
  if (name === "hydrateRoot" && secondArgument && secondArgument.type !== "SpreadElement") {
    out.push({ ...site, element: secondArgument, api: "hydrateRoot", call });
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
    if (isReactDomCall) out.push({ ...site, element: firstArgument, api: name, call });
  }
};

const isEnclosingFunction = (node: Node): node is EnclosingFunction =>
  node.type === "FunctionDeclaration" ||
  node.type === "FunctionExpression" ||
  node.type === "ArrowFunctionExpression";

const getEnclosingBlock = (node: Node, key: string, index: number): EnclosingBlock | null =>
  key === "body" && node.type === "BlockStatement"
    ? { statementsBefore: node.body.slice(0, index), statement: node.body[index] }
    : null;

const walk = (
  node: Node,
  site: RootCallSite,
  visit: (node: Node, site: RootCallSite) => void,
): void => {
  visit(node, site);
  const enclosingFunction = isEnclosingFunction(node) ? node : site.enclosingFunction;
  forEachChildNode(node, (child, key, index) => {
    const block = getEnclosingBlock(node, key, index);
    walk(
      child,
      {
        enclosingBlocks: block ? [...site.enclosingBlocks, block] : site.enclosingBlocks,
        enclosingFunction,
      },
      visit,
    );
  });
};

/**
 * Root render calls in the order they run: the module body's own calls in
 * source order, then the ones inside callbacks, which fire after the module
 * body has completed. A later render into the same container replaces the
 * earlier tree, so the last call is the one whose tree the page shows.
 */
export const findRootRenderCalls = (module: ModuleRecord): RootRenderCall[] => {
  const calls: RootRenderCall[] = [];
  walk(module.file.program, { enclosingBlocks: [], enclosingFunction: null }, (node, site) => {
    if (node.type === "CallExpression") collectCall(node, site, calls);
  });
  return [
    ...calls.filter((call) => call.enclosingFunction === null),
    ...calls.filter((call) => call.enclosingFunction !== null),
  ];
};
