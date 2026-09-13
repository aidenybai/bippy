import { useId } from "react";
import useSWR, { SWRConfig } from "swr";

interface Profile {
  name: string;
}

const fetchProfile = async (url: string): Promise<Profile> => ({ name: url.slice(1) });

const Inherited = () => {
  const { data, isLoading } = useSWR<Profile>("/inherited", null, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  });
  if (isLoading) return <p className="loading">loading</p>;
  return <p className="inherited">{data ? data.name : "idle"}</p>;
};

const Fallback = () => {
  const { data } = useSWR<Profile>("/fallback", null, { revalidateOnMount: false });
  return <p className="fallback">{data?.name}</p>;
};

const Keyed = () => {
  const id = useId();
  const { data, isValidating } = useSWR<Profile>(["/keyed", id], null);
  return (
    <p className="keyed" data-validating={isValidating}>
      {data ? data.name : "idle"}
    </p>
  );
};

export const isPartial = true;

export default function SwrConfigFixture() {
  return (
    <section>
      <Keyed />
      <SWRConfig value={{ fallback: { "/fallback": { name: "provided" } } }}>
        <Fallback />
        <SWRConfig value={{ fetcher: fetchProfile }}>
          <Inherited />
        </SWRConfig>
      </SWRConfig>
    </section>
  );
}
