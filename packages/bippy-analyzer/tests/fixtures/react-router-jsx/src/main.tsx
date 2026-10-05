import { createRoot } from "react-dom/client";
import { BrowserRouter, NavLink, Outlet, Route, Routes } from "react-router";

const Frame = () => (
  <section>
    <header>
      <NavLink to="/">Home</NavLink>
      <NavLink to="/about">About</NavLink>
    </header>
    <Outlet />
  </section>
);

const Home = () => <p>home</p>;
const About = () => (
  <div>
    <h2>About</h2>
    <p>Static routes, real router.</p>
  </div>
);
const Missing = () => <p>not found</p>;

createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <Routes>
      <Route element={<Frame />}>
        <Route path="/" element={<Home />} />
        <Route path="about" element={<About />} />
        <Route path="*" element={<Missing />} />
      </Route>
    </Routes>
  </BrowserRouter>,
);
