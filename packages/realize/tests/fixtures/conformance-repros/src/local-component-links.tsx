import { useState } from "react";

interface Header {
  name: string;
}

const HeaderList = ({
  headers,
  onChange,
}: {
  headers: Header[];
  onChange: (headers: Header[]) => void;
}) => {
  const rename = (index: number, name: string) => {
    const next = [...headers];
    next[index].name = name;
    onChange(next);
  };
  return <input value={headers[0]?.name} onChange={(event) => rename(0, event.target.value)} />;
};

export const WebhookSettings = () => {
  const [form, setForm] = useState({ headers: [{ name: "" }] });
  const Fields = () => (
    <HeaderList
      headers={form.headers}
      onChange={(headers) => setForm((previous) => ({ ...previous, headers }))}
    />
  );
  return <Fields />;
};
