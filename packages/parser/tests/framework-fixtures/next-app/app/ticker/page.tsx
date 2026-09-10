import { Ticker } from "@/components/ticker";

const SYMBOLS = ["aapl", "msft", "nvda"];

export default function TickerPage() {
  return (
    <Ticker>
      {SYMBOLS.map((symbol) => (
        <span key={symbol}>{symbol}</span>
      ))}
      <em>live</em>
    </Ticker>
  );
}
