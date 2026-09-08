import * as React from "react";

export const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ children, ...props }, ref) => (
    <div ref={ref} data-card {...props}>
      {children}
    </div>
  ),
);
Card.displayName = "Card";

export const CardTitle = React.memo(({ children }: { children: React.ReactNode }) => (
  <h3>{children}</h3>
));
