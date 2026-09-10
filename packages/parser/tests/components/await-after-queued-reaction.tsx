import { useEffect, useState } from "react";

class Loader {
  status = "pending";

  constructor() {
    this.load()
      .then((result) => {
        this.status = result;
      })
      .catch(() => {
        this.status = "failed";
      });
  }

  async load(): Promise<string> {
    return "ready";
  }
}

const readAfterTick = async (loader: Loader): Promise<string> => {
  const before = loader.status;
  await Promise.resolve();
  return `${before} -> ${loader.status}`;
};

const readAfterPlainAwait = async (loader: Loader): Promise<string> => {
  const before = loader.status;
  await 0;
  return `${before} -> ${loader.status}`;
};

export const isExact = true;

export default function AwaitAfterQueuedReaction() {
  const [ticked, setTicked] = useState<string | null>(null);
  const [plain, setPlain] = useState<string | null>(null);
  useEffect(() => {
    readAfterTick(new Loader()).then(setTicked);
    readAfterPlainAwait(new Loader()).then(setPlain);
  }, []);
  return (
    <dl>
      <dt>after a settled promise</dt>
      <dd>
        {ticked ?? "loading"} <small>observed</small>
      </dd>
      <dt>after a plain value</dt>
      <dd>
        {plain ?? "loading"} <small>observed</small>
      </dd>
    </dl>
  );
}
