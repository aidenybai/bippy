import { createRootRoute, Outlet } from "@tanstack/react-router";

export const Route = createRootRoute({
  component: () => (
    <main>
      <h1>Split routes</h1>
      <Outlet />
    </main>
  ),
});
