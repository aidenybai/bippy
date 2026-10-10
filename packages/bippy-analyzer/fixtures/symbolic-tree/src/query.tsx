import { useQuery } from "@tanstack/react-query";

interface Profile {
  name: string;
  isAdmin: boolean;
}

declare const fetchProfile: () => Promise<Profile>;

export const ProfileCard = () => {
  const query = useQuery({ queryKey: ["profile"], queryFn: fetchProfile });
  if (query.isPending) return <p>Loading</p>;
  if (query.isError) return <p>Error: {query.error.message}</p>;
  return (
    <div>
      {query.data.name}
      {query.data.isAdmin && <span>Admin</span>}
    </div>
  );
};
