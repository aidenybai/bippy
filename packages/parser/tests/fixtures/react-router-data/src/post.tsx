import { useParams } from "react-router";

export const Post = () => {
  const params = useParams();
  return (
    <article>
      <h1>Post {params.slug}</h1>
      <p>Body</p>
    </article>
  );
};
