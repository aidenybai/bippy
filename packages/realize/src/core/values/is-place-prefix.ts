import type { BindingPlace } from "../types";

export const isPlacePrefix = (prefix: BindingPlace, place: BindingPlace): boolean =>
  prefix.bindingId === place.bindingId &&
  prefix.path.length <= place.path.length &&
  prefix.path.every((segment, index) => place.path[index] === segment);
