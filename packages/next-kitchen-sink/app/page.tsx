import { Inspector } from '../components/inspector';
import { TodoList } from '../components/todo-list';

export default function Home() {
  return (
    <div className="p-12 flex flex-col gap-4">
      <Inspector />
      <TodoList />
    </div>
  );
}
