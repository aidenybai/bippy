import { useMemo } from "react";

export const BangPath = ({ pathname }: { pathname: string }) => {
  const target = useMemo(() => {
    if (pathname.startsWith("/!/")) {
      return { pathname: pathname.substring(2) };
    } else if (pathname.startsWith("!")) {
      return { pathname: pathname.substring(1) };
    }
  }, [pathname]);
  if (!target) return null;
  return <p>{target.pathname}</p>;
};
