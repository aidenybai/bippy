import { Outlet, useLoaderData, useLocation, useNavigation, useRevalidator } from "react-router";

interface ShellData {
  user: { name: string; plan: string };
  unreadCount: number;
}

export const Layout = () => {
  const data = useLoaderData() as ShellData;
  const navigation = useNavigation();
  const revalidator = useRevalidator();
  const location = useLocation();

  return (
    <div className={navigation.state === "idle" ? "shell" : "shell shell--busy"}>
      <header>
        <strong>{data.user.name}</strong>
        {data.user.plan === "pro" && <span className="badge">Pro</span>}
        {data.unreadCount > 0 ? <em>{data.unreadCount} unread</em> : null}
        <button type="button" onClick={() => revalidator.revalidate()}>
          {revalidator.state === "loading" ? "Refreshing…" : "Refresh"}
        </button>
      </header>
      <nav aria-label={location.pathname}>{location.search || "no query"}</nav>
      <main>
        <Outlet />
      </main>
    </div>
  );
};
