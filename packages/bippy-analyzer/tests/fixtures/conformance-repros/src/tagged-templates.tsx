import { useState } from "react";

const hsl = (strings: TemplateStringsArray, ...values: number[]) =>
  strings.reduce((text, part, index) => `${text}${part}${values[index] ?? ""}`, "");

export const HueButton = () => {
  const [hue, setHue] = useState(200);
  const background = hsl`hsl(${hue} 80% 50%)`;
  return (
    <button style={{ background }} onClick={() => setHue(hue + 120)}>
      {hue > 300 ? "Warm" : "Cool"}
    </button>
  );
};

export const DigitHint = ({ isStrict }: { isStrict: boolean }) => (
  <p className={String.raw`[&_svg]:size-4`} title={String.raw`\d+`}>
    {isStrict ? "Digits only" : "Anything"}
  </p>
);
