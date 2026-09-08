import { createRoot } from "react-dom/client";
import {
  createBrowserRouter,
  createRoutesFromElements,
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
