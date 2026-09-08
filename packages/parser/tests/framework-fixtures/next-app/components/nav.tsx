import Link from "next/link";
import { ArrowIcon, Badge } from "./icons";

export const Nav = () => (
  <nav>
    <Link href="/">Home</Link>
    <Link href="/blog/hello">Blog</Link>
    <ArrowIcon className="arrow" />
    <Badge label="new" />
  </nav>
);
