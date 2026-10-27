import { useState } from "react";

export const MappedSelect = () => {
  const [pick, setPick] = useState("a");
  return (
    <div>
      {pick === "a" ? <i>first</i> : pick === "b" ? <i>second</i> : <i>other</i>}
      <select
        value={pick}
        onChange={(event) => setPick(event.target.value === "c" ? "a" : event.target.value)}
      >
        <option value="a">A</option>
        <option value="b">B</option>
        <option value="c">C</option>
      </select>
    </div>
  );
};

export const MappedOptions = () => {
  const [pick, setPick] = useState("a");
  const options = ["a", "b"];
  return (
    <div>
      {pick === "a" ? <i>first</i> : pick === "b" ? <i>second</i> : <i>other</i>}
      <select value={pick} onChange={(event) => setPick(event.target.value)}>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </div>
  );
};

export const RadioPair = () => {
  const [pick, setPick] = useState("a");
  return (
    <div>
      {pick === "a" ? <i>first</i> : pick === "b" ? <i>second</i> : <i>other</i>}
      <input
        type="radio"
        value="a"
        checked={pick === "a"}
        onChange={(event) => setPick(event.target.value)}
      />
      <input
        type="radio"
        value="b"
        checked={pick === "b"}
        onChange={(event) => setPick(event.target.value)}
      />
    </div>
  );
};
