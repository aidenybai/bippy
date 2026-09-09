import { useEffect, useState } from "react";

/** The awaited promise settles outside the analysis, so it may as well reject into the handler. */
const Parsed = () => {
  const [status, setStatus] = useState("parsing");
  useEffect(() => {
    const run = async () => {
      try {
        const parsed: unknown = await new Response("nope").json();
        setStatus(typeof parsed);
      } catch {
        setStatus("invalid");
      }
    };
    run();
  }, []);
  return (
    <output>
      {status}
      <span />
    </output>
  );
};

/** The same shape where the promise fulfills: the handler is a path the page does not take. */
const Read = () => {
  const [status, setStatus] = useState("reading");
  useEffect(() => {
    const run = async () => {
      try {
        await navigator.clipboard.readText();
        setStatus("read");
      } catch {
        setStatus("denied");
      }
    };
    run();
  }, []);
  return (
    <output>
      {status}
      <span />
    </output>
  );
};

/** A `finally` between the `await` and the handler does not catch the rejection. */
const Wrapped = () => {
  const [status, setStatus] = useState("parsing");
  const [isSettled, setIsSettled] = useState(false);
  useEffect(() => {
    const run = async () => {
      try {
        try {
          await new Response("{").json();
          setStatus("parsed");
        } finally {
          setIsSettled(true);
        }
      } catch {
        setStatus("invalid");
      }
    };
    run();
  }, []);
  return (
    <output>
      {status}
      {isSettled ? <mark /> : <progress />}
    </output>
  );
};

export const isPartial = true;

export default function CaughtRejections() {
  return (
    <main>
      <Parsed />
      <Read />
      <Wrapped />
    </main>
  );
}
