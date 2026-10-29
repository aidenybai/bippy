// @ts-nocheck
import * as React from "react";

export const Namespaced = () => {
  const [isOpen, setIsOpen] = React.useState(false);
  return <button onClick={() => setIsOpen(!isOpen)}>{isOpen ? "Close" : "Open"}</button>;
};
