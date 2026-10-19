import { useState } from "react";
import {
  describeOptions,
  fillDefaults,
  normalizeOptions,
  type CardOptions,
} from "./card-options/normalize";

export const CardGrid = ({ options }: { options: CardOptions }) => {
  normalizeOptions(options);
  return <p>{describeOptions(options)}</p>;
};

export const CardEditor = () => {
  const [options] = useState<CardOptions>({});
  return <button onClick={() => fillDefaults(options, 120)}>{describeOptions(options)}</button>;
};
