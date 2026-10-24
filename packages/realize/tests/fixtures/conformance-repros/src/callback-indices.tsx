import { useState } from "react";

const FEATURES = ["Fast", "Typed", "Small"];

export const FeaturePicker = () => {
  const [activeIndex, setActiveIndex] = useState(0);
  return (
    <div>
      {FEATURES.map((feature, index) => (
        <button type="button" key={feature} onClick={() => setActiveIndex(index)}>
          {activeIndex === index ? `${feature} (active)` : feature}
        </button>
      ))}
    </div>
  );
};

export const LastPicked = ({ labels }: { labels: string[] }) => {
  const [lastIndex, setLastIndex] = useState(-1);
  return (
    <button type="button" onClick={() => labels.forEach((_label, index) => setLastIndex(index))}>
      {lastIndex}
    </button>
  );
};

export const LiteralPicker = () => {
  const [pickedIndex, setPickedIndex] = useState(-1);
  return (
    <button
      type="button"
      onClick={() => ["a", "b"].forEach((_letter, index) => setPickedIndex(index))}
    >
      {pickedIndex}
    </button>
  );
};
