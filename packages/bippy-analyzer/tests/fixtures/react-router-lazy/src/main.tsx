import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import { Layout } from "./layout";

const router = createBrowserRouter([
  {
    path: "/",
    element: <Layout />,
    children: [
      { index: true, element: <p>home</p> },
      {
        path: "about",
        lazy: async () => {
          const { About } = await import("./about");
          return { element: <About team="parser" /> };
        },
      },
      {
        path: "contact",
        lazy: async () => {
          const { Contact } = await import("./contact");
          return { Component: Contact };
        },
      },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(<RouterProvider router={router} />);
