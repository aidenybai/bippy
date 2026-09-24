import { useStatus } from "status-kit";

export const App = () => {
  const { data, error, isLoading } = useStatus({ name: "bulbasaur" });
  return (
    <div className="app">
      {error ? <p>error</p> : isLoading ? <p>loading</p> : data ? <h3>{data.name}</h3> : null}
    </div>
  );
};
