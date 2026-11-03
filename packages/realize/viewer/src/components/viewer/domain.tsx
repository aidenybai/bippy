import { useState } from "react";
import { Code } from "@/components/ui/code";
import { getPreviewCount, isLongDomain, shortenType } from "@/lib/domain";
import type { ViewBinding } from "@/model";

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

export const Domain = ({ binding }: { binding: ViewBinding }) => {
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
            <Code>{shortenType(value)}</Code>
          </span>
        ))}
        {toggle}
      </span>
    );
  return (
    <>
      {shown.map((value, index) => (
        <span key={value} className="wrap-anywhere">
          {index > 0 && <span className="text-faint"> | </span>}
          <Code>{value}</Code>
        </span>
      ))}
      {toggle}
    </>
  );
};
