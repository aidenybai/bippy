import { forwardRef, type ReactNode } from "react";

export default forwardRef<HTMLAnchorElement, { href: string; children?: ReactNode }>(
  ({ href, children }, ref) => (
    <a href={href} ref={ref}>
      {children}
    </a>
  ),
);
