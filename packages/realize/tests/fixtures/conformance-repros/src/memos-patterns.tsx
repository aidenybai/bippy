import { useState } from "react";

/**
 * Patterns from usememos/memos the analysis got wrong.
 */

// memos web/src/components/MemoContent/markdown/Heading.tsx:16
export const Heading = ({ level, text }: { level: 1 | 2 | 3; text: string }) => {
  const Tag = `h${level}` as const;
  return <Tag>{text}</Tag>;
};

const LOCALES = ["en", "fr", "de"];

// memos web/src/components/LocalePicker.tsx:25
export const LocaleList = () => {
  const [query, setQuery] = useState("");
  const matches = LOCALES.filter((locale) => locale.startsWith(query));
  return (
    <div>
      <input value={query} onChange={(event) => setQuery(event.target.value)} />
      {matches.length === 0 && <p>No language</p>}
    </div>
  );
};

interface Option {
  label: string;
  icon?: string;
}

const OPTIONS: Option[] = [{ label: "Public", icon: "globe" }];

const getOption = (label: string): Option | undefined =>
  OPTIONS.find((option) => option.label === label);

// memos web/src/components/VisibilityIcon.tsx:12
export const OptionIcon = ({ label }: { label: string }) => {
  const icon = getOption(label)?.icon;
  if (!icon) return null;
  return <i>{icon}</i>;
};
