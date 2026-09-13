import { Suspense, use } from "react";

interface User {
  name: string;
  posts: string[];
}

const userPromise: Promise<User> = Promise.resolve({ name: "Ada", posts: ["first", "second"] });

const cache = new Map<string, Promise<string>>();
const fetchGreeting = (name: string): Promise<string> => {
  let promise = cache.get(name);
  if (!promise) {
    promise = new Promise((resolve) => setTimeout(() => resolve(`hi ${name}`), 0));
    cache.set(name, promise);
  }
  return promise;
};

const Profile = () => {
  const user = use(userPromise);
  return (
    <article>
      <h2>{user.name}</h2>
      <ul>
        {user.posts.map((post) => (
          <li key={post}>{post}</li>
        ))}
      </ul>
    </article>
  );
};

const Greeting = ({ name }: { name: string }) => {
  const greeting = use(fetchGreeting(name));
  return <p>{greeting}</p>;
};

export default function SuspendingData() {
  return (
    <div>
      <Suspense fallback={<p>loading profile…</p>}>
        <Profile />
      </Suspense>
      <Suspense fallback={<span>…</span>}>
        <Greeting name="Grace" />
        <Greeting name="Linus" />
      </Suspense>
    </div>
  );
}
