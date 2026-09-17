"use client";

import Link, { useLinkStatus } from "next/link";
import type { ReactNode } from "react";

const PendingDot = () => {
  const { pending } = useLinkStatus();
  return pending ? <span role="status" /> : null;
};

const isSlottable = "__radixId" in Link;
const isForwardRef = "render" in Link;

export const NavLink = ({ href, children }: { href: string; children: ReactNode }) => (
  <Link href={href}>
    {children}
    {isSlottable ? <mark /> : isForwardRef ? <s /> : <PendingDot />}
  </Link>
);
