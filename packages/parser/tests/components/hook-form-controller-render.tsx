import { Controller, useForm } from "react-hook-form";

interface ContactValues {
  subject: string;
  message: string;
}

const SUBJECTS = ["Web Development", "Mobile Development", "Figma Design"];

const ContactForm = () => {
  const { control, handleSubmit } = useForm<ContactValues>({
    defaultValues: { subject: "Figma Design", message: "" },
  });
  return (
    <form onSubmit={handleSubmit(() => undefined)}>
      <Controller
        control={control}
        name="subject"
        render={({ field, fieldState, formState }) => (
          <fieldset>
            <select {...field}>
              {SUBJECTS.map((subject) => (
                <option key={subject} value={subject}>
                  {subject}
                </option>
              ))}
            </select>
            <p>
              {SUBJECTS.indexOf(field.value) + 1} of {SUBJECTS.length}
            </p>
            {field.value === "Figma Design" ? <em>design</em> : <strong>engineering</strong>}
            {fieldState.isDirty ? <i>changed</i> : <i>pristine</i>}
            {formState.isSubmitted ? <b>sent</b> : null}
          </fieldset>
        )}
      />
      <Controller
        control={control}
        name="message"
        render={({ field }) => (
          <label>
            <textarea {...field} />
            {field.value.length === 0 ? <small>required</small> : <small>{field.value}</small>}
          </label>
        )}
      />
    </form>
  );
};

export default ContactForm;
