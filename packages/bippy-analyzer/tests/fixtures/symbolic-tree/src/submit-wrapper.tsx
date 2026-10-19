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
