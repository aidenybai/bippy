import * as React from "react";
import { cn } from "@/lib/utils";

interface SpinnerProps extends Omit<React.ComponentPropsWithoutRef<"svg">, "display" | "opacity"> {
  size?: "sm" | "default" | "md" | "lg";
  speed?: "slow" | "normal" | "fast";
  className?: string;
}

const SIZE_CLASSES: Record<NonNullable<SpinnerProps["size"]>, string> = {
  sm: "h-4 w-4",
  default: "h-5 w-5",
  md: "h-6 w-6",
  lg: "h-8 w-8",
};

const SPEED_CLASSES: Record<NonNullable<SpinnerProps["speed"]>, string> = {
  slow: "animate-[spin_2s_linear_infinite]",
  normal: "animate-spin",
  fast: "animate-[spin_0.5s_linear_infinite]",
};

const SpinnerPrimitive = React.forwardRef<React.ElementRef<"svg">, React.SVGProps<SVGSVGElement>>(({ ...props }, ref) => {
  const gradientId = React.useId();
  return (
    <svg ref={ref} data-slot-icon viewBox="0 0 24 24" {...props}>
      <defs>
        <linearGradient id={`gradient-1-${gradientId}`} x1="50%" x2="50%" y1="5.271%" y2="91.793%">
          <stop offset="0%" stopColor="currentColor" />
          <stop offset="100%" stopColor="currentColor" stopOpacity={0.55} />
        </linearGradient>
        <linearGradient id={`gradient-2-${gradientId}`} x1="50%" x2="50%" y1="15.24%" y2="87.15%">
          <stop offset="0%" stopColor="currentColor" stopOpacity={0} />
          <stop offset="100%" stopColor="currentColor" stopOpacity={0.55} />
        </linearGradient>
      </defs>
      <g fill="none">
        <path d="M8.749.021a1.5 1.5 0 0 1 .497 2.958A7.5 7.5 0 0 0 3 10.375a7.5 7.5 0 0 0 7.5 7.5v3c-5.799 0-10.5-4.7-10.5-10.5C0 5.23 3.726.865 8.749.021" fill={`url(#gradient-1-${gradientId})`} transform="translate(1.5 1.625)" />
        <path d="M15.392 2.673a1.5 1.5 0 0 1 2.119-.115A10.48 10.48 0 0 1 21 10.375c0 5.8-4.701 10.5-10.5 10.5v-3a7.5 7.5 0 0 0 5.007-13.084a1.5 1.5 0 0 1-.115-2.118" fill={`url(#gradient-2-${gradientId})`} transform="translate(1.5 1.625)" />
      </g>
    </svg>
  );
});
SpinnerPrimitive.displayName = "SpinnerPrimitive";

const Spinner = React.forwardRef<React.ComponentRef<typeof SpinnerPrimitive>, SpinnerProps>(({ className, size = "md", speed = "normal", ...props }, ref) => {
  return (
    <span data-spinner className={cn("inline-block", SPEED_CLASSES[speed], SIZE_CLASSES[size], className)}>
      <SpinnerPrimitive ref={ref} aria-hidden aria-label="Loading" role="presentation" className="h-full w-full" {...props} />
    </span>
  );
});
Spinner.displayName = "Spinner";

export { Spinner };
export type { SpinnerProps };
