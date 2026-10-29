import type { Type } from "typescript/unstable/sync";
import { queryType } from "./query-type";

const unionMembersByType = new WeakMap<Type, readonly Type[] | null>();

export const getUnionMembers = (type: Type): readonly Type[] | null => {
  if (!type.isUnionType()) return [type];
  if (unionMembersByType.has(type)) return unionMembersByType.get(type) ?? null;
  const members = queryType(() => type.getTypes());
  unionMembersByType.set(type, members);
  return members;
};
