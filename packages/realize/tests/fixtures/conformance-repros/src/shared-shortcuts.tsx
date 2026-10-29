import { useState } from "react";
import { useKey } from "key-hooks";

const useShortcut = (key: string, onPress: () => void) => {
  useKey(key, onPress);
};

export const SharedShortcut = () => {
  const [isOpen, setIsOpen] = useState(true);
  const close = () => setIsOpen(false);
  useShortcut("Escape", close);
  useShortcut("q", close);
  return <div>{isOpen ? <b>open</b> : <i>closed</i>}</div>;
};
