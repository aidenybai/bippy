import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";

const router = createBrowserRouter([
  {
    path: "/",
    lazy: async () => {
      const { Home } = await import("./home");
      return { element: <Home /> };
    },
  },
  {
    path: "heavy",
    lazy: async () => {
      const { Heavy } = await import("./heavy");
      return { element: <Heavy /> };
    },
  },
]);

createRoot(document.getElementById("root")!).render(<RouterProvider router={router} />);
