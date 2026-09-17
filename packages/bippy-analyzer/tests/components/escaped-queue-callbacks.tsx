import { useEffect, useState } from "react";

interface PendingLoad {
  name: string;
  callback: (error: Error | null) => void;
}

/** i18next's backend connector: callbacks queue up while a load is in flight and all run when it settles. */
class Loader {
  private readonly queue: PendingLoad[] = [];
  private timer = 0;

  start(deadline: number): void {
    this.timer = window.setTimeout(() => this.settle(null), Math.max(0, deadline - Date.now()));
  }

  stop(): void {
    window.clearTimeout(this.timer);
  }

  load(name: string, callback: (error: Error | null) => void): void {
    this.queue.push({ name, callback });
  }

  private settle(error: Error | null): void {
    this.queue.forEach((pending) => {
      pending.callback(error);
    });
    this.queue.length = 0;
  }
}

const loader = new Loader();

/** The load callback joins the queue after the timer callback that drains it has escaped, so the walk must revisit the drain once the queue changes. */
export default function EscapedQueueCallbacks() {
  const [isLoaded, setIsLoaded] = useState(false);
  useEffect(() => {
    loader.start(0);
    return () => loader.stop();
  }, []);
  useEffect(() => {
    loader.load("translation", (error) => {
      if (!error) setIsLoaded(true);
    });
  }, []);
  return <section>{isLoaded ? <strong>loaded</strong> : <em>loading</em>}</section>;
}
