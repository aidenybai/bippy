import { useState } from "react";

export const AlignGrid = () => {
  const [pick, setPick] = useState<[number, number] | null>(null);
  return (
    <div>
      {[0, 1].flatMap((row) =>
        [0, 1].map((column) => (
          <button type="button" key={`${column}${row}`} onClick={() => setPick([column, row])}>
            {pick?.[0] === column && pick?.[1] === row ? "on" : "off"}
          </button>
        )),
      )}
    </div>
  );
};
