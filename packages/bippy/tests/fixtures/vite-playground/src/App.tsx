import { TodoList } from "@bippy/next-playground/components/todo-list";

import { SourceEditor } from "./source-editor";

export default function App() {
  return (
    <div className="p-12 flex flex-col gap-4">
      <SourceEditor />
      <TodoList />
    </div>
  );
}
