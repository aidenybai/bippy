import { Link } from "@remix-run/react";

export default function Index() {
  return (
    <main>
      <Link to="/posts/hello">Hello</Link>
    </main>
  );
}
