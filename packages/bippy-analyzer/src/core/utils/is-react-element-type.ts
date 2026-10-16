import type { Type } from "typescript/unstable/sync";
import { getUnionMembers } from "./get-union-members";
import { isReactType } from "./typescript";

const REACT_ELEMENT_TYPE_PATTERN = /^(?:ReactElement|ReactPortal|ReactNode|Element)$/;

export const isReactElementType = (type: Type): boolean =>
  getUnionMembers(type).some((member) => isReactType(member, REACT_ELEMENT_TYPE_PATTERN));
