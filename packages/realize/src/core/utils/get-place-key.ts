import type { BindingPlace } from "../types";

const SEPARATOR = "\0";

export const getPlaceKey = ({ bindingId, path }: BindingPlace): string =>
  path.length === 0 ? `${bindingId}` : `${bindingId}${SEPARATOR}${path.join(SEPARATOR)}`;
