import { SHARED } from "./imported-config-values";

export const growShared = () => {
  SHARED.size += 1;
};
