import { useState, type ReactNode } from "react";
import { getPreviewCount, isLongDomain, shortenType } from "@/lib/domain";
import type { ViewBinding } from "@/model";

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
  const values = binding.domain;
  const isLong = isLongDomain(values);
  const count = getPreviewCount(values);
  const hidden = values.length - count;
  const shown = isExpanded ? values : values.slice(0, count);
  const toggle = hidden > 0 && (
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
