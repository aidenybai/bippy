import { useState } from "react";

const SNIPPETS = [{ props: ["color"] }, { props: ["color", "speed"] }];

export const SnippetTabs = () => {
  const [activeSnippet, setActiveSnippet] = useState(0);
  const hasSpeed = SNIPPETS[activeSnippet].props.some((prop) => prop === "speed");
  return (
    <div>
      <button type="button" onClick={() => setActiveSnippet(1)}>
        Next
      </button>
      <p>{hasSpeed ? "Has speed" : "No speed"}</p>
    </div>
  );
};
