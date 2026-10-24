import { useState } from "react";

interface Success {
  authorName: string;
}

export const PublishResult = ({ isReady }: { isReady: boolean }) => {
  const [success, setSuccess] = useState<Success | null>(null);
  const [step, setStep] = useState<"form" | "done">("form");
  const renderSuccess = () => <p>{success!.authorName}</p>;
  return (
    <div>
      <button onClick={() => isReady && setStep("done")}>{step}</button>
      <button onClick={() => setSuccess({ authorName: "Ada" })}>Publish</button>
      {success && renderSuccess()}
    </div>
  );
};
