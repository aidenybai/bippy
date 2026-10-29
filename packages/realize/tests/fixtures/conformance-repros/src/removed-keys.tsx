import { useState } from "react";

export const SelectedTags = ({ tags }: { tags: string[] }) => {
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const toggle = (tag: string) =>
    setSelected((previous) => {
      if (!previous[tag]) return { ...previous, [tag]: true };
      const { [tag]: _removed, ...rest } = previous;
      return rest;
    });
  return (
    <ul>
      {tags.map((tag) => (
        <li key={tag}>
          <button onClick={() => toggle(tag)}>{selected[tag] ? `Remove ${tag}` : tag}</button>
        </li>
      ))}
    </ul>
  );
};
