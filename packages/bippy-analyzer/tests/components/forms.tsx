import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

const COUNTRIES = [
  { code: "de", name: "Germany" },
  { code: "fr", name: "France" },
  { code: "jp", name: "Japan" },
];

const SubmitButton = () => {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}>
      {pending ? "saving…" : "save"}
    </button>
  );
};

const Field = ({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
}) => (
  <div className="field">
    <label htmlFor={id}>{label}</label>
    {children}
  </div>
);

const subscribe = async (_previous: string | null, formData: FormData): Promise<string | null> => {
  const email = formData.get("email");
  return typeof email === "string" && email.includes("@") ? null : "invalid email";
};

const Signup = () => {
  const [error, submit] = useActionState(subscribe, null);
  const [name, setName] = useState("");
  const [country, setCountry] = useState(COUNTRIES[0].code);
  return (
    <form action={submit}>
      <fieldset>
        <legend>account</legend>
        <Field id="name" label="Name">
          <input
            id="name"
            name="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Field id="email" label="Email">
          <input id="email" name="email" type="email" required />
        </Field>
        <Field id="country" label="Country">
          <select
            id="country"
            name="country"
            value={country}
            onChange={(event) => setCountry(event.target.value)}
          >
            {COUNTRIES.map((entry) => (
              <option key={entry.code} value={entry.code}>
                {entry.name}
              </option>
            ))}
          </select>
        </Field>
        <Field id="bio" label="Bio">
          <textarea id="bio" name="bio" defaultValue="hello" rows={3} />
        </Field>
        <label>
          <input type="checkbox" name="terms" /> accept terms
        </label>
      </fieldset>
      {error ? <p role="alert">{error}</p> : null}
      {name.length > 0 && <output>{name.length} characters</output>}
      <SubmitButton />
    </form>
  );
};

export default function Forms() {
  return (
    <section>
      <Signup />
    </section>
  );
}
