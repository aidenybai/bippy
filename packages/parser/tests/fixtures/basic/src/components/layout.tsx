import { memo, type ReactNode } from "react";

interface LayoutProps { title: string; children: ReactNode }

const LayoutImpl = ({ title, children }: LayoutProps) => (
  <main>
    <h1>{title}</h1>
    {children}
  </main>
);

export const Layout = memo(LayoutImpl);
Layout.displayName = "Layout";
