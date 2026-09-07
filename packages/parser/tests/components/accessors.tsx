import { useRef, useState } from "react";

interface FormState {
  isDirty: boolean;
  errors: Record<string, { message: string }>;
}

interface Control {
  _formState: FormState;
  _proxyFormState: Record<string, "all">;
}

const createControl = (formState: FormState): Control => {
  const control: Control = { _proxyFormState: {}, _formState: formState };
  Object.defineProperty(control, "_formState", { get: () => formState });
  return control;
};

const getProxyFormState = (formState: FormState, control: Control): FormState => {
  const result: FormState = { ...formState };
  for (const key in formState) {
    Object.defineProperty(result, key, {
      get: () => {
        control._proxyFormState[key] = "all";
        return Reflect.get(formState, key);
      },
    });
  }
  return result;
};

const counter = {
  count: 0,
  get doubled() {
    return this.count * 2;
  },
  set doubled(value: number) {
    this.count = value / 2;
  },
};

const name = {
  first: "a",
  last: "b",
  get full() {
    return `${this.first}${this.last}`;
  },
};

const FormErrors = ({ formState }: { formState: FormState }) => (
  <>
    {formState.errors.email && <p className="error">{formState.errors.email.message}</p>}
    <span>dirty:{String(formState.isDirty)}</span>
  </>
);

export default function App() {
  const [formState] = useState<FormState>({ isDirty: false, errors: {} });
  const control = useRef<Control | null>(null);
  control.current ??= createControl(formState);
  const methods = {
    control: control.current,
    formState: getProxyFormState(formState, control.current),
  };
  counter.doubled = 10;
  name.first = "x";
  return (
    <section>
      <FormErrors formState={methods.formState} />
      <span>errors:{Object.keys(methods.control._formState.errors).length}</span>
      <span>
        {String(methods.formState.isDirty)}:{Object.keys(methods.control._proxyFormState).join(",")}
      </span>
      <span>
        {counter.count}/{counter.doubled}
      </span>
      <span>full:{name.full}</span>
    </section>
  );
}
