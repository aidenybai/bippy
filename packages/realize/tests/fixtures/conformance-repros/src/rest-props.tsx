import type { ButtonHTMLAttributes, ReactNode } from "react";

interface FieldProps {
  name: string;
  render: (value: string) => ReactNode;
  label?: string;
}

const Field = ({ name, render, label }: FieldProps) => (
  <label>
    {label}
    {render(name)}
  </label>
);

export const PassedField = ({ ...props }: FieldProps) => <Field {...props} />;

export const PlainButton = ({ ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button {...props} />
);
