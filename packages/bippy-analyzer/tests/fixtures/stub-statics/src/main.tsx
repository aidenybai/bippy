import { createRoot } from "react-dom/client";
import { createBrowserRouter, Link, RouterProvider } from "react-router";
import { Button, Slottable } from "./slot";

const Home = () => (
  <main>
    <Button asChild>
      <Link to="/docs">Docs</Link>
    </Button>
    <Button asChild>
      <Slottable>
        <Link to="/home">Home</Link>
      </Slottable>
      <span>icon</span>
    </Button>
  </main>
);

const router = createBrowserRouter([{ path: "/", element: <Home /> }]);

createRoot(document.getElementById("root")!).render(<RouterProvider router={router} />);
