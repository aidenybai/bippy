import { useEffect, useRef, useState } from "react";

const SavedAgo = () => {
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const startedAt = useRef(Date.now());
  useEffect(() => {
    setSavedAt(Date.now());
  }, []);
  if (savedAt === null) return <s />;
  const secondsAgo = Math.max(0, Math.round((Date.now() - savedAt) / 1000));
  const sinceStart = Math.abs(Math.floor((Date.now() - startedAt.current) / 1000));
  return (
    <p>
      {secondsAgo < 60 ? <b /> : <i />}
      {sinceStart <= 5 ? <b /> : <i />}
      {Math.pow(10, 2) === 100 && Math.trunc(-4.7) === -4 ? <u /> : <em />}
    </p>
  );
};

const Prices = () => {
  const usd = new Intl.NumberFormat("en", {
    style: "currency",
    currency: "USD",
    currencyDisplay: "code",
  });
  const wrongCurrency = () => {
    try {
      return new Intl.NumberFormat("en", { style: "currency", currency: "not a code" }).format(1);
    } catch {
      return "fallback";
    }
  };
  return (
    <ul>
      <li>{usd.format(1234.5)}</li>
      <li>{new Intl.NumberFormat("de-DE").format(1234.5)}</li>
      <li>{wrongCurrency()}</li>
      <li>{usd.resolvedOptions().currency}</li>
    </ul>
  );
};

const ScriptTag = () => {
  const script = document.createElement("script");
  script.dataset.sdkn = "analytics";
  script.src = "https://example.com/script.js";
  return (
    <code>
      {script.dataset.sdkn}|{script.getAttribute("data-sdkn")}|{String(script.dataset.other)}
    </code>
  );
};

const NumberRanges = () => (
  <div>
    <SavedAgo />
    <Prices />
    <ScriptTag />
  </div>
);
export default NumberRanges;
