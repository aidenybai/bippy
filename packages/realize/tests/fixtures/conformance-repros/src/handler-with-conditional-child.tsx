import { useState } from "react";

export const SubmitButton = () => {
  const [isLoading, setIsLoading] = useState(false);
  const submit = () => {
    setIsLoading(true);
    Promise.resolve().then(() => setIsLoading(false));
  };
  return (
    <button type="submit" onClick={submit}>
      Sign In {isLoading && <span>Loading</span>}
    </button>
  );
};
