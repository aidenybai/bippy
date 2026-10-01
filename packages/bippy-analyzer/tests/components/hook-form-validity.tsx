import { useForm } from "react-hook-form";

interface SignupValues {
  email: string;
}

/**
 * `isValid` is only settled once react-hook-form has run the field rules after
 * mount, so before then the analysis can only say it is some boolean; the rest
 * of the form is decided by the default values.
 */
const Signup = () => {
  const { register, formState, getValues } = useForm<SignupValues>({
    defaultValues: { email: "ada@example.com" },
    mode: "onChange",
  });
  const { isValid, isDirty } = formState;
  return (
    <form>
      <input {...register("email", { required: true })} />
      {isValid ? <button type="submit">continue</button> : <b>fill in the form</b>}
      {isDirty ? <em>edited</em> : <i>{getValues("email")}</i>}
    </form>
  );
};

export default function HookFormValidity() {
  return <Signup />;
}

export const minCoverage = 0.8;
