// @ts-nocheck
import { useState as useLocal } from "react";

export const Aliased = () => {
  const [isOpen, setIsOpen] = useLocal(false);
  return <button onClick={() => setIsOpen(!isOpen)}>{isOpen ? "Close" : "Open"}</button>;
};
