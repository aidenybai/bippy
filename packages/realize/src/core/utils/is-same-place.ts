import type { BindingPlace } from "../types";

export const isSamePlace = (left: BindingPlace, right: BindingPlace): boolean =>
  left.bindingId === right.bindingId &&
  left.path.length === right.path.length &&
  left.path.every((segment, index) => right.path[index] === segment);
