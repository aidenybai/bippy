import { useState } from "react";

const CATEGORIES = ["subject", "camera"] as const;

export const CategoryPicker = () => {
  const [selections, setSelections] = useState({ subject: 0, camera: 1 });
  const select = (category: (typeof CATEGORIES)[number], index: number) =>
    setSelections((previous) => ({ ...previous, [category]: index }));
  return (
    <div>
      <p>{selections.subject === 0 ? "first subject" : "other subject"}</p>
      <button type="button" onClick={() => select("subject", 2)}>
        Pick
      </button>
    </div>
  );
};

const SUBJECT_KEY = "subject";

export const ConstantKeyPicker = () => {
  const [selections, setSelections] = useState({ subject: 0 });
  return (
    <button type="button" onClick={() => setSelections({ [SUBJECT_KEY]: 1 })}>
      {selections.subject === 0 ? "first" : "second"}
    </button>
  );
};
