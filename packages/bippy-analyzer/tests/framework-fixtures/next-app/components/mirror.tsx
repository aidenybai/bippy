"use client";

import type { ReactNode } from "react";

export const Mirror = ({ children }: { children: ReactNode }) => (
  <div>
    <section>{children}</section>
    <aside>{children}</aside>
  </div>
);
