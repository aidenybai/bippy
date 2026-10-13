// A shadcn-style button: cva variants over a Radix Slot, the composition
// pattern shadcn/ui generates into apps.
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { clsx } from "clsx";
import type * as React from "react";
import { twMerge } from "tailwind-merge";

const buttonVariants = cva(
  "inline-flex items-center justify-center rounded-md text-sm font-medium",
  {
    variants: {
      variant: {
        default: "bg-blue-600 text-white",
        outline: "border border-gray-300 bg-transparent",
      },
      size: {
        default: "h-9 px-4",
        sm: "h-8 px-3",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

interface ShadcnButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const ShadcnButton = ({
  className,
  variant,
  size,
  asChild = false,
  ...buttonProps
}: ShadcnButtonProps) => {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      className={twMerge(clsx(buttonVariants({ variant, size, className })))}
      {...buttonProps}
    />
  );
};
