import { useSelector } from "react-redux";
import { composedGreeting, identityGreeting, type RootState } from "./store";

export const App = () => {
  const items = useSelector((state: RootState) => state.cart.items);
  const user = useSelector((state: RootState) => state.auth.user);
  const isRehydrated = useSelector((state: RootState) => state._persist?.rehydrated ?? false);
  return (
    <main>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      {user === null ? <em>guest</em> : <strong>{user}</strong>}
      {isRehydrated ? <p>rehydrated</p> : <p>booting</p>}
      <footer>
        <span>{composedGreeting}</span>
        <span>{identityGreeting}</span>
      </footer>
    </main>
  );
};
