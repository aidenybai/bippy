import { useState } from "react";

declare const subscribe: (listener: () => void) => void;

const useRowProps = (onOpen: () => void) => ({ onClick: () => onOpen(), role: "row" });

const useSubscription = (onChange: () => void) => {
  subscribe(onChange);
  return null;
};

export const ReturnedRowProps = () => {
  const [isOpen, setIsOpen] = useState(false);
  const rowProps = useRowProps(() => setIsOpen(true));
  return <div {...rowProps}>{isOpen ? "open" : "closed"}</div>;
};

export const UnusedRowProps = () => {
  const [isOpen, setIsOpen] = useState(false);
  useRowProps(() => setIsOpen(true));
  return <div>{isOpen ? "open" : "closed"}</div>;
};

export const SubscribedHelper = () => {
  const [isChanged, setIsChanged] = useState(false);
  useSubscription(() => setIsChanged(true));
  return <div>{isChanged ? "changed" : "same"}</div>;
};
