import type { RouteComponentProps } from "react-router-dom-v5";

export const HomePage = ({ match }: RouteComponentProps) => <h1>home {match.url}</h1>;
