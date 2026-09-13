import styled from "@emotion/styled";
import Link from "next/link";

const NavLink = styled(Link)`
  color: inherit;
`;

export default function LinkName() {
  return (
    <nav>
      <NavLink href="/">home</NavLink>
      <em>
        {String(Link.displayName)} {String("displayName" in Link)} {String(Link.name)}
      </em>
    </nav>
  );
}
