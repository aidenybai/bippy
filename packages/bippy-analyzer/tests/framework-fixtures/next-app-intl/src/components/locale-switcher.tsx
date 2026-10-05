"use client";

import { useLocale } from "next-intl";
import { usePathname } from "@/libs/navigation";

export const LocaleSwitcher = () => {
  const locale = useLocale();
  const pathname = usePathname();
  return (
    <footer>
      <span>{locale}</span>
      <span>{pathname}</span>
    </footer>
  );
};
