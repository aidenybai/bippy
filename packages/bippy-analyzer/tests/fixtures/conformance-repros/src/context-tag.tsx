import { createContext, useContext, useState } from "react";
import type { ReactNode } from "react";

const FontContext = createContext<string>("inter");

export const FontProvider = ({ children }: { children: ReactNode }) => {
  const [font] = useState("inter");
  return <FontContext value={font}>{children}</FontContext>;
};

// oxlint-disable-next-line typescript/no-explicit-any -- an untyped context, as in plain JavaScript.
export const UserContext = createContext<any>(null);

export const UserName = () => {
  const user = useContext(UserContext);
  return <p>{user.profile.name}</p>;
};

const Button = ({ children }: { children: React.ReactNode }) => <button>{children}</button>;

export const ConfirmButton = ({ buttonComponent }: { buttonComponent?: React.ElementType }) => {
  const ButtonComponent = buttonComponent || Button;
  return <ButtonComponent>Confirm</ButtonComponent>;
};
