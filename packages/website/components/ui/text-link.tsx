import { type AnchorHTMLAttributes } from "react";

import { getSafeLinkRel } from "@/lib/get-safe-link-rel";
import { cn } from "@/lib/utils";

interface TextLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string;
}

const TextLink = ({ className, target, rel, ...props }: TextLinkProps) => {
  return (
    <a
      data-slot="text-link"
      className={cn(
        "cursor-pointer font-openrunde-medium text-inline font-medium text-link underline decoration-link-decoration decoration-2 underline-offset-link-underline-offset transition-[text-decoration-color] duration-200 ease-out hover:decoration-link-decoration-hover",
        className,
      )}
      target={target}
      rel={getSafeLinkRel({ target, rel })}
      {...props}
    />
  );
};

export { TextLink };
