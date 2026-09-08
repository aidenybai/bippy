import { forwardRef, memo, type SVGProps } from "react";

export const ArrowIcon = forwardRef<SVGSVGElement, SVGProps<SVGSVGElement>>((props, ref) => (
  <svg ref={ref} viewBox="0 0 16 16" {...props}>
    <path d="M1 8h14" />
  </svg>
));
ArrowIcon.displayName = "ArrowIcon";

export const Badge = memo(({ label }: { label: string }) => <span>{label}</span>);
