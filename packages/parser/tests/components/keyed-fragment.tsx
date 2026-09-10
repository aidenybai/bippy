import { Fragment, type ReactNode, useId } from "react";

interface FieldProps {
  label: string;
  children?: ReactNode;
}

const Field = ({ label, children }: FieldProps) => {
  const id = useId();
  return (
    <Fragment key={id}>
      <label htmlFor={id}>{label}</label>
      <input id={id} />
      {children}
    </Fragment>
  );
};

export const isExact = true;

export default function KeyedFragmentApp() {
  return (
    <form>
      <Field label="name" />
      <Field label="email">
        <small>optional</small>
      </Field>
      <Fragment key="static">
        <output>static key</output>
      </Fragment>
    </form>
  );
}
