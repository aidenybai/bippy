interface FolderNode {
  name: string;
  parent?: FolderNode;
}

const getFolderPath = (folder: FolderNode): string => {
  const names: string[] = [];
  for (let current: FolderNode | undefined = folder; current; current = current.parent)
    names.unshift(current.name);
  return names.join("/");
};

export const FolderPath = ({ folder }: { folder: FolderNode }) => <p>{getFolderPath(folder)}</p>;
