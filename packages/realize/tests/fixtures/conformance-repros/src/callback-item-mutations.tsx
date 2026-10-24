import { useState } from "react";

interface Task {
  isDone: boolean;
}

export const CompleteAllTasks = () => {
  const [tasks, setTasks] = useState<Task[]>([{ isDone: false }]);
  return (
    <button
      type="button"
      onClick={() => {
        tasks.forEach((task) => {
          task.isDone = true;
        });
        setTasks([...tasks]);
      }}
    >
      {tasks.filter((task) => task.isDone).length}
    </button>
  );
};

export const HighlightProps = ({ series }: { series: Array<{ isHidden: boolean }> }) => {
  series.forEach((entry) => {
    entry.isHidden = false;
  });
  return <p>{series.length}</p>;
};

export const CompleteCopiedTasks = () => {
  const [tasks, setTasks] = useState<Task[]>([{ isDone: false }]);
  return (
    <button
      type="button"
      onClick={() => {
        const next = tasks.map((task) => ({ ...task }));
        next.forEach((task) => {
          task.isDone = true;
        });
        setTasks(next);
      }}
    >
      {tasks.length}
    </button>
  );
};

export const SortedOptions = ({ options, query }: { options: string[]; query: string }) => {
  const visibleOptions = query ? options.filter((option) => option.includes(query)) : options;
  return <p>{visibleOptions.sort().join(", ")}</p>;
};
