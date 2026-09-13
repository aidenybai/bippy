import type { RouteComponentProps } from "react-router-dom-v5";

const Dashboard = ({ location }: RouteComponentProps) => <h1>dashboard at {location.pathname}</h1>;

export default Dashboard;
