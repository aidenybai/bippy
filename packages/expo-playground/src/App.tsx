import { Inspector } from '@bippy/next-playground/components/inspector';
import { TodoList } from '@bippy/next-playground/components/todo-list';

const App = () => {
  return (
    <div className="p-12 flex flex-col gap-4">
      <Inspector />
      <TodoList />
    </div>
  );
};

export default App;
