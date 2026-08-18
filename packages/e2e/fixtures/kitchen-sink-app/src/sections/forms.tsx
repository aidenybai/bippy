import { Field, Form, Formik } from "formik";
import { useForm } from "react-hook-form";

import type { LibrarySection } from "../section-registry";

interface HookFormValues {
  firstName: string;
}

const ReactHookFormSection = () => {
  const { register, watch } = useForm<HookFormValues>({
    defaultValues: { firstName: "bippy" },
  });
  return (
    <form>
      <input data-testid="rhf-input" {...register("firstName")} />
      <output data-testid="rhf-value">{watch("firstName")}</output>
    </form>
  );
};

const FormikSection = () => (
  <Formik initialValues={{ email: "bippy@example.com" }} onSubmit={() => {}}>
    <Form>
      <Field data-testid="formik-input" name="email" />
    </Form>
  </Formik>
);

export const formSections: LibrarySection[] = [
  { name: "react-hook-form", Component: ReactHookFormSection },
  { name: "formik", Component: FormikSection },
];
