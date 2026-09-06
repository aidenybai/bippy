import type { ReactNode } from "react";

export const CardHeader = ({ children }: { children: ReactNode }) => <header className="card-header">{children}</header>;

export const CardBody = ({ children }: { children: ReactNode }) => <div className="card-body">{children}</div>;

export const Card = ({ children }: { children: ReactNode }) => <section className="card">{children}</section>;

Card.Header = CardHeader;
Card.Body = CardBody;
