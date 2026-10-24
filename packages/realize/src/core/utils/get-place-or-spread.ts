import type { Place, SpreadPattern } from "../../react-compiler/HIR/HIR";

export const getPlaceOrSpread = (argument: Place | SpreadPattern): Place =>
  argument.kind === "Spread" ? argument.place : argument;
