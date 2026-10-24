import { useState } from "react";
import { makeFormHandlers, makeKeyHandler } from "./wrapped-call-helpers";

export const SubmitField = () => {
  const [isOpen, setIsOpen] = useState(false);
  const { handleSubmit } = makeFormHandlers(isOpen, () => setIsOpen(false));
  return (
    <form onSubmit={handleSubmit}>
      <input onFocus={() => setIsOpen(true)} />
      {isOpen ? <i>open</i> : <i>closed</i>}
    </form>
  );
};

export const KeyField = () => {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <div>
      <input
        onFocus={() => setIsOpen(true)}
        onKeyDown={makeKeyHandler(isOpen, () => setIsOpen(false))}
      />
      {isOpen ? <i>open</i> : <i>closed</i>}
    </div>
  );
};
