import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import { Page } from "./page";

const router = createBrowserRouter(
  [
    { path: "/", element: <Page /> },
    { path: "/items/:slug", element: <Page /> },
  ],
  { basename: "/app/" },
);

createRoot(document.getElementById("root")!).render(<RouterProvider router={router} />);
