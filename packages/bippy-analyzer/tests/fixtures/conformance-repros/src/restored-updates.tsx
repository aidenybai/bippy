import { useState } from "react";

export const RestoredAfterUpdate = () => {
  const [isOn, setIsOn] = useState(false);
  return (
    <div>
      <button
        onClick={() => {
          setIsOn(false);
          setIsOn(isOn);
        }}
      >
        keep
      </button>
      <button onClick={() => setIsOn(true)}>on</button>
      {isOn ? <i>on</i> : <i>off</i>}
    </div>
  );
};

export const RestoredFieldAfterUpdate = () => {
  const [form, setForm] = useState({ isOpen: false, name: "a" });
  return (
    <div>
      <button
        onClick={() => {
          setForm({ isOpen: false, name: "b" });
          setForm({ ...form, name: "c" });
        }}
      >
        rename
      </button>
      <button onClick={() => setForm({ ...form, isOpen: true })}>open</button>
      {form.isOpen ? <i>open</i> : <i>closed</i>}
    </div>
  );
};

export const RestoredExplicitField = () => {
  const [box, setBox] = useState({ count: 3, mode: "a" });
  return (
    <div>
      <button
        onClick={() => {
          setBox({ count: 7, mode: "a" });
          setBox({ count: box.count, mode: "b" });
        }}
      >
        go
      </button>
      {box.count === 3 && box.mode === "b" ? (
        <i>three</i>
      ) : box.count === 7 && box.mode === "b" ? (
        <i>seven</i>
      ) : (
        <i>start</i>
      )}
    </div>
  );
};
