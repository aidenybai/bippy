import { Component, type ReactNode } from "react";
import { Link, withRouter, type RouteComponentProps } from "react-router-dom-v5";

interface AppProps extends RouteComponentProps {
  children: ReactNode;
}

class AppLayout extends Component<AppProps> {
  render() {
    const { location, children } = this.props;
    return (
      <main data-path={location.pathname}>
        <nav>
          <Link to="/">home</Link>
          <Link to="/login">login</Link>
        </nav>
        {children}
      </main>
    );
  }
}

export const App = withRouter(AppLayout);
