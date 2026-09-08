import Link from "next/link";
import { Slot, Slottable } from "./slot";

export const Nav = () => (
  <nav>
    <Link href="/">Home</Link>
    <Link href="/blog/hello">Blog</Link>
    <Slot>
      <Link href="/about">About</Link>
    </Slot>
    <Slot>
      <Slottable>slotted</Slottable>
    </Slot>
  </nav>
);
