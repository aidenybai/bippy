import { cva } from "class-variance-authority";

export const buttonVariants = cva(
  "inline-flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-md px-2 font-medium whitespace-nowrap transition-colors duration-150 outline-none focus-visible:shadow-focus disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-3.5 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        ghost:
          "text-muted-foreground hover:bg-muted hover:text-foreground active:bg-well-2 aria-pressed:text-foreground",
      },
      size: {
        default: "px-2.5",
        icon: "w-7 px-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);
