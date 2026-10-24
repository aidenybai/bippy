import { useState } from "react";

interface Theme {
  id: string;
  name: string;
}

export const ThemePicker = ({ themes }: { themes: Theme[] }) => {
  const [themeId, setThemeId] = useState("");
  return (
    <select value={themeId} onChange={(event) => setThemeId(event.target.value)}>
      <option value="">Default</option>
      {...themes.map(({ id, name }) => (
        <option key={id} value={id}>
          {name}
        </option>
      ))}
    </select>
  );
};
