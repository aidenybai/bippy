import { Component, type ReactNode } from "react";

export interface PanelProps {
  title: string;
  children?: ReactNode;
}

export abstract class BasePanel<P extends PanelProps, S> extends Component<P, S> {
  protected renderHeader(): ReactNode {
    return <header className="panel-header">{this.props.title}</header>;
  }
}
