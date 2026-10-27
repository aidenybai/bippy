import { startTransition, useOptimistic, useState } from "react";

export const PendingOptimistic = () => {
  const [isSaved] = useState(false);
  const [isShown, setIsShown] = useOptimistic(isSaved);
  return (
    <div>
      {isShown ? <i>shown</i> : <i>hidden</i>}
      <button
        onClick={() =>
          startTransition(async () => {
            setIsShown(true);
            await Promise.resolve();
          })
        }
      >
        show
      </button>
    </div>
  );
};

export const PassthroughOptimistic = () => {
  const [isSaved, setIsSaved] = useState(false);
  const [isShown] = useOptimistic(isSaved);
  return (
    <div>
      {isShown ? <i>shown</i> : <i>hidden</i>}
      <button onClick={() => setIsSaved(!isSaved)}>flip</button>
    </div>
  );
};
