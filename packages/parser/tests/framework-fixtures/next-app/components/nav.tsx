import Form from "next/form";
import Link from "next/link";
import { NavLink } from "@/components/nav-link";

export const Nav = () => (
  <nav>
    <Form action="/search" scroll={false}>
      <input name="q" />
    </Form>
    <Link href="/">Home</Link>
    <Link href="/blog/hello">Blog</Link>
    <NavLink href="/notes">Notes</NavLink>
  </nav>
);
