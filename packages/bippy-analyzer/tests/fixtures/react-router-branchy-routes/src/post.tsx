import { useParams } from "react-router";

export const Post = () => {
  const params = useParams();
  return (
    <article>
      <h1>Post {params.slug ?? params.id}</h1>
      <p>{params.slug ? "by slug" : "by id"}</p>
    </article>
  );
};
