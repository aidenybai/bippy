import { useState } from "react";

export const TagList = () => {
  const [tags, setTags] = useState<string[]>([]);
  const addInPlace = () => {
    tags.push("pushed");
    setTags(tags);
  };
  const addCopy = () => {
    tags.push("copied");
    setTags([...tags]);
  };
  return (
    <div>
      <button onClick={addInPlace}>Push</button>
      <button onClick={addCopy}>Copy</button>
      {tags.length === 0 ? (
        <p>No tags</p>
      ) : (
        <ul>
          {tags.map((tag) => (
            <li key={tag}>{tag}</li>
          ))}
        </ul>
      )}
    </div>
  );
};

export const SortedList = ({ items }: { items: string[] }) => {
  items.sort();
  return (
    <ul>
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
};

export const ClickStats = () => {
  const [stats] = useState({ clicks: 0 });
  return (
    <button
      onClick={() => {
        stats.clicks += 1;
      }}
    >
      {stats.clicks > 0 ? "Clicked" : "Not clicked"}
    </button>
  );
};
