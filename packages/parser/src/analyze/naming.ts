import type { Expression } from "@oxc-project/types";
import { getMemberChain } from "../module/ast.js";

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
