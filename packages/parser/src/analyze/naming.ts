import type { Expression } from "@oxc-project/types";
import { type FunctionLike, getMemberChain, isNodeOfType, walk } from "../module/ast.js";

/** Mirrors React Compiler's `isComponentName`: components start uppercase. */
export const isComponentName = (name: string): boolean => /^[A-Z]/.test(name);

/** Mirrors React Compiler's `isHookName`: `use` followed by uppercase or digit. */
export const isHookName = (name: string): boolean => /^use[A-Z0-9]/.test(name);

/**
 * Mirrors React Compiler's `isHook`: a hook identifier or a member access
 * `Namespace.useThing` whose object is PascalCase.
 */
export const isHookCallee = (callee: Expression): boolean => {
  const chain = getMemberChain(callee);
  if (!chain) return false;
  if (chain.length === 1) return isHookName(chain[0]);
  if (chain.length === 2) return isComponentName(chain[0]) && isHookName(chain[1]);
  return false;
};

/**
 * Mirrors React Compiler's `callsHooksOrCreatesJsx`, which keeps capitalized
 * functions that are not components (route handlers such as `GET`, builders
 * like `Schema`) from being treated as one. Nested functions count, so a
 * component rendering only through `items.map(() => <li />)` still qualifies.
 */
export const callsHooksOrCreatesJsx = (fn: FunctionLike): boolean => {
  let isFound = false;
  walk(fn, (node) => {
    if (isFound) return false;
    if (node.type === "JSXElement" || node.type === "JSXFragment") isFound = true;
    else if (isNodeOfType(node, "CallExpression") && isHookCallee(node.callee)) isFound = true;
    return !isFound;
  });
  return isFound;
};
