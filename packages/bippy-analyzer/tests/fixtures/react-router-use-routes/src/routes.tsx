import type { RouteObject } from "react-router";
import { Outlet } from "react-router";

const Frame = () => (
  <section>
    <h1>Admin</h1>
    <Outlet />
  </section>
);

const Home = () => <p>home</p>;
const About = () => <p>about</p>;
const Missing = () => <p>not found</p>;

export const rootRoutes: RouteObject[] = [
  {
    element: <Frame />,
    children: [
      { path: "/", element: <Home /> },
      { path: "about", element: <About /> },
      { path: "*", element: <Missing /> },
    ],
  },
];
