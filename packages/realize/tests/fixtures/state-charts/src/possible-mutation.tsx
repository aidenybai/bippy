import { useState } from "react";

declare function shuffleInPlace(values: string[]): void;

export const Deck = () => {
  const [cards, setCards] = useState<string[]>([]);
  const [count, setCount] = useState(0);
  const shuffle = () => {
    shuffleInPlace(cards);
    setCount(count + 1);
  };
  return (
    <div>
      {cards.length === 0 ? <p>Empty</p> : <p>Cards</p>}
      <button type="button" onClick={shuffle}>
        Shuffle {count}
      </button>
    </div>
  );
};
