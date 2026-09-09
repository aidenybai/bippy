import { useEffect, useState } from "react";

const later = <Value,>(value: Value, delay = 0): Promise<Value> =>
  new Promise((resolve) => setTimeout(() => resolve(value), delay));

const failLater = (message: string): Promise<never> =>
  new Promise((_resolve, reject) => setTimeout(() => reject(new Error(message)), 0));

const Loaded = () => {
  const [data, setData] = useState<string | null>(null);
  useEffect(() => {
    const load = async () => {
      const value = await later("loaded");
      setData(value);
    };
    load();
  }, []);
  return data ? (
    <output>
      {data}
      <span />
    </output>
  ) : (
    <progress />
  );
};

const Sequenced = () => {
  const [steps, setSteps] = useState<string[]>([]);
  useEffect(() => {
    (async () => {
      const first = await later("one");
      setSteps((current) => [...current, first]);
      const second = await later("two", 5);
      setSteps((current) => [...current, second]);
    })();
  }, []);
  return (
    <ol>
      {steps.map((step) => (
        <li key={step}>
          {step}
          <span />
        </li>
      ))}
    </ol>
  );
};

const Guarded = () => {
  const [status, setStatus] = useState("idle");
  useEffect(() => {
    let isActive = true;
    const run = async () => {
      setStatus("loading");
      try {
        const value = await later("ready");
        if (isActive) setStatus(value);
      } catch {
        if (isActive) setStatus("error");
      } finally {
        if (isActive) setStatus((current) => `${current}!`);
      }
    };
    run();
    return () => {
      isActive = false;
    };
  }, []);
  return (
    <output>
      {status}
      <span />
    </output>
  );
};

const Failing = () => {
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const run = async () => {
      try {
        await failLater("nope");
        setError("unreachable");
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "unknown");
      }
    };
    run();
  }, []);
  return error ? (
    <strong>
      {error}
      <span />
    </strong>
  ) : (
    <em>pending</em>
  );
};

const Returned = () => {
  const [total, setTotal] = useState(0);
  useEffect(() => {
    const sum = async (values: number[]) => {
      let result = 0;
      for (const value of values) result += value;
      const bonus = await later(10);
      return result + bonus;
    };
    sum([1, 2, 3]).then(setTotal);
  }, []);
  return (
    <output>
      {total}
      <span />
    </output>
  );
};

const Immediate = () => {
  const [value, setValue] = useState("initial");
  useEffect(() => {
    const run = async () => {
      const settled = await Promise.resolve("settled");
      setValue(settled);
    };
    run();
  }, []);
  return (
    <output>
      {value}
      <span />
    </output>
  );
};

/** The awaited promise comes from outside the analysis; the update after it lands late but with a known value. */
const Deferred = () => {
  const [items, setItems] = useState<string[]>([]);
  useEffect(() => {
    const run = async () => {
      await navigator.clipboard.readText();
      setItems(["clip", "board"]);
    };
    run();
  }, []);
  return (
    <ul>
      {items.map((item) => (
        <li key={item}>
          {item}
          <span />
        </li>
      ))}
    </ul>
  );
};

export default function AsyncEffects() {
  return (
    <main>
      <Loaded />
      <Sequenced />
      <Guarded />
      <Failing />
      <Returned />
      <Immediate />
      <Deferred />
    </main>
  );
}
