import { TodoItem } from './todo-item';

export function TodoList() {
  const todos = [
    { id: 1, title: 'Buy groceries' },
    { id: 2, title: 'Buy groceries' },
    { id: 3, title: 'Buy groceries' },
    { id: 4, title: 'Buy groceries' },
    { id: 5, title: 'Buy groceries' },
    { id: 6, title: 'Buy groceries' },
    { id: 7, title: 'Buy groceries' },
    { id: 8, title: 'Buy groceries' },
    { id: 9, title: 'Buy groceries' },
    { id: 10, title: 'Buy groceries' },
  ];
  return (
    <div>
      <h1>Todo List</h1>
      <ul className="list-disc list-inside">
        {todos.map((todo) => (
          <TodoItem key={todo.id} todo={todo} />
        ))}
      </ul>
    </div>
  );
}
