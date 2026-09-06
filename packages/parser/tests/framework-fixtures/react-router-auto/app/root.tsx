import { Links, Meta, Outlet, Scripts } from "react-router";

export const Layout = ({ children }: { children: React.ReactNode }) => (
  <html lang="en">
    <head>
      <Meta />
      <Links />
    </head>
    <body>
      {children}
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
