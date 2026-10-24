import { useMemo } from "react";

const parseColor = (color: string): { hex: string } => {
  if (!color.startsWith("#")) throw new Error("not a color");
  return { hex: color };
};

export const ColorPreview = ({ color }: { color: string }) => {
  const preview = useMemo(() => {
    try {
      return { formats: parseColor(color) };
    } catch {
      return undefined;
    }
  }, [color]);
  if (!preview) return null;
  return <p>{preview.formats.hex}</p>;
};
