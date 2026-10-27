import { useState } from "react";

export function FaqAccordion() {
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});
  const sections = ["shipping", "returns", "warranty"];
  return (
    <div>
      {sections.map((section) => (
        <div key={section}>
          {openSections[section] ? <p>answer</p> : <p>hidden</p>}
          <button
            onClick={() => setOpenSections({ ...openSections, [section]: !openSections[section] })}
          >
            {section}
          </button>
        </div>
      ))}
    </div>
  );
}
