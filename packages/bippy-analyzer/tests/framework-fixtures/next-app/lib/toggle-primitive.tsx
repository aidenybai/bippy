import { forwardRef, useState, type ButtonHTMLAttributes } from "react";

export const TogglePrimitive = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement>
>((props, ref) => {
  const [isPressed, setPressed] = useState(false);
  return (
    <button
      ref={ref}
      type="button"
      aria-pressed={isPressed}
      onClick={() => setPressed(!isPressed)}
      {...props}
    >
      {isPressed ? "on" : "off"}
    </button>
  );
});
TogglePrimitive.displayName = "TogglePrimitive";

export const LabelPrimitive = ({ text }: { text: string }) => {
  const [label] = useState(text);
  return <label>{label}</label>;
};
