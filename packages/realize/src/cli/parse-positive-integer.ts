import { InvalidArgumentError } from "commander";

export const parsePositiveInteger = (value: string): number => {
  const integer = Number(value);
  if (!Number.isInteger(integer) || integer < 1)
    throw new InvalidArgumentError("Expected a positive integer.");
  return integer;
};
