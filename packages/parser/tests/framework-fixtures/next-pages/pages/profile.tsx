import type { GetServerSideProps } from "next";

interface ProfileProps {
  name: string;
  isAdmin: boolean;
}

export const getServerSideProps: GetServerSideProps<ProfileProps> = async () => ({
  props: { name: "loaded on the server", isAdmin: false },
});

export default function Profile({ name, isAdmin }: ProfileProps) {
  return (
    <section>
      <h1>{name}</h1>
      {isAdmin ? <button type="button">Manage</button> : <p>member</p>}
    </section>
  );
}
