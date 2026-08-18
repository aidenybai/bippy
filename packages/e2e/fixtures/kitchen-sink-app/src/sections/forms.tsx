import { Field, Form, Formik } from "formik";
import { useState } from "react";
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

const FormikSection = () => {
  const [submittedEmail, setSubmittedEmail] = useState("none");
  return (
    <Formik
      initialValues={{ email: "bippy@example.com" }}
      onSubmit={(values) => setSubmittedEmail(values.email)}
    >
      <Form>
        <Field data-testid="formik-input" name="email" />
        <button data-testid="formik-submit" type="submit">
          submit
        </button>
        <output data-testid="formik-submitted">{submittedEmail}</output>
      </Form>
    </Formik>
  );
};

export const formSections: LibrarySection[] = [
  { name: "react-hook-form", Component: ReactHookFormSection },
  { name: "formik", Component: FormikSection },
];
