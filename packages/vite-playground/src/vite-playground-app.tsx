import { TodoList } from "@bippy/next-playground/components/todo-list";

import { SourceEditor } from "./source-editor";

const VitePlaygroundApp = () => {
  return (
    <div className="p-12 flex flex-col gap-4">
      <SourceEditor />
      <TodoList />
    </div>
  );
};

export default VitePlaygroundApp;
