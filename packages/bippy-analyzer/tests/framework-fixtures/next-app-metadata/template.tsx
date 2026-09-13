import type { ReactNode } from "react";

interface TemplateProps {
  children: ReactNode;
}

export default ({ children }: TemplateProps) => <nav>{children}</nav>;
