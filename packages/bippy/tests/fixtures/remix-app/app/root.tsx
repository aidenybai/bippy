import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "@remix-run/react";

export const Layout = ({ children }: { children: React.ReactNode }) => (
  <html lang="en">
    <head>
      <meta charSet="utf-8" />
      <title>Bippy E2E - Remix</title>
      <Meta />
      <Links />
    </head>
    <body>
      {children}
      <ScrollRestoration />
      <Scripts />
    </body>
  </html>
);

const Root = () => <Outlet />;

export default Root;
