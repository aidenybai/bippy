import type { Binding, BindingValue } from "../types";

export const getPlaceKey = (binding: Binding, path: readonly string[]): string =>
  [String(binding.id), ...path].join(".");

export const getBindingPlaceKey = (value: BindingValue): string =>
  getPlaceKey(value.binding, value.path);

export const parsePlaceKey = (placeKey: string): { bindingId: number; path: string[] } => {
  const [bindingId = "", ...path] = placeKey.split(".");
  return { bindingId: Number(bindingId), path };
};

export const isPlacePrefix = (prefix: string, placeKey: string): boolean =>
  placeKey === prefix || placeKey.startsWith(`${prefix}.`);
