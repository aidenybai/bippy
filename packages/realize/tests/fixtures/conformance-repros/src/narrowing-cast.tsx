import { useState } from "react";

type Language = "tsx" | "css";

export const LanguagePicker = ({ fileName }: { fileName: string }) => {
  const [language, setLanguage] = useState<Language>("tsx");
  return (
    <button
      type="button"
      onClick={() => setLanguage((fileName.split(".").pop() as Language) || "tsx")}
    >
      {language}
    </button>
  );
};
