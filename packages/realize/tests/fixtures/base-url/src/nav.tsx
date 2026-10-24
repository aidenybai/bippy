import { NavItem } from "types";
import { DISABLED_LABEL } from "@/labels";

export const Nav = ({ items }: { items: NavItem[] }) => (
  <ul>
    {items.map((item) => (
      <li key={item.title}>{item.isDisabled ? DISABLED_LABEL : item.title}</li>
    ))}
  </ul>
);
