import { useOutletContext, useParams } from "react-router";

export const Editor = () => {
  const { name } = useParams();
  const context = useOutletContext<{ theme: string } | undefined>();
  return (
    <section>
      {name} ({context?.theme ?? "light"})
    </section>
  );
};
