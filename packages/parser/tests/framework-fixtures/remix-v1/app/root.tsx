import { Links, LiveReload, Meta, Outlet, Scripts } from "@remix-run/react";

export const meta = () => ({
  charset: "utf-8",
  title: "Blocks",
  viewport: "width=device-width,initial-scale=1",
  "og:site_name": "Blocks",
});

export const links = () => [{ rel: "stylesheet", href: "/app.css" }];

export default function () {
  return (
    <html lang="en">
      <head>
        <Meta />
        <Links />
      </head>
      <body>
        <Outlet />
        <Scripts />
        <LiveReload />
      </body>
    </html>
  );
}
