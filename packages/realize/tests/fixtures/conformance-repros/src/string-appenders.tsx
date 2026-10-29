import { useState } from "react";

export const PinPad = () => {
  const [pin, setPin] = useState("");
  return (
    <div>
      <button onClick={() => setPin(pin + "1")}>1</button>
      <button onClick={() => setPin(pin + "2")}>2</button>
      <button onClick={() => setPin(pin + "3")}>3</button>
      <button onClick={() => setPin(pin + "4")}>4</button>
      <button onClick={() => setPin("")}>clear</button>
      {pin.length >= 4 ? <i>full</i> : <i>typing</i>}
    </div>
  );
};
