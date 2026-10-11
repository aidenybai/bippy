// @ts-nocheck
import { user, useUser } from "./use-user";

export const Profile = () => {
  const current = useUser();
  return current.isAdmin ? <p>Admin</p> : <p>Member</p>;
};

export const Greeting = () => {
  const role = user();
  return role === "guest" ? <p>Sign in</p> : <p>Welcome</p>;
};
