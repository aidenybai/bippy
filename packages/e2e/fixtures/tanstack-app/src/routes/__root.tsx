import { HeadContent, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";

interface RootDocumentProps {
  children: ReactNode;
}

const RootComponent = () => {
  return (
    <RootDocument>
      <Outlet />
    </RootDocument>
  );
};

const RootDocument = ({ children }: RootDocumentProps) => {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
};

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Bippy E2E - TanStack Start" },
    ],
  }),
  component: RootComponent,
});
