import { useState } from "react";

const ZERO = 0;
const ONE = 1;
const YES = true;

export const FoldedOperators = () => {
  const [isOn, setIsOn] = useState(false);
  const shift = isOn ? 2 : 2;
  return (
    <button onClick={() => setIsOn(!isOn)}>
      {~ZERO === -1 ? "complement" : "never"}
      {+YES === 1 ? "plus" : "never"}
      {-ONE < 0 ? "minus" : "never"}
      {typeof ONE === "number" ? "typeof" : "never"}
      {(shift & 1) === 0 ? "and" : "never"}
      {shift << 1 === 4 ? "shift" : "never"}
    </button>
  );
};
