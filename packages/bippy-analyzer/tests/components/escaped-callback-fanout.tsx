import { useEffect, useState } from "react";

type Task = () => void;

/** Mutually recursive helpers: the walk must follow `task()` and still terminate on the cycle. */
const ping = (task: Task, depth: number): void => {
  if (depth > 0) pong(task, depth - 1);
  else task();
};

const pong = (task: Task, depth: number): void => {
  ping(task, depth);
};

const invoke = (task: Task): void => task();

interface DeadlineProps {
  deadline: number;
  onFirst: Task;
  onSecond: Task;
  onThird: Task;
}

/** The same helpers are invoked with different callbacks from one escaped timer callback; each must be followed. */
const Deadline = ({ deadline, onFirst, onSecond, onThird }: DeadlineProps) => {
  useEffect(() => {
    const timer = window.setTimeout(
      () => {
        ping(onFirst, 2);
        invoke(onSecond);
        invoke(onThird);
      },
      Math.max(0, deadline - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [deadline, onFirst, onSecond, onThird]);
  return <time dateTime="0" />;
};

export default function EscapedCallbackFanout() {
  const [isFirst, setIsFirst] = useState(false);
  const [isSecond, setIsSecond] = useState(false);
  const [isThird, setIsThird] = useState(false);
  return (
    <section>
      <Deadline
        deadline={0}
        onFirst={() => setIsFirst(true)}
        onSecond={() => setIsSecond(true)}
        onThird={() => setIsThird(true)}
      />
      {isFirst ? <strong>first</strong> : <em>waiting</em>}
      {isSecond ? <strong>second</strong> : <em>waiting</em>}
      {isThird ? <strong>third</strong> : <em>waiting</em>}
    </section>
  );
}
