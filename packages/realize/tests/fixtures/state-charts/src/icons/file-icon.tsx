export const getFileIcon = (path: string) => {
  if (path.endsWith(".ts")) return <span className="ts">TS</span>;
  return <span className="file">File</span>;
};
