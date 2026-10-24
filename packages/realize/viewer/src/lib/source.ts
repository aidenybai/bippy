export const getFileTitle = (file: string): string => file.split("/").at(-1) ?? file;
