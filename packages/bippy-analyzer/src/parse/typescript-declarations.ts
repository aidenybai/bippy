import type { TypeScriptDeclaration } from "./source-types.js";

/** The binding an enum or namespace creates at runtime; `declare`d and `global` blocks create none. */
export const getTypeScriptDeclarationName = (node: TypeScriptDeclaration): string | null => {
  if (node.declare || node.id.type !== "Identifier") return null;
  if (node.type === "TSModuleDeclaration" && node.kind === "global") return null;
  return node.id.name;
};
