import { useState } from "react";

export const DefaultMiddle = () => {
  const [mode, setMode] = useState<"a" | "b" | "c">("a");
  let route = "none";
  switch (mode) {
    case "a":
      route = "a";
      break;
    default:
      route = "default";
      break;
    case "c":
      route = "c";
      break;
  }
  return (
    <div>
      <button onClick={() => setMode("b")}>b</button>
      <button onClick={() => setMode("c")}>c</button>
      {route === "a" ? (
        <i>yes</i>
      ) : route === "c" ? (
        <i>L1</i>
      ) : route === "default" ? (
        <i>L2</i>
      ) : (
        <i>Z1</i>
      )}
    </div>
  );
};

export const DefaultFirstFallsThrough = () => {
  const [mode, setMode] = useState<"a" | "c">("a");
  let isDefault = false;
  let isC = false;
  switch (mode) {
    default:
      isDefault = true;
    case "c":
      isC = true;
  }
  return (
    <div>
      <button onClick={() => setMode("c")}>c</button>
      {isDefault && isC ? <i>both</i> : !isDefault && isC ? <i>L1</i> : <i>Z1</i>}
    </div>
  );
};

export const HandlerDefaultMiddle = () => {
  const [mode] = useState<"a" | "b" | "c">("c");
  const [value, setValue] = useState(0);
  return (
    <div>
      <button
        onClick={() => {
          switch (mode) {
            case "a":
              setValue(1);
              break;
            default:
              setValue(2);
              break;
            case "c":
              setValue(3);
              break;
          }
        }}
      >
        go
      </button>
      {value === 3 ? <i>yes</i> : value === 2 ? <i>Z1</i> : <i>none</i>}
    </div>
  );
};

export const DefaultLast = () => {
  const [mode, setMode] = useState<"a" | "b">("a");
  let route = "none";
  switch (mode) {
    case "a":
      route = "a";
      break;
    default:
      route = "default";
  }
  return (
    <div>
      <button onClick={() => setMode("b")}>b</button>
      {route === "a" ? <i>yes</i> : route === "default" ? <i>L2</i> : <i>Z1</i>}
    </div>
  );
};

export const CaseFallsThrough = () => {
  const [mode, setMode] = useState<"a" | "c">("a");
  let isA = false;
  let isC = false;
  switch (mode) {
    case "a":
      isA = true;
    case "c":
      isC = true;
  }
  return (
    <div>
      <button onClick={() => setMode("c")}>c</button>
      {isA && isC ? <i>both</i> : !isA && isC ? <i>L1</i> : <i>Z1</i>}
    </div>
  );
};
