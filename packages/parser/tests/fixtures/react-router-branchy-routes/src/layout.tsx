import { Link, Outlet } from "react-router";

export const Layout = () => (
  <div className="shell">
    <nav>
      <Link to="/">Home</Link>
      <Link to="/posts/hello" className="active">
        Hello post
      </Link>
    </nav>
    <main>
      <Outlet />
    </main>
  </div>
);
