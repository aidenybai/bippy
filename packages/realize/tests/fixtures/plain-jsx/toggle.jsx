import { useState } from "react";
import * as React from "react";

export const PlainToggle = () => {
  const [isOpen, setIsOpen] = useState(false);
  return <button onClick={() => setIsOpen(!isOpen)}>{isOpen ? "Close" : "Open"}</button>;
};

export const PlainNamespaced = () => {
  const [count, setCount] = React.useState(0);
  return <button onClick={() => setCount(count + 1)}>{count}</button>;
};
