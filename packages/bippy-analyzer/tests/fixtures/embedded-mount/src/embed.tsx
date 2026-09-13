import { createRoot } from "react-dom/client";
import { Dashboard } from "./dashboard";

export interface EmbedProps {
  title: string;
  metrics?: number[];
}

const hasMetrics = (props: EmbedProps): boolean => "metrics" in props;

export const embedDashboard = (container: HTMLElement, props: EmbedProps): void => {
  const root = createRoot(container);
  root.render(
    hasMetrics(props) ? <Dashboard {...props} /> : <Dashboard title={props.title} metrics={[]} />,
  );
};
