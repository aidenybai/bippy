import { useState } from "react";

export const Disclosure = () => {
  const [isOpen, setIsOpen] = useState(false);
  return isOpen ? (
    <section>details</section>
  ) : (
    <button onClick={() => setIsOpen(true)}>show</button>
  );
};
