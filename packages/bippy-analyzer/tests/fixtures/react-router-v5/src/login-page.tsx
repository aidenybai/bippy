import { useLocation, useRouteMatch } from "react-router-dom-v5";

export const LoginPage = ({ mode }: { mode: string }) => {
  const location = useLocation();
  const match = useRouteMatch();
  return (
    <form>
      <h1>
        {mode} at {location.pathname} ({match.path})
      </h1>
      <input name="email" />
    </form>
  );
};
