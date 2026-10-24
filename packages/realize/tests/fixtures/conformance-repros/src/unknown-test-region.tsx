import { useState } from "react";

const PETS = new Map([
  ["cat", "Cat"],
  ["dog", "Dog"],
]);

export const PetSelection = () => {
  const [slugs, setSlugs] = useState<string[]>([]);
  const selectedNames = slugs
    .map((slug) => PETS.get(slug))
    .filter((name): name is string => Boolean(name));
  return (
    <div>
      <button type="button" onClick={() => setSlugs((current) => [...current, "cat"])}>
        Add cat
      </button>
      <p>{selectedNames.length === 0 ? "Nothing selected" : "Selected"}</p>
    </div>
  );
};
