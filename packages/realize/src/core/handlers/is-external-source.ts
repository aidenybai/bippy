import type { Binding } from "../types";

export const isExternalSource = (binding: Binding): boolean =>
  binding.kind === "hook" || binding.kind === "context";
