import type { Type } from "typescript/unstable/sync";
import { queryType } from "./query-type";

export const getUnionMembers = (type: Type): readonly Type[] | null =>
  type.isUnionType() ? queryType(() => type.getTypes()) : [type];
