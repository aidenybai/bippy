import { memo, useRef } from "react";
import { Link, NavLink, Outlet, useHref, useLocation, useParams } from "react-router";

export const Counter = memo(() => {
  const renders = useRef(0);
  renders.current++;
  const location = useLocation();
  return (
    <output>
      {location.pathname}
      <i />
      {renders.current}
    </output>
  );
});

export const Page = () => {
  const location = useLocation();
  const href = useHref("/");
  const params = useParams();
  return (
    <main>
      <p>
        {location.pathname}
        <i />
        {location.search}
        <b />
        {location.hash}
      </p>
      <p>
        {href}
        <i />
      </p>
      <p>
        {params.slug}
        <i />
      </p>
      <Link to="/">Home</Link>
      <NavLink to="/" end>
        {({ isActive }) => (isActive ? <strong /> : <em />)}
      </NavLink>
      <Outlet />
    </main>
  );
};
