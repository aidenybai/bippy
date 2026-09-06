import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";

export const links = () => [
  { rel: "preconnect", href: "https://fonts.example" },
  { rel: "stylesheet", href: "/app.css" },
];

export const meta = () => [{ title: "Auto Routes" }, { charSet: "utf-8" }];

export const Layout = ({ children }: { children: React.ReactNode }) => (
  <html lang="en">
    <head>
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

export default function App() {
  return (
    <div id="app">
      <Outlet />
    </div>
  );
}
