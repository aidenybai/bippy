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
