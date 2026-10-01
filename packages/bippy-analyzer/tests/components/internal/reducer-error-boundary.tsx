import { Component, type ReactNode } from "react";

interface BoundaryProps {
  children: ReactNode;
}

interface BoundaryState {
  message: string | null;
}

export class Boundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { message: null };
  static getDerivedStateFromError = (error: Error): BoundaryState => ({ message: error.message });
  render = () =>
    this.state.message === null ? (
      this.props.children
    ) : (
      <main>
        <span>Boundary:</span>
        {this.state.message}
      </main>
    );
}
