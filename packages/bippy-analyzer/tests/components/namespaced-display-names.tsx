import { forwardRef, memo, type ReactNode } from "react";

const Field = ({ children }: { children: ReactNode }) => <fieldset>{children}</fieldset>;

Field.Label = ({ text }: { text: string }) => <label>{text}</label>;

Field.Input = forwardRef<HTMLInputElement, { placeholder: string }>(function Input(
  { placeholder },
  ref,
) {
  return <input ref={ref} placeholder={placeholder} />;
});

Field.Hint = memo(({ text }: { text: string }) => <small>{text}</small>);

Field.Label.displayName = "Field.Label";
Field.Input.displayName = "Field.Input";
Field.Hint.displayName = "Field.Hint";

export default function NamespacedDisplayNames() {
  return (
    <Field>
      <Field.Label text="Name" />
      <Field.Input placeholder="name" />
      <Field.Hint text="required" />
    </Field>
  );
}
