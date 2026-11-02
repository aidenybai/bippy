import { useState } from "react";
import { getFileIcon } from "./icons/file-icon";

const getBadge = (count: number) => (count > 0 ? <b>{count}</b> : null);

export const FileRow = ({ path }: { path: string }) => {
  const [opened, setOpened] = useState(0);
  return (
    <button onClick={() => setOpened(opened + 1)}>
      {getFileIcon(path)} {path} {getBadge(opened)}
    </button>
  );
};
