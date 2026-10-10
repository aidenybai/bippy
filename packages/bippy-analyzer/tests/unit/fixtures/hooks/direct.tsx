// @ts-nocheck
import { useState } from "react";

export const Direct = () => {
  const [isOpen, setIsOpen] = useState(false);
  return <button onClick={() => setIsOpen(!isOpen)}>{isOpen ? "Close" : "Open"}</button>;
};
