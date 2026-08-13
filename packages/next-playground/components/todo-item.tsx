interface Todo {
  id: number;
  title: string;
}

interface TodoItemProps {
  todo: Todo;
}

export const TodoItem = ({ todo }: TodoItemProps) => {
  return (
    <li>
      <span>{todo.title}</span>
    </li>
  );
};
