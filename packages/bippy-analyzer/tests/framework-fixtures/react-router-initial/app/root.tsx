import { Outlet, Scripts, ScrollRestoration } from "react-router";

export const Layout = ({ children }: { children: React.ReactNode }) => (
  <html lang="en">
    <body>
      {children}
      <ScrollRestoration nonce="abc" />
      <Scripts nonce="abc" />
    </body>
  </html>
);

export default function App() {
  return <Outlet />;
}
