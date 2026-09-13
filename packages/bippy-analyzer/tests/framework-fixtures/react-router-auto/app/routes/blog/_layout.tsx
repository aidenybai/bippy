import { Outlet } from "react-router";

export default function BlogLayout() {
  return (
    <section className="blog">
      <Outlet />
    </section>
  );
}
