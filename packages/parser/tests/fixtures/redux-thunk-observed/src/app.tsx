import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { type AppDispatch, legacyStore, type RootState } from "./store";
import { checkServer, describeDispatcher } from "./thunks";

export const App = () => {
  const dispatch = useDispatch<AppDispatch>();
  const isChecked = useSelector((state: RootState) => state.server.isChecked);
  const [summary, setSummary] = useState("checking");
  useEffect(() => {
    dispatch(checkServer()).then(setSummary);
  }, [dispatch]);
  return (
    <main>
      <p>
        {summary}
        <span />
      </p>
      <p>
        {legacyStore.dispatch(describeDispatcher())}
        <span />
      </p>
      {isChecked ? <strong>checked</strong> : <em>unchecked</em>}
    </main>
  );
};
