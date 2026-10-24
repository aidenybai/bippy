import { TypeFlags } from "typescript/unstable/sync";
import type { Type } from "typescript/unstable/sync";
import { getUnionMembers } from "./get-union-members";

const PRIMITIVE_FLAGS =
  TypeFlags.StringLike |
  TypeFlags.NumberLike |
  TypeFlags.BigIntLike |
  TypeFlags.BooleanLike |
  TypeFlags.EnumLike |
  TypeFlags.ESSymbolLike |
  TypeFlags.Null |
  TypeFlags.Undefined |
  TypeFlags.Void;

export const isPrimitiveType = (type: Type): boolean =>
  Boolean(type.flags & PRIMITIVE_FLAGS) ||
  (type.isUnionType() && (getUnionMembers(type)?.every(isPrimitiveType) ?? false));
