import { useState } from "react";
import { DIGITS } from "./regexp-patterns";

const EMAIL = /^[^@\s]+@[^@\s]+$/;

const WORDS = /\w+/g;

export const EmailHint = () => {
  const [email, setEmail] = useState("");
  return (
    <button onClick={() => setEmail("ada@example.com")}>
      {EMAIL.test(email) ? "valid" : "invalid"}
    </button>
  );
};

export const LiteralPattern = () => {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <button onClick={() => setIsOpen(!isOpen)}>
      {/b/.test("abc") ? (isOpen ? "open" : "closed") : "never"}
    </button>
  );
};

export const ImportedDigits = () => {
  const [code, setCode] = useState("12");
  return (
    <button onClick={() => setCode(`${code}a`)}>{DIGITS.test(code) ? "digits" : "mixed"}</button>
  );
};

export const GlobalPattern = () => {
  const [text, setText] = useState("hi");
  return <button onClick={() => setText("")}>{WORDS.test(text) ? "words" : "empty"}</button>;
};
