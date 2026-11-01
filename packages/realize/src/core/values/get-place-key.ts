import type { BindingPlace } from "../types";

const SEPARATOR = "\0";

export const getPlaceKey = (place: BindingPlace): string =>
  place.path.length === 0
    ? `${place.bindingId}`
    : `${place.bindingId}${SEPARATOR}${place.path.join(SEPARATOR)}`;
