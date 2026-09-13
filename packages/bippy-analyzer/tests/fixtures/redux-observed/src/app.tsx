import { connect, useSelector } from "react-redux";
import type { RootState } from "./store";

const Sidebar = ({ opened }: { opened: boolean }) => (
  <nav className={opened ? "open" : "closed"}>menu</nav>
);

const Account = ({ user, label }: { user: RootState["auth"]["user"]; label: string }) =>
  user === null ? <em>{label}: guest</em> : <strong>{label}</strong>;

const ConnectedAccount = connect((state: RootState) => ({ user: state.auth.user }))(Account);

export const App = () => {
  const customization = useSelector((state: RootState) => state.customization);
  const isAuthenticated = useSelector((state: RootState) => state.auth.isAuthenticated);
  return (
    <main
      className={customization.isDarkMode ? "dark" : "light"}
      style={{ fontFamily: customization.fontFamily }}
    >
      {customization.opened ? <Sidebar opened={customization.opened} /> : null}
      {isAuthenticated ? <section>dashboard</section> : <form>sign in</form>}
      <ConnectedAccount label="account" />
    </main>
  );
};
