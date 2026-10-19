import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

const LINE_COUNT = 8;
const LINES = Array.from({ length: LINE_COUNT }, (_, index) => index);

type SpinnerProps = Omit<ComponentProps<"div">, "children"> & { label?: string };

export const Spinner = ({ className, label = "Loading", ...props }: SpinnerProps) => (
  <div
    data-slot="spinner"
    role="status"
    aria-label={label}
    className={cn("grid place-items-center", className)}
    {...props}
  >
    <svg viewBox="0 0 24 24" className="size-5 text-muted-foreground" aria-hidden="true">
      {LINES.map((line) => (
        <rect
          key={line}
          x="11"
          y="2"
          width="2"
          height="6"
          rx="1"
          fill="currentColor"
          transform={`rotate(${line * (360 / LINE_COUNT)} 12 12)`}
          className="animate-spinner-line"
          style={{ animationDelay: `${(line - LINE_COUNT) * (1 / LINE_COUNT)}s` }}
        />
      ))}
    </svg>
  </div>
);
