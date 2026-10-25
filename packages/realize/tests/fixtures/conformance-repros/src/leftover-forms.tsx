import { useState } from "react";

enum Tone {
  Calm = "calm",
  Loud = "loud",
}

export const RoundedToggle = () => {
  const [x, setX] = useState(0);
  return (
    <button onClick={() => setX(x === 0 ? 1 : 0)}>
      {Math.floor(x / 2) === 0 ? "floor" : "never"}
      {Math.round(x / 2) <= 1 ? "round" : "never"}
    </button>
  );
};

export const EnumValues = () => {
  const [tone, setTone] = useState<string>(Tone.Calm);
  return <button onClick={() => setTone(Object.values(Tone)[0] ?? "")}>{tone}</button>;
};

enum Mode {
  Idle,
  Busy,
  Done,
}

export const EnumCount = () => {
  const [step, setStep] = useState(0);
  return (
    <button
      onClick={() =>
        setStep(Object.values(Mode).filter((item) => typeof item === "number").length - 1)
      }
    >
      {step}
    </button>
  );
};

export const EnumNames = () => {
  const [name, setName] = useState("");
  return <button onClick={() => setName(Object.values(Mode)[0] ?? "")}>{name}</button>;
};
