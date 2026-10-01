const PLATFORMS = /Macintosh|Windows|Linux|iPhone|Android/;

const getPlatform = (userAgent: string): string => PLATFORMS.exec(userAgent)?.[0] ?? "unknown";

declare global {
  interface Navigator {
    userLanguage?: string;
  }
}

/** i18next-browser-languagedetector's `navigator` lookup: every `languages` entry, then the IE-only `userLanguage`, then `language`. */
const detectLanguages = (): string[] => {
  const found: string[] = [];
  if (typeof navigator === "undefined") return found;
  if (navigator.languages) {
    for (let index = 0; index < navigator.languages.length; index++) {
      found.push(navigator.languages[index]);
    }
  }
  if (navigator.userLanguage) found.push(navigator.userLanguage);
  if (navigator.language) found.push(navigator.language);
  return found;
};

export const App = () => {
  const platform = getPlatform(navigator.userAgent);
  const [language, region] = navigator.language.split("-");
  const isApple = platform === "Macintosh" || platform === "iPhone";
  const hasTouchScreen = "maxTouchPoints" in navigator && navigator.maxTouchPoints > 0;
  return (
    <main data-platform={platform} lang={language}>
      {isApple ? <kbd>⌘</kbd> : <kbd>Ctrl</kbd>}
      <p>{region ? `${language} (${region})` : language}</p>
      {hasTouchScreen ? <button>tap</button> : <button>click</button>}
      {typeof navigator !== "undefined" && navigator.language.startsWith("en") ? (
        <em>english</em>
      ) : (
        <strong>other</strong>
      )}
      <ol>
        {detectLanguages().map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ol>
    </main>
  );
};
