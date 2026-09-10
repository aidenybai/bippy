import { createRoot } from "react-dom/client";
import { BrowserRouter, Link, Outlet, Route, Routes, useLocation, useParams } from "react-router";

const Frame = () => {
  const { pathname } = useLocation();
  return (
    <section>
      <header>
        <Link to="/">Home</Link>
        <Link to="/guide/intro?tab=code#top">Intro</Link>
        <Link to="guide/setup">Setup</Link>
      </header>
      <p>at {pathname}</p>
      <Outlet />
    </section>
  );
};

const Home = () => <p>home</p>;
const Guide = () => {
  const { page } = useParams();
  return <h2>guide: {page}</h2>;
};
const Missing = () => <p>not found</p>;

createRoot(document.getElementById("root")!).render(
  <>
    <BrowserRouter basename="/docs/">
      <Routes>
        <Route element={<Frame />}>
          <Route path="/" element={<Home />} />
          <Route path="guide/:page" element={<Guide />} />
          <Route path="*" element={<Missing />} />
        </Route>
      </Routes>
    </BrowserRouter>
    <BrowserRouter basename="/blog">
      <Routes>
        <Route path="*" element={<p>blog</p>} />
      </Routes>
    </BrowserRouter>
  </>,
);
