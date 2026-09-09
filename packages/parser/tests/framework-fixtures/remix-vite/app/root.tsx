import { Links, LiveReload, Meta, Outlet, Scripts } from "@remix-run/react";
import "./styles.css";

export const links = () => [{ rel: "stylesheet", href: "/app.css" }];

export default function App() {
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
