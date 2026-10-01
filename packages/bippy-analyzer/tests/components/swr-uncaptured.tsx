import useSWR from "swr";

interface Profile {
  name: string;
}

const fetchProfile = async (url: string): Promise<Profile> => ({ name: url.slice(1) });

const Profile = ({ url }: { url: string | null }) => {
  const { data, error, isLoading } = useSWR(url, fetchProfile, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  });
  if (isLoading) return <p className="loading">loading</p>;
  if (error) return <p className="error">failed</p>;
  if (!data) return <p className="idle">idle</p>;
  return <p className="ready">{data.name}</p>;
};

const Paused = () => {
  const { data, isValidating } = useSWR("/paused", fetchProfile, {
    isPaused: () => true,
    fallbackData: { name: "cached" },
  });
  return (
    <p className="paused" data-validating={isValidating}>
      {data?.name}
    </p>
  );
};

export const isPartial = true;

export default function SwrUncaptured() {
  return (
    <section>
      <Profile url="/ada" />
      <Profile url={null} />
      <Paused />
    </section>
  );
}
