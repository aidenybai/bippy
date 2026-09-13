import type { ReactNode } from "react";

interface SecondFactorProps {
  methods: string[];
  isResending: boolean;
  children: ReactNode;
}

export const SecondFactor = ({ methods, isResending, children }: SecondFactorProps) => (
  <fieldset disabled={isResending}>
    <ul>
      {methods.map((method) => (
        <li key={method}>{method}</li>
      ))}
    </ul>
    {children}
  </fieldset>
);
