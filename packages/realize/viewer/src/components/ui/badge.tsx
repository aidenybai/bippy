import type { ComponentProps } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex h-[19px] min-w-[19px] shrink-0 items-center justify-center rounded-sm px-[5px] text-[12px]/none font-medium whitespace-nowrap tabular-nums",
  {
    variants: {
      variant: {
        secondary: "bg-muted text-muted-foreground",
        outline: "border text-foreground",
      },
    },
    defaultVariants: {
      variant: "outline",
    },
  },
);

type BadgeProps = ComponentProps<"span"> & VariantProps<typeof badgeVariants>;

export const Badge = ({ className, variant, ...props }: BadgeProps) => (
  <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />
);
