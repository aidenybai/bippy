import { useState } from "react";

const toCents = (amount: number) => BigInt(Math.round(amount * 100));

export function CartTotal({ prices }: { prices: number[] }) {
  const [discount, setDiscount] = useState(0n);
  const subtotal = prices.reduce((sum, price) => sum + toCents(price), 0n);
  const total = subtotal > discount ? subtotal - discount : 0n;
  return (
    <div>
      <button onClick={() => setDiscount(500n)}>Apply $5 off</button>
      <p>{total === 0n ? "Free" : `${total} cents`}</p>
    </div>
  );
}
