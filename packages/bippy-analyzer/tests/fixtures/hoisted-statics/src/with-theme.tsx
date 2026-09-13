import hoistNonReactStatics from "hoist-non-react-statics";
import type { ComponentType } from "react";

export interface ThemeProps {
  theme: string;
}

export const withTheme = <Props extends object>(
  Wrapped: ComponentType<Props & ThemeProps>,
): ComponentType<Props> => {
  const WithTheme = (props: Props) => (
    <section data-theme="dark">
      <Wrapped {...props} theme="dark" />
    </section>
  );
  return hoistNonReactStatics(WithTheme, Wrapped, { getBadge: true });
};
