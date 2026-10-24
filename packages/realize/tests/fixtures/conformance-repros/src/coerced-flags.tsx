import { useState } from "react";

export const PublishButton = ({ draftTitle }: { draftTitle?: string }) => {
  const [isPublishing, setIsPublishing] = useState(false);
  return (
    <div>
      <button onClick={() => setIsPublishing(!!draftTitle)}>Publish</button>
      <span>{isPublishing ? "publishing" : "idle"}</span>
      <output>{!!draftTitle}</output>
    </div>
  );
};
