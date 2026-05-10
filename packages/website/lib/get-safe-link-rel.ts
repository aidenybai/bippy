import { type AnchorHTMLAttributes } from "react";

interface SafeLinkRelOptions {
  rel: AnchorHTMLAttributes<HTMLAnchorElement>["rel"];
  target: AnchorHTMLAttributes<HTMLAnchorElement>["target"];
}

export const getSafeLinkRel = ({ target, rel }: SafeLinkRelOptions) => {
  if (target !== "_blank") return rel;

  const relValues = rel?.split(/\s+/).filter(Boolean) ?? [];

  if (!relValues.includes("noopener")) relValues.push("noopener");
  if (!relValues.includes("noreferrer")) relValues.push("noreferrer");

  return relValues.join(" ");
};
