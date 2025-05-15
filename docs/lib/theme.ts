import { createTheme } from 'fumadocs-ui/theme';

export const theme = createTheme({
  dark: true,
  accentColor: {
    dark: 'rgb(16, 16, 20)',
  },
  variables: {
    dark: {
      background: 'rgb(16, 16, 20)',
      foreground: 'white',
      sidebar: {
        background: 'rgb(18, 18, 22)',
      },
    },
  },
});
