"use client";

import { Children, type ReactNode } from "react";

export const Ticker = ({ children }: { children: ReactNode }) => (
  <ul>{Children.map(children, (child) => <li>{child}</li>)}</ul>
);
