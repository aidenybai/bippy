"use client";

import type { ReactNode } from "react";

export interface SocialLink {
  name: string;
  icon: ReactNode;
}

export const SocialLinks = ({ links }: { links: SocialLink[] }) => (
  <ul>
    {links.map((link) => (
      <li key={link.name}>{link.icon}</li>
    ))}
  </ul>
);
