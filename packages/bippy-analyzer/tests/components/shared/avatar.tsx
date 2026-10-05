interface AvatarProps {
  name: string;
  size?: "small" | "large";
}

const initialsOf = (name: string): string => name.slice(0, 2).toUpperCase();

export const Avatar = ({ name, size = "small" }: AvatarProps) => (
  <figure className={`avatar avatar-${size}`}>
    <span>{initialsOf(name)}</span>
    {size === "large" && <figcaption>{name}</figcaption>}
  </figure>
);
