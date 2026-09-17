import swr from "swr";

const useSWR = swr.default || swr;

interface Author {
  name: string;
  verified: boolean;
}

interface Post {
  id: string;
  text: string;
  author: Author;
  tags: string[];
}

const host = "https://example.test";

const fetchPost = async ([url]: [string, RequestInit | undefined]): Promise<Post> => ({
  id: url.slice(url.lastIndexOf("/") + 1),
  text: "hello from swr",
  author: { name: "ada", verified: true },
  tags: ["static", "runtime"],
});

const usePost = (id: string, fetchOptions?: RequestInit) =>
  useSWR(() => (id ? [`${host}/api/post/${id}`, fetchOptions] : null), fetchPost, {
    revalidateIfStale: false,
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  });

const PostCard = ({ id }: { id: string }) => {
  const { data, error, isLoading } = usePost(id);
  if (isLoading || (data === undefined && !error)) return <p className="skeleton">loading</p>;
  if (error) return <p className="error">failed</p>;
  if (!data) return <p className="missing">not found</p>;
  return (
    <article>
      <h2>{data.author.name}</h2>
      {data.author.verified ? <span className="badge">verified</span> : null}
      <p>{data.text}</p>
      <ul>
        {data.tags.map((tag) => (
          <li key={tag}>{tag}</li>
        ))}
      </ul>
    </article>
  );
};

const Disabled = () => {
  const { data, isLoading } = usePost("");
  return <p className="disabled">{isLoading ? "loading" : data === undefined ? "idle" : "data"}</p>;
};

export const App = () => (
  <main>
    <PostCard id="1" />
    <Disabled />
  </main>
);
