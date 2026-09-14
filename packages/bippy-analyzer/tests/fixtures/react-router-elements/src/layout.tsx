import { Outlet } from "react-router";

export const Shell = () => (
  <div className="shell">
    <header>Shell</header>
    <Outlet />
  </div>
);

export const Settings = () => (
  <section>
    <h1>Settings</h1>
    <Outlet />
  </section>
);

export const Profile = () => <p>Profile</p>;
