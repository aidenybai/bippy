import { Component, Fragment, createElement } from "react";
import type { ReactNode } from "react";

interface DocumentChildrenProps {
  children?: ReactNode;
}

export const Html = (props: DocumentChildrenProps) => createElement(Fragment, null, props.children);
export const Head = (props: DocumentChildrenProps) => createElement(Fragment, null, props.children);
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
