import type { BindingPlace, Binding } from "../types";

export const getBindingPlace = (binding: Binding, path: string[] = []): BindingPlace => ({
  bindingId: binding.id,
  path,
});
