import { useState } from "react";

type Sort = "newest" | "oldest" | "name";

export const SortSelect = () => {
  const [sort, setSort] = useState<Sort>("newest");
  return (
    <label>
      Sort
      <select value={sort} onChange={(event) => setSort(event.target.value as Sort)}>
        <option value="newest">Newest</option>
        <option value="oldest">Oldest</option>
        <option value="name">Name</option>
      </select>
      <span>{sort}</span>
    </label>
  );
};
