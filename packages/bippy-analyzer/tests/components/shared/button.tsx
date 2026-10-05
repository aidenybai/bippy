import type { ButtonHTMLAttributes, ReactNode } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary";
  isLoading?: boolean;
  children: ReactNode;
}

export const Button = ({
  variant = "secondary",
  isLoading = false,
  children,
  ...rest
}: ButtonProps) => (
  <button type="button" className={`btn btn-${variant}`} disabled={isLoading} {...rest}>
    {isLoading && <span className="spinner" />}
    <span>{children}</span>
  </button>
);
