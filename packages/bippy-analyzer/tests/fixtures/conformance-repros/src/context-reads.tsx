import { useEffect, useState } from "react";

declare const load: () => Promise<string>;

export const MountedFlag = () => {
  const [value, setValue] = useState<string | null>(null);
  useEffect(() => {
    let isMounted = true;
    const run = async () => {
      const result = await load();
      if (isMounted) setValue(result);
    };
    void run();
    return () => {
      isMounted = false;
    };
  }, []);
  return <p>{value ?? "Loading"}</p>;
};

export const IgnoreFlag = () => {
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    let ignore = false;
    void load().then((result) => {
      if (!ignore) setName(result);
    });
    return () => {
      ignore = true;
    };
  }, []);
  return <p>{name ?? "Loading"}</p>;
};

export const SettledFlag = () => {
  const [value, setValue] = useState<string | null>(null);
  useEffect(() => {
    let isDone = false;
    const run = async () => {
      const result = await load();
      isDone = true;
      if (isDone) setValue(result);
    };
    void run();
    return () => {
      isDone = true;
    };
  }, []);
  return <p>{value ?? "Loading"}</p>;
};
