import { createRoot } from "react-dom/client";
import {
  createBrowserRouter,
  createRoutesFromElements,
  NavLink,
  Outlet,
  Route,
  RouterProvider,
} from "react-router";

const runtimePath = JSON.parse(document.getElementById("route-config")?.textContent ?? '""');

const router = createBrowserRouter(
  createRoutesFromElements(
    <Route
      element={
        <main>
          <nav>
            <NavLink to="/about" className={({ isActive }) => (isActive ? "current" : "idle")}>
              {({ isActive }) => <span>{isActive ? "on about" : "elsewhere"}</span>}
            </NavLink>
            <NavLink to="/about/team" end>
              {({ isActive }) => (isActive ? <b>team</b> : <i>team</i>)}
            </NavLink>
          </nav>
          <Outlet />
        </main>
      }
    >
      <Route path={runtimePath} element={<h1>runtime path</h1>} />
      <Route path="about" element={<h1>about</h1>} />
    </Route>,
  ),
);

createRoot(document.getElementById("root")!).render(<RouterProvider router={router} />);
