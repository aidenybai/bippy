import { forwardRef } from "react";

export const TextInput = forwardRef<HTMLInputElement, { placeholder: string }>(function TextInput(
  { placeholder },
  ref,
) {
  return <input ref={ref} placeholder={placeholder} />;
});

export const Unnamed = forwardRef<HTMLDivElement, { label: string }>((props, ref) => (
  <div ref={ref}>{props.label}</div>
));

export const Named = forwardRef<HTMLSpanElement, { label: string }>((props, ref) => (
  <span ref={ref}>{props.label}</span>
));
Named.displayName = "NamedInput";
