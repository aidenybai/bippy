import type { ReactNode } from "react";

interface LayoutProps {
  children: ReactNode;
}

export const metadata = {
  title: { default: "Root", template: "%s | Root" },
  description: "root-description",
};

export default ({ children }: LayoutProps) => {
  Reflect.set(globalThis, "__bippyMetadataApplicationExecuted", true);
  return (
    <html>
      <body>
        <header />
        <section>{children}</section>
      </body>
    </html>
  );
};
