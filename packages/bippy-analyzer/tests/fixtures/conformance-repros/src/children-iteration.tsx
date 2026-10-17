import { Children, isValidElement } from "react";
import type { ReactElement, ReactNode } from "react";

export const SectionList = ({ children }: { children: ReactNode }) => {
  const sections: ReactElement[] = [];
  Children.forEach(children, (child) => {
    if (isValidElement(child)) sections.push(child);
  });
  if (sections.length === 0) return <p>Coming soon</p>;
  return <div>{sections}</div>;
};
