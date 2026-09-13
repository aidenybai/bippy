import { FormProvider, useForm, useFormContext } from "react-hook-form";

const Binding = () => {
  const methods = useFormContext();
  return <output>{methods?.control ? "bound" : "unbound"}</output>;
};

export const App = () => {
  const methods = useForm({ defaultValues: { title: "" } });
  return (
    <FormProvider {...methods}>
      <form>
        <Binding />
      </form>
    </FormProvider>
  );
};
