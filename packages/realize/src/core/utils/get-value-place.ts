import type { BindingPlace, BindingValue } from "../types";
import { getBindingPlace } from "./get-binding-place";

export const getValuePlace = (value: BindingValue): BindingPlace =>
  getBindingPlace(value.binding, value.path);
