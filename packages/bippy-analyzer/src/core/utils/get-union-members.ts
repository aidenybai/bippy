import type { Type } from "typescript/unstable/sync";

export const getUnionMembers = (type: Type): readonly Type[] =>
  type.isUnionType() ? type.getTypes() : [type];
