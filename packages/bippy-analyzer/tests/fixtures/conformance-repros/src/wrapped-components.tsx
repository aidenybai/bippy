import { forwardRef, memo } from "react";

/**
 * Components wrapped in `forwardRef` or `memo` are named after the variable holding them,
 * as shadcn/ui declares them in bulletproof-react and invoify.
 */

// bulletproof-react src/components/ui/button/button.tsx:47
export const Button = forwardRef<HTMLButtonElement, { label: string }>(({ label }, ref) => (
  <button ref={ref}>{label}</button>
));

export const Badge = memo(({ count }: { count: number }) => <span>{count}</span>);

export const Pill = memo(
  forwardRef<HTMLSpanElement, { text: string }>(({ text }, ref) => <span ref={ref}>{text}</span>),
);
