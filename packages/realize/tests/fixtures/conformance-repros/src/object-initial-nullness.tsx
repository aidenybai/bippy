import { useState } from "react";

export const NeverNullUser = () => {
  const [user] = useState<{ name: string } | null>({ name: "a" });
  return (
    <p>
      {user!.name}
      {user === null ? "x" : "y"}
    </p>
  );
};

export const RenamedUser = () => {
  const [user, setUser] = useState<{ name: string } | undefined>({ name: "a" });
  return (
    <p>
      <button onClick={() => setUser({ name: "b" })}>rename</button>
      {user!.name}
      {user === undefined ? "x" : "y"}
    </p>
  );
};

export const ClearedUser = () => {
  const [user, setUser] = useState<{ name: string } | null>({ name: "a" });
  return (
    <p>
      <button onClick={() => setUser(null)}>clear</button>
      {user === null ? "x" : "y"}
    </p>
  );
};
