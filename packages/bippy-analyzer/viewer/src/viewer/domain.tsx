import { useState, type ReactNode } from "react";
import { getDomainValues } from "../lib/diagram";
import type { ViewBinding } from "../model";

const PREVIEW_COUNT = 6;

interface DomainProps {
  binding: ViewBinding;
  renderValue: (value: string) => ReactNode;
  separator?: ReactNode;
}

export const Domain = ({ binding, renderValue, separator }: DomainProps) => {
  const [isExpanded, setExpanded] = useState(false);
  const values = getDomainValues(binding);
  const hidden = values.length - PREVIEW_COUNT;
  const shown = isExpanded || hidden <= 1 ? values : values.slice(0, PREVIEW_COUNT);
  return (
    <>
      {shown.map((value, index) => (
        <span key={value} className="wrap-anywhere">
          {index > 0 && separator}
          {renderValue(value)}
        </span>
      ))}
      {hidden > 1 && (
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          className="rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:shadow-focus"
        >
          {isExpanded ? "show less" : `+${hidden} more`}
        </button>
      )}
    </>
  );
};
