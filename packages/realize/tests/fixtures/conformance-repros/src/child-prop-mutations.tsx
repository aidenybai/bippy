import { useState } from "react";

interface Header {
  key: string;
  value: string;
}

interface HeaderListProps {
  headers: Header[];
  onChange: (headers: Header[]) => void;
}

const HeaderList = ({ headers, onChange }: HeaderListProps) => (
  <ul>
    {headers.map((header, index) => (
      <li key={index}>
        <input
          value={header.key}
          onChange={(event) => {
            const updated = [...headers];
            updated[index].key = event.target.value;
            onChange(updated);
          }}
        />
      </li>
    ))}
  </ul>
);

export const WebhookForm = () => {
  const [form, setForm] = useState({ url: "", headers: [] as Header[] });
  return (
    <HeaderList headers={form.headers} onChange={(headers) => setForm({ ...form, headers })} />
  );
};

export const HeaderSection = ({ headers, onChange }: HeaderListProps) => (
  <section>
    <HeaderList headers={headers} onChange={onChange} />
  </section>
);
