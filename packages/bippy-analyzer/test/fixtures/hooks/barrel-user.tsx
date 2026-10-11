// @ts-nocheck
import { useState, useToggleState } from "./barrel";

export const FromBarrel = () => {
  const [isOpen, setIsOpen] = useState(false);
  return <button onClick={() => setIsOpen(!isOpen)}>{isOpen ? "Close" : "Open"}</button>;
};

export const FromRenamedBarrel = () => {
  const [isOpen, setIsOpen] = useToggleState(false);
  return <button onClick={() => setIsOpen(!isOpen)}>{isOpen ? "Close" : "Open"}</button>;
};
