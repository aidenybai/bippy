import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import { Layout } from "./layout";
import { Post } from "./post";

const router = createBrowserRouter([
  {
    id: "shell",
    path: "/",
    loader: () => ({ user: { name: "Ada", plan: "pro" }, unreadCount: 3 }),
    element: <Layout />,
    children: [
      {
        path: "posts/:slug",
        loader: ({ params }) => ({
          title: `Post ${params.slug}`,
          tags: ["react", "router"],
          publishedAt: null,
          author: new Promise<string>((resolve) => setTimeout(() => resolve("Anonymous"), 10)),
        }),
        element: <Post />,
      },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(<RouterProvider router={router} />);
