import type { BindingPlace } from "../types";

export const getPlaceKey = ({ bindingId, path }: BindingPlace): string =>
  JSON.stringify([bindingId, ...path]);
