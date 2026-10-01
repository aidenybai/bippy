import { Link, Outlet, useOutlet } from "react-router";

const Placeholder = () => {
  const outlet = useOutlet({ theme: "dark" });
  return outlet ?? <p>Pick an editor</p>;
};

export const Layout = () => (
  <div className="shell">
    <nav>
      <Link to="/editor/basic">Basic editor</Link>
    </nav>
    <main>
      <Outlet />
      <Placeholder />
    </main>
  </div>
);
