import { useState } from "react";

interface Todo {
  id: number;
  text: string;
  isDone: boolean;
}

type Filter = "all" | "active" | "done";

export const TodoApp = () => {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [draft, setDraft] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [isEditing, setIsEditing] = useState(false);

  const visibleTodos = todos.filter((todo) =>
    filter === "all" ? true : filter === "done" ? todo.isDone : !todo.isDone,
  );

  const addTodo = () => {
    if (!draft.trim()) return;
    setTodos([...todos, { id: Date.now(), text: draft, isDone: false }]);
    setDraft("");
  };

  return (
    <section>
      <input value={draft} onChange={(event) => setDraft(event.target.value)} />
      <button onClick={addTodo} disabled={draft === ""}>
        Add
      </button>
      {todos.length === 0 && <p>Nothing to do</p>}
      <ul>
        {visibleTodos.map((todo) => (
          <li
            key={todo.id}
            onClick={() =>
              setTodos(
                todos.map((other) =>
                  other.id === todo.id ? { ...other, isDone: !other.isDone } : other,
                ),
              )
            }
          >
            {todo.isDone ? <s>{todo.text}</s> : todo.text}
          </li>
        ))}
      </ul>
      <footer>
        <button onClick={() => setFilter("all")}>All</button>
        <button onClick={() => setFilter("active")}>Active</button>
        <button onClick={() => setFilter("done")}>Done</button>
      </footer>
      {isEditing ? (
        <button onClick={() => setIsEditing(false)}>Save</button>
      ) : (
        <button onClick={() => setIsEditing(true)}>Edit</button>
      )}
    </section>
  );
};
