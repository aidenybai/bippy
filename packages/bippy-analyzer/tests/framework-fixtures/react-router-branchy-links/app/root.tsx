import { Links, Meta, Outlet, useMatches } from "react-router";

export const links = () => [{ rel: "stylesheet", href: "/app.css" }];

const Breadcrumbs = () => {
  const matches = useMatches();
  return (
    <nav>
      {matches.map((match) => {
        const handle = match.handle as { breadcrumb?: string } | undefined;
        return handle?.breadcrumb ? <span key={handle.breadcrumb}>{handle.breadcrumb}</span> : null;
      })}
    </nav>
  );
};

export const Layout = ({ children }: { children: React.ReactNode }) => (
  <html lang="en">
    <head>
      <Meta />
      <Links />
    </head>
    <body>
      <Breadcrumbs />
      {children}
    </body>
  </html>
);

export default function App() {
  return <Outlet />;
}
