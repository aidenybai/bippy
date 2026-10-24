import { createElement, useState } from "react";
import { jsx, jsxs } from "react/jsx-runtime";

export function CreateElementToggle() {
  const [on, setOn] = useState(false);
  return createElement(
    "div",
    null,
    createElement("button", { onClick: () => setOn(!on) }, "flip"),
    on ? createElement("i", null, "yes") : createElement("i", null, "no"),
  );
}

export function JsxRuntimeToggle() {
  const [on, setOn] = useState(false);
  return jsxs("div", {
    children: [
      jsx("button", { onClick: () => setOn(!on), children: "flip" }),
      on ? jsx("i", { children: "yes" }) : jsx("i", { children: "no" }),
    ],
  });
}

const Badge = ({ label }: { label: string }) => {
  const [isOpen, setIsOpen] = useState(false);
  return createElement("button", { onClick: () => setIsOpen(!isOpen) }, isOpen ? label : "closed");
};

export function CreateElementParent() {
  const [label] = useState("open");
  return createElement(Badge, { label });
}
