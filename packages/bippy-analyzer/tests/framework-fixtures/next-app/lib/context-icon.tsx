import * as React from "react";

interface IconConfig {
  size?: string;
}

const DEFAULT_CONFIG: IconConfig = {};

const IconContext =
  React.createContext !== undefined ? React.createContext(DEFAULT_CONFIG) : undefined;

export const ContextIcon = ({ size }: { size?: string }) => {
  const renderSvg = (config: IconConfig) => (
    <svg width={size ?? config.size ?? "1em"}>
      <path d="M1 1" />
    </svg>
  );
  return IconContext !== undefined ? (
    <IconContext.Consumer>{(config) => renderSvg(config)}</IconContext.Consumer>
  ) : (
    renderSvg(DEFAULT_CONFIG)
  );
};
