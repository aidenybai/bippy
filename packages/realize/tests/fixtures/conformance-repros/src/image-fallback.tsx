import { useState } from "react";

export const Avatar = ({ username }: { username: string }) => {
  const [hasError, setHasError] = useState(false);
  if (hasError) return null;
  return (
    <img src={`https://example.com/${username}.png`} alt="" onError={() => setHasError(true)} />
  );
};
