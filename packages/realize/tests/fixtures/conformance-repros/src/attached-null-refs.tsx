import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";

export const ClosingPanel = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [isShown, setIsShown] = useState(false);
  const panelRef = useRef(null);
  useEffect(() => {
    if (!panelRef.current) return;
    if (!isOpen && isShown) setTimeout(() => setIsShown(false), 200);
  }, [isOpen, isShown]);
  return (
    <>
      <button
        onClick={() => {
          if (!isOpen) setIsShown(true);
          setIsOpen(!isOpen);
        }}
      >
        Toggle
      </button>
      {isShown && <div ref={panelRef}>Panel</div>}
    </>
  );
};

const Field = ({ inputRef }: { inputRef: RefObject<null> }) => <input ref={inputRef} />;

export const FocusedField = () => {
  const [isEditing, setIsEditing] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef(null);
  useEffect(() => {
    if (inputRef.current && isEditing) setTimeout(() => setIsFocused(true), 0);
  }, [isEditing]);
  return (
    <>
      <button onClick={() => setIsEditing(true)}>Edit</button>
      {isFocused ? <p>Focused</p> : <p>Idle</p>}
      <Field inputRef={inputRef} />
    </>
  );
};

export const DetachedPanel = () => {
  const [isShown, setIsShown] = useState(true);
  const panelRef = useRef(null);
  useEffect(() => {
    if (panelRef.current) setTimeout(() => setIsShown(false), 200);
  }, [isShown]);
  return isShown ? <div>Panel</div> : null;
};
