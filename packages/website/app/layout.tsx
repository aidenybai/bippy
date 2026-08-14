import { type ReactNode } from "react";

interface RootLayoutProps {
  children: ReactNode;
}

const RootLayout = (props: RootLayoutProps) => (
  <html lang="en">
    <body>{props.children}</body>
  </html>
);

export default RootLayout;
