import { useSelector } from "react-redux";
import type { RootState } from "./store";

export const App = () => {
  const theme = useSelector((state: RootState) => state.theme);
  const user = useSelector((state: RootState) => state.auth.user);
  const isRehydrated = useSelector((state: RootState) => state._persist.rehydrated);
  return (
    <main className={theme.isCompact ? `${theme.mode} compact` : theme.mode}>
      {isRehydrated ? <p>restored</p> : <p>restoring</p>}
      {user === null ? <button type="button">sign in</button> : <strong>{user}</strong>}
    </main>
  );
};
