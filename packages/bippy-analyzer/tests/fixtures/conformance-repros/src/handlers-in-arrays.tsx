import { useState } from "react";

interface Field {
  name: string;
  onChange: (value: string) => void;
}

const FieldList = ({ fields }: { fields: Field[] }) => (
  <div>
    {fields.map((field) => (
      <input key={field.name} onChange={(event) => field.onChange(event.target.value)} />
    ))}
  </div>
);

export const ProfileForm = () => {
  const [name, setName] = useState("");
  return (
    <div>
      <FieldList fields={[{ name: "name", onChange: (value) => setName(value) }]} />
      <p>{name === "" ? "Empty" : "Filled"}</p>
    </div>
  );
};
