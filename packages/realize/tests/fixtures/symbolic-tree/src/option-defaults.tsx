import invariant from "invariant";

interface User {
  name: string;
}

interface Auth {
  user: User | undefined;
}

declare const useAuth: () => Auth;

function useCurrentUser(options: { required: false }): User | undefined;
function useCurrentUser(options?: { required: true }): User;
function useCurrentUser({ required = true }: { required?: boolean } = {}) {
  const auth = useAuth();
  if (required) invariant(auth.user, "user required");
  return auth.user;
}

export const Greeting = () => {
  const user = useCurrentUser({ required: false });
  return <div>{user ? <p>{user.name}</p> : <p>Signed out</p>}</div>;
};

export const ListSummary = ({ items }: { items: string[] }) => {
  const list = [...items];
  // oxlint-disable-next-line eqeqeq -- Tests that loose inequality with null is decided.
  const isPresent = list != null;
  return <p>{list === undefined ? "none" : isPresent ? "some" : "never"}</p>;
};
