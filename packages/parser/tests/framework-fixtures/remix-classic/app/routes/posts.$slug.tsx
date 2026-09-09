import { useActionData, useParams } from "@remix-run/react";

export default function () {
  const { slug } = useParams();
  const actionData = useActionData();
  return (
    <article>
      <h1>{slug}</h1>
      {actionData ? <p>saved</p> : null}
    </article>
  );
}
