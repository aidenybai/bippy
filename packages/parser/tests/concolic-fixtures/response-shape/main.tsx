import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

interface User {
  isAdmin: boolean;
  name: string;
}

const Admin = () => <b>admin</b>;
const Member = () => <p>member</p>;

const App = () => {
  const [user, setUser] = useState<User | null>(null);
  useEffect(() => {
    void fetch("/api/user")
      .then((response) => response.json())
      .then((loaded: User) => setUser(loaded));
  }, []);
  if (user === null) return <span>loading</span>;
  return (
    <section>
      {user.isAdmin ? <Admin /> : <Member />}
      <h1>{user.isAdmin ? "Administrator" : "Member"}</h1>
      <small>{user.name}</small>
    </section>
  );
};

createRoot(document.getElementById("root") ?? document.body).render(<App />);
