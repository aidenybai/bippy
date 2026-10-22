import { useState } from "react";

interface Task {
  id: number;
  done: boolean;
}

const useTasks = () =>
  useState<Task[]>([
    { id: 1, done: true },
    { id: 2, done: false },
  ]);

export const AllDone = () => {
  const [tasks, setTasks] = useTasks();
  return (
    <div>
      <button onClick={() => setTasks([])}>clear</button>
      {tasks.every((task) => task.done) ? <i>all</i> : <i>some left</i>}
    </div>
  );
};

export const AnyDone = () => {
  const [tasks, setTasks] = useTasks();
  return (
    <div>
      <button onClick={() => setTasks([])}>clear</button>
      {tasks.some((task) => task.done) ? <i>progress</i> : <i>none</i>}
    </div>
  );
};

export const SecondTask = () => {
  const [tasks, setTasks] = useTasks();
  return (
    <div>
      <button onClick={() => setTasks([])}>clear</button>
      {tasks.find((task) => task.id === 2) === undefined ? <i>missing</i> : <i>found</i>}
    </div>
  );
};

export const DoneCount = () => {
  const [tasks, setTasks] = useTasks();
  return (
    <div>
      <button onClick={() => setTasks([])}>clear</button>
      {tasks.filter((task) => task.done).length === 1 ? <i>one</i> : <i>other</i>}
    </div>
  );
};
