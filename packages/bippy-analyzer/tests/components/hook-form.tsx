import {
  Controller,
  FormProvider,
  useController,
  useFieldArray,
  useForm,
  useFormContext,
  useFormState,
  useWatch,
} from "react-hook-form";

interface InvoiceValues {
  sender: { name: string; email: string };
  items: Array<{ name: string; quantity: number }>;
  currency: string;
  notes?: string;
}

const DEFAULT_VALUES: InvoiceValues = {
  sender: { name: "Ada", email: "" },
  items: [
    { name: "Design", quantity: 2 },
    { name: "Build", quantity: 1 },
  ],
  currency: "USD",
};

const SenderName = () => {
  const { register, getValues } = useFormContext<InvoiceValues>();
  const field = register("sender.name", { required: true });
  return (
    <label>
      <input {...field} defaultValue={getValues("sender.name")} />
      {typeof field.onChange === "function" && <b>{field.name}</b>}
    </label>
  );
};

const WatchedSender = () => {
  const { control } = useFormContext<InvoiceValues>();
  const name = useWatch({ control, name: "sender.name" });
  const [email, currency] = useWatch({ control, name: ["sender.email", "currency"] });
  const everything = useWatch({ control });
  return (
    <dl>
      <dt>{name}</dt>
      <dd>{email === "" ? "no email" : email}</dd>
      <dd>{currency}</dd>
      <dd>{everything.items?.length}</dd>
    </dl>
  );
};

const FormStatus = () => {
  const { control } = useFormContext<InvoiceValues>();
  const { isDirty, isSubmitted, submitCount, errors, isValid } = useFormState({ control });
  return (
    <ul>
      <li>{isDirty ? "dirty" : "pristine"}</li>
      <li>{isSubmitted ? "submitted" : "unsubmitted"}</li>
      <li>{submitCount}</li>
      {errors.sender?.name && <li>name error</li>}
      <li>{typeof isValid === "boolean" ? "known validity" : "unknown validity"}</li>
    </ul>
  );
};

const CurrencyField = () => {
  const { control } = useFormContext<InvoiceValues>();
  const { field, fieldState } = useController({ control, name: "currency" });
  return (
    <fieldset>
      <select {...field} value={field.value}>
        <option value="USD">USD</option>
        <option value="EUR">EUR</option>
      </select>
      {fieldState.invalid ? <em>invalid</em> : <span>{field.value}</span>}
      {fieldState.isTouched ? <em>touched</em> : <span>untouched</span>}
    </fieldset>
  );
};

const Items = () => {
  const { control } = useFormContext<InvoiceValues>();
  const { fields, append, remove } = useFieldArray({ control, name: "items" });
  return (
    <ol>
      {fields.map((item, index) => (
        <li key={item.id}>
          <Controller
            control={control}
            name={`items.${index}.name`}
            render={({ field }) => <input {...field} />}
          />
          <span>{item.name}</span>
          <button type="button" onClick={() => remove(index)}>
            remove
          </button>
        </li>
      ))}
      <button type="button" onClick={() => append({ name: "", quantity: 1 })}>
        add {fields.length + 1}
      </button>
    </ol>
  );
};

const Notes = () => {
  const { watch, getFieldState, formState } = useFormContext<InvoiceValues>();
  const notes = watch("notes");
  const { isDirty } = getFieldState("sender.name", formState);
  return (
    <p>
      {notes === undefined ? <i>no notes</i> : <q>{notes}</q>}
      {isDirty ? <em>edited</em> : <span>untouched</span>}
    </p>
  );
};

const InvoiceForm = () => {
  const form = useForm<InvoiceValues>({ defaultValues: DEFAULT_VALUES, mode: "onTouched" });
  const onSubmit = form.handleSubmit(() => undefined);
  return (
    <FormProvider {...form}>
      <form onSubmit={onSubmit}>
        <SenderName />
        <WatchedSender />
        <FormStatus />
        <CurrencyField />
        <Items />
        <Notes />
        <button type="submit" disabled={form.formState.isSubmitting}>
          save
        </button>
      </form>
    </FormProvider>
  );
};

export default function ReactHookForm() {
  return <InvoiceForm />;
}
