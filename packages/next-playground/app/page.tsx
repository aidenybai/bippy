import { Inspector } from "../components/inspector";
import { TodoList } from "../components/todo-list";

const Home = () => {
  return (
    <div className="p-12 flex flex-col gap-4">
      <Inspector />
      <TodoList />
    </div>
  );
};

export default Home;
