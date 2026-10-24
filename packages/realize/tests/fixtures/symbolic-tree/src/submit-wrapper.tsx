import { useState } from "react";
import { useForm } from "form-lib";

interface Values {
  email: string;
}

export const SignIn = () => {
  const [status, setStatus] = useState<"editing" | "sent">("editing");
  const form = useForm<Values>();
  const send = (values: Values) => {
    if (values.email) setStatus("sent");
  };
  if (status === "sent") return <p>Check your inbox</p>;
  return (
    <form onSubmit={form.handleSubmit(send)}>
      <input {...form.register("email")} />
      <button>Send</button>
    </form>
  );
};

export const Subscribe = () => {
  const [isSubscribed, setIsSubscribed] = useState(false);
  const { register, handleSubmit, formState } = useForm<Values>();
  return (
    <form onSubmit={handleSubmit(() => setIsSubscribed(true))}>
      <input {...register("email")} />
      {formState.errors.email ? <p>{formState.errors.email.message}</p> : null}
      <button disabled={isSubscribed}>Subscribe</button>
    </form>
  );
};
