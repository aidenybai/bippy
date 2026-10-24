import { useState } from "react";

export const TagEditor = ({ title }: { title: string }) => {
  const [tags, setTags] = useState<string[]>([]);
  const addTag = () => {
    const next = [...tags];
    next.push("tag");
    setTags(next);
  };
  const header = [];
  header.push(<h2 key="title">{title}</h2>);
  return (
    <div>
      {header}
      {tags.length === 0 ? <p>No tags</p> : <p>Some tags</p>}
      <button type="button" onClick={addTag}>
        Add
      </button>
    </div>
  );
};
