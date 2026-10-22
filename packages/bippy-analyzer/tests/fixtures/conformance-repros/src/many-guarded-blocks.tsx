import { useCallback, useEffect, useState } from "react";

export const ManyGuardedBlocks = ({ query }: { query: string }) => {
  const [phase, setPhase] = useState("s0");
  const [total, setTotal] = useState(0);
  const [note, setNote] = useState("");
  const run = useCallback(async (input: string) => {
    const query = input.trim();
    if (query.startsWith("p0")) {
      setPhase("s0");
      if (query.length > 0) setTotal(0);
      await Promise.resolve();
      if (query.endsWith("0")) {
        setNote("done");
        return;
      }
      setTotal((current) => current + 0);
    }
    if (query.startsWith("p1")) {
      setPhase("s1");
      if (query.length > 1) setTotal(1);
      await Promise.resolve();
      if (query.endsWith("1")) {
        setNote("done");
        return;
      }
      setTotal((current) => current + 1);
    }
    if (query.startsWith("p2")) {
      setPhase("s2");
      if (query.length > 2) setTotal(2);
      await Promise.resolve();
      if (query.endsWith("2")) {
        setNote("done");
        return;
      }
      setTotal((current) => current + 2);
    }
    if (query.startsWith("p3")) {
      setPhase("s0");
      if (query.length > 3) setTotal(3);
      await Promise.resolve();
      if (query.endsWith("3")) {
        setNote("done");
        return;
      }
      setTotal((current) => current + 3);
    }
    if (query.startsWith("p4")) {
      setPhase("s1");
      if (query.length > 4) setTotal(4);
      await Promise.resolve();
      if (query.endsWith("4")) {
        setNote("done");
        return;
      }
      setTotal((current) => current + 4);
    }
    if (query.startsWith("p5")) {
      setPhase("s2");
      if (query.length > 5) setTotal(5);
      await Promise.resolve();
      if (query.endsWith("5")) {
        setNote("done");
        return;
      }
      setTotal((current) => current + 5);
    }
    if (query.startsWith("p6")) {
      setPhase("s0");
      if (query.length > 6) setTotal(6);
      await Promise.resolve();
      if (query.endsWith("6")) {
        setNote("done");
        return;
      }
      setTotal((current) => current + 6);
    }
    if (query.startsWith("p7")) {
      setPhase("s1");
      if (query.length > 7) setTotal(7);
      await Promise.resolve();
      if (query.endsWith("7")) {
        setNote("done");
        return;
      }
      setTotal((current) => current + 7);
    }
    if (query.startsWith("p8")) {
      setPhase("s2");
      if (query.length > 8) setTotal(8);
      await Promise.resolve();
      if (query.endsWith("8")) {
        setNote("done");
        return;
      }
      setTotal((current) => current + 8);
    }
    if (query.startsWith("p9")) {
      setPhase("s0");
      if (query.length > 9) setTotal(9);
      await Promise.resolve();
      if (query.endsWith("9")) {
        setNote("done");
        return;
      }
      setTotal((current) => current + 9);
    }
    setPhase("s0");
  }, []);
  useEffect(() => {
    void run(query);
  }, [query, run]);
  return <p>{phase === "s1" ? "one" : total > 3 ? "many" : note === "done" ? "done" : "none"}</p>;
};
