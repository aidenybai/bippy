import { useQuery } from "@tanstack/react-query";
import { Todo } from "./todo";

interface TodoItem {
  id: number;
  title: string;
}

interface TodoPage {
  items: TodoItem[];
  nextPage: number | null;
}

const fetchTodos = async (): Promise<TodoPage> => ({
  items: [
    { id: 1, title: "write parser" },
    { id: 2, title: "capture query cache" },
  ],
  nextPage: null,
});

export const App = () => {
  const { data, error, isPending, isFetching } = useQuery({
    queryKey: ["todos", { status: "open", page: 1 }],
    queryFn: fetchTodos,
  });
  if (isPending) return <p className="loading">loading</p>;
  if (error) return <p className="error">{error.message}</p>;
  return (
    <section>
      {isFetching ? <span>refreshing</span> : null}
      <ul>
        {data.items.map((item) => (
          <Todo key={item.id} title={item.title} />
        ))}
      </ul>
      {data.nextPage === null ? <footer>end</footer> : <button type="button">more</button>}
    </section>
  );
};
