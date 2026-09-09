import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import { Layout } from "./layout";
import { Editor } from "./editor";

const router = createBrowserRouter([
  {
    path: "/",
    element: <Layout />,
    children: [{ path: "editor/:name", element: <Editor /> }],
  },
]);

createRoot(document.getElementById("root")!).render(<RouterProvider router={router} />);
