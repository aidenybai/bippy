import { forwardRef, memo, type HTMLAttributes } from "react";

export const Card = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>((props, ref) => (
  <div ref={ref} className="card" {...props} />
));
Card.displayName = "Card";

export const Badge = memo(({ label }: { label: string }) => <span>{label}</span>);
