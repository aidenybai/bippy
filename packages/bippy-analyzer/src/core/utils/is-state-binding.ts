import type { Binding } from "../types";

export const isStateBinding = (binding: Binding): boolean =>
  binding.kind === "state" || binding.kind === "reducer";
