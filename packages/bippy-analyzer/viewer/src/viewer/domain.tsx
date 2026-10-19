import { useState, type ReactNode } from "react";
import { getDomainValues, shortenType } from "../lib/diagram";
import type { ViewBinding } from "../model";

const PREVIEW_COUNT = 6;
const LONG_PREVIEW_COUNT = 3;
const LONG_VALUE = 24;

interface DomainProps {
  binding: ViewBinding;
  renderValue: (value: string) => ReactNode;
  separator?: ReactNode;
}

const MoreButton = ({
  hidden,
  isExpanded,
  onToggle,
}: {
  hidden: number;
  isExpanded: boolean;
  onToggle: () => void;
}) => (
  <button
    type="button"
    onClick={onToggle}
    className="w-fit rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:shadow-focus"
  >
    {isExpanded ? "show less" : `+${hidden} more`}
  </button>
);

export const Domain = ({ binding, renderValue, separator }: DomainProps) => {
  const [isExpanded, setExpanded] = useState(false);
  const values = getDomainValues(binding);
  const isLong = values.some((value) => value.length > LONG_VALUE);
  const preview = isLong ? LONG_PREVIEW_COUNT : PREVIEW_COUNT;
  const hidden = values.length - preview;
  const shown = isExpanded || hidden <= 1 ? values : values.slice(0, preview);
  const toggle = hidden > 1 && (
    <MoreButton hidden={hidden} isExpanded={isExpanded} onToggle={() => setExpanded((c) => !c)} />
  );
  if (isLong)
    return (
      <span className="grid gap-0.5">
        {shown.map((value) => (
          <span key={value} title={value} className="wrap-anywhere">
            {renderValue(shortenType(value))}
          </span>
        ))}
        {toggle}
      </span>
    );
  return (
    <>
      {shown.map((value, index) => (
        <span key={value} className="wrap-anywhere">
          {index > 0 && separator}
          {renderValue(value)}
        </span>
      ))}
      {toggle}
    </>
  );
};
