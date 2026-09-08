const PLATFORMS = /Macintosh|Windows|Linux|iPhone|Android/;

const getPlatform = (userAgent: string): string => PLATFORMS.exec(userAgent)?.[0] ?? "unknown";

export const App = () => {
  const platform = getPlatform(navigator.userAgent);
  const [language, region] = navigator.language.split("-");
  const isApple = platform === "Macintosh" || platform === "iPhone";
  return (
    <main data-platform={platform} lang={language}>
      {isApple ? <kbd>⌘</kbd> : <kbd>Ctrl</kbd>}
      <p>{region ? `${language} (${region})` : language}</p>
      {typeof navigator !== "undefined" && navigator.language.startsWith("en") ? (
        <em>english</em>
      ) : (
        <strong>other</strong>
      )}
    </main>
  );
};
