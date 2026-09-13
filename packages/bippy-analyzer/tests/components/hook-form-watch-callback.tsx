import { useCallback, useEffect, useState } from "react";
import { useForm, useFormContext, FormProvider, useWatch } from "react-hook-form";

const Child = () => {
  const { setValue, watch } = useFormContext();
  const items = useWatch({ name: "items" });
  const [runs, setRuns] = useState(0);
  const [fired, setFired] = useState(0);
  const calculate = useCallback(() => {
    setValue("details.subTotal", items.length);
  }, [items, setValue]);
  useEffect(() => {
    calculate();
    setRuns((count) => count + 1);
  }, [calculate]);
  useEffect(() => {
    const subscription = watch(() => setFired((count) => count + 1));
    return () => subscription.unsubscribe();
  }, [watch]);
  return (
    <output>
      runs {runs} fired {fired}
    </output>
  );
};

const Probe = () => {
  const form = useForm({ defaultValues: { items: [{ total: 2 }], details: { subTotal: 0 } } });
  return (
    <FormProvider {...form}>
      <Child />
    </FormProvider>
  );
};

export default Probe;
