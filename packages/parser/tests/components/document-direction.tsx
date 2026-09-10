import type { ReactNode } from "react";

interface IconButtonProps {
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  children?: ReactNode;
}

const ProfileIcon = () => <svg data-icon="profile" />;

const IconButton = ({ leftIcon, rightIcon, children }: IconButtonProps) => (
  <button>
    {leftIcon && <span className="left">{leftIcon}</span>}
    {children}
    {rightIcon && <span className="right">{rightIcon}</span>}
  </button>
);

const NavbarLinks = () => (
  <nav>
    <IconButton
      rightIcon={document.documentElement.dir ? "" : <ProfileIcon />}
      leftIcon={document.documentElement.dir ? <ProfileIcon /> : ""}
    >
      Sign In
    </IconButton>
    <p>{document.documentElement.dir === "rtl" ? "right-to-left" : "left-to-right"}</p>
  </nav>
);

const Layout = ({ children }: { children: ReactNode }) => {
  document.documentElement.dir = "ltr";
  return <main>{children}</main>;
};

export const isExact = true;

export default function DocumentDirection() {
  return (
    <Layout>
      <NavbarLinks />
    </Layout>
  );
}
