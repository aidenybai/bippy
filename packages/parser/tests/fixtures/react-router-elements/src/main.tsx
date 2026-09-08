import { Fragment } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, createRoutesFromElements, Route, RouterProvider } from "react-router";
import { Profile, Settings, Shell } from "./layout";
import { AppPath } from "./paths";

const router = createBrowserRouter(
  createRoutesFromElements(
    <Route element={<Shell />}>
      <Fragment>
        <Route path={AppPath.Home} element={<h1>Home</h1>} />
        <Route path={AppPath.Settings} element={<Settings />}>
          <Route path={AppPath.Profile} element={<Profile />} />
        </Route>
      </Fragment>
    </Route>,
  ),
);

createRoot(document.getElementById("root")!).render(<RouterProvider router={router} />);
