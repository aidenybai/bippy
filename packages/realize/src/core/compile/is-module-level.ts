import type { NodePath } from "@babel/traverse";

export const isModuleLevel = (path: NodePath | null): boolean =>
  path !== null &&
  (path.isProgram() || (path.isExportNamedDeclaration() && isModuleLevel(path.parentPath)));
