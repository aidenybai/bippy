import { useState } from "react";

export const Toaster = () => {
  const [toasts] = useState<string[]>([]);
  return <output>{toasts.length}</output>;
};

export const Sonner = () => <aside role="status" />;
