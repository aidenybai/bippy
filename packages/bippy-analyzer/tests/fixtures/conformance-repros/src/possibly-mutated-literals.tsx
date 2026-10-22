import { useState } from "react";

declare const configure: (options: { label?: string }) => void;

export const ConfiguredLabel = () => {
  const [isShown, setIsShown] = useState(false);
  const options: { label?: string } = {};
  configure(options);
  return (
    <div>
      <button onClick={() => setIsShown(!isShown)}>toggle</button>
      {options.label ? <i>labeled</i> : <i>plain</i>}
    </div>
  );
};

export const PropMutation = ({ fill }: { fill: (items: string[]) => void }) => {
  const items: string[] = [];
  fill(items);
  return <ul>{items.length > 0 ? <li>filled</li> : <li>empty</li>}</ul>;
};

export const ReadOnlyMethod = () => {
  const items = ["a", "b"];
  const hasA = items.includes("a");
  return <div>{items.length === 2 && hasA ? <i>two</i> : <i>Z1</i>}</div>;
};

const useSaver = () => {
  const [isSaved, setIsSaved] = useState(false);
  const saveWith = (options: { quiet: boolean }) => setIsSaved(options.quiet);
  const reset = (options: { quiet: boolean }) => setIsSaved(!options.quiet);
  return { isSaved, saveWith, reset };
};

export const HookResultMethod = () => {
  const saver = useSaver();
  return (
    <div>
      <button onClick={() => saver.reset({ quiet: true })}>reset</button>
      <button onClick={() => saver.saveWith({ quiet: true })}>save</button>
      {saver.isSaved ? <i>saved</i> : <i>unsaved</i>}
    </div>
  );
};

export const ReflectSetInCallback = () => {
  const options: { label?: string } = {};
  [options].forEach((item) => Reflect.set(item, "label", "x"));
  return <div>{options.label ? <i>labeled</i> : <i>plain</i>}</div>;
};

export const AssignedInCallback = () => {
  const options: { label?: string } = {};
  [options].forEach((item) => {
    item.label = "x";
  });
  return <div>{options.label ? <i>labeled</i> : <i>plain</i>}</div>;
};
