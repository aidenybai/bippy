// @ts-nocheck
import React from "react";

export const DefaultImported = () => {
  const [isOpen, setIsOpen] = React.useState(false);
  return <button onClick={() => setIsOpen(!isOpen)}>{isOpen ? "Close" : "Open"}</button>;
};
