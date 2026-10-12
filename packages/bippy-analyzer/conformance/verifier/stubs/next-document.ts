import { Component, Fragment, createElement } from "react";
import type { ReactNode } from "react";

// HACK: the real next/document pulls Next's server into the browser bundle.
interface DocumentChildrenProps {
  children?: ReactNode;
}

export const Html = ({ children }: DocumentChildrenProps) =>
  createElement(Fragment, null, children);
export const Head = ({ children }: DocumentChildrenProps) =>
  createElement(Fragment, null, children);
export const Main = () => null;
export const NextScript = () => null;

export default class Document extends Component {
  static getInitialProps = async () => ({ html: "" });

  render() {
    return createElement(
      Html,
      null,
      createElement(Head),
      createElement(Main),
      createElement(NextScript),
    );
  }
}
