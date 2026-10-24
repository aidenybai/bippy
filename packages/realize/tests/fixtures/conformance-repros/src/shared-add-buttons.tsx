import { useState } from "react";

export const TwoLists = () => {
  const [agents, setAgents] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const renderAddButton = (onClick: () => void) => <button onClick={onClick}>Add</button>;
  return (
    <div>
      {renderAddButton(() => setAgents([...agents, "agent"]))}
      {agents.length > 0 ? <p>agents</p> : <i>no agents</i>}
      {renderAddButton(() => setCategories([...categories, "category"]))}
      {categories.length > 0 ? <p>categories</p> : <i>no categories</i>}
    </div>
  );
};
