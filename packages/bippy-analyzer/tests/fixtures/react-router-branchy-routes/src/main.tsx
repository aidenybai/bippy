import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import { Layout } from "./layout";
import { Home } from "./home";
import { Post } from "./post";

const hasCanvas = document.createElement("canvas").getContext("2d") !== null;

const router = createBrowserRouter([
  {
    path: "/",
    element: <Layout />,
    children: [
      { index: true, element: <Home /> },
      {
        id: hasCanvas ? "post-canvas" : "post-plain",
        path: hasCanvas ? "posts/:slug" : "posts/:id",
        element: <Post />,
      },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(<RouterProvider router={router} />);
