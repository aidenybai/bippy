import { useState } from "react";

const MODES = ["idle", "busy", "done"] as const;
const LOOKUP = new Map([
  ["idle", 0],
  ["done", 2],
]);
const NEXT = { idle: "busy", busy: "done" };

export const AtLiteral = () => {
  const [mode, setMode] = useState("idle");
  return <button onClick={() => setMode(["idle", "busy", "done"].at(-1) ?? "idle")}>{mode}</button>;
};

export const AtModule = () => {
  const [mode, setMode] = useState("idle");
  return <button onClick={() => setMode(MODES.at(2) ?? "idle")}>{mode}</button>;
};

export const FindModule = () => {
  const [mode, setMode] = useState("idle");
  return (
    <button onClick={() => setMode(MODES.find((item) => item === "done") ?? "idle")}>{mode}</button>
  );
};

export const MapGetModule = () => {
  const [step, setStep] = useState(0);
  return <button onClick={() => setStep(LOOKUP.get("done") ?? 0)}>{step}</button>;
};

export const MapHasModule = () => {
  const [isKnown, setIsKnown] = useState(false);
  return <button onClick={() => setIsKnown(LOOKUP.has("done"))}>{isKnown ? "yes" : "no"}</button>;
};

export const ValuesByIndex = () => {
  const [mode, setMode] = useState("idle");
  return <button onClick={() => setMode(Object.values(NEXT)[1] ?? "idle")}>{mode}</button>;
};

export const KeysByIndex = () => {
  const [mode, setMode] = useState("idle");
  return <button onClick={() => setMode(Object.keys(NEXT)[1] ?? "idle")}>{mode}</button>;
};

export const EntriesByIndex = () => {
  const [mode, setMode] = useState("idle");
  return <button onClick={() => setMode(Object.entries(NEXT)[0]?.[1] ?? "idle")}>{mode}</button>;
};
