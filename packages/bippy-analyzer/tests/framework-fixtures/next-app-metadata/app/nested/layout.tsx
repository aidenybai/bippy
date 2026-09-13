import type { ReactNode } from "react";

interface LayoutProps {
  children: ReactNode;
}

export const metadata = {
  title: { default: "Nested", template: "%s | Nested" },
};

export default ({ children }: LayoutProps) => <article>{children}</article>;
