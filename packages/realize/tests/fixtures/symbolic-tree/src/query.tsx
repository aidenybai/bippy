import { useQuery } from "@tanstack/react-query";

interface Profile {
  name: string;
  isAdmin: boolean;
}

const fetchProfile = async (): Promise<Profile> => ({ name: "Ada", isAdmin: true });

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

export const ProfileStatus = () => {
  const { isPending, isError, data } = useQuery({ queryKey: ["profile"], queryFn: fetchProfile });
  return (
    <div>
      {isPending && <p>Loading</p>}
      {isError && <p>Error</p>}
      {data && <p>{data.name}</p>}
    </div>
  );
};
