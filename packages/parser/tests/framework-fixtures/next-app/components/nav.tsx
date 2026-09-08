import Form from "next/form";
import Link from "next/link";
import { NavLink } from "@/components/nav-link";
import { ArrowIcon, Badge } from "./icons";
import { Slot, Slottable } from "./slot";

export const Nav = () => (
  <nav>
    <Form action="/search" scroll={false}>
      <input name="q" />
    </Form>
    <Link href="/">Home</Link>
    <Link href="/blog/hello">Blog</Link>
    <NavLink href="/notes">Notes</NavLink>
    <ArrowIcon className="arrow" />
    <Badge label="new" />
    <Slot>
      <Link href="/about">About</Link>
    </Slot>
    <Slot>
      <Slottable>slotted</Slottable>
    </Slot>
  </nav>
);
