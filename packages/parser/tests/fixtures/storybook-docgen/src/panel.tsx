import { forwardRef, type ReactNode } from "react";

interface PanelProps {
  title: string;
  children: ReactNode;
}

export const Panel = forwardRef<HTMLElement, PanelProps>(({ title, children }, ref) => (
  <section ref={ref}>
    <h2>{title}</h2>
    {children}
  </section>
));

export const PanelFooter = ({ children }: { children: ReactNode }) => <footer>{children}</footer>;
