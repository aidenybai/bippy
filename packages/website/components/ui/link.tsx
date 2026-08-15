import { cva, type VariantProps } from "class-variance-authority";
import { type ComponentProps } from "react";

import { cn } from "@/lib/utils";

interface LinkProps extends ComponentProps<"a">, VariantProps<typeof linkVariants> {}

const linkVariants = cva(
  "transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
  {
    variants: {
      variant: {
        default:
          "rounded-sm text-muted-foreground underline decoration-border underline-offset-4 hover:text-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

const Link = ({ className, variant = "default", ...props }: LinkProps) => (
  <a data-slot="link" className={cn(linkVariants({ variant, className }))} {...props} />
);

export { Link };
