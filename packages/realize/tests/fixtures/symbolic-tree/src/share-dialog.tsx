import { useState } from "react";

type DialogState = { isOpen: false } | { isOpen: true; type: "share" | "invite" };

export const ShareButton = () => {
  const [dialog, setDialog] = useState<DialogState>({ isOpen: false });
  if (!dialog.isOpen) {
    return (
      <button type="button" onClick={() => setDialog({ isOpen: true, type: "share" })}>
        Share
      </button>
    );
  }
  return <p>{dialog.type}</p>;
};
