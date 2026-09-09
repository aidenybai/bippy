const PLATFORMS = /Macintosh|Windows|Linux|iPhone|Android/;

const getPlatform = (userAgent: string): string => PLATFORMS.exec(userAgent)?.[0] ?? "unknown";

/** i18next-browser-languagedetector's `navigator` lookup: every preferred language, IE's `userLanguage` included. */
const detectLanguages = (): string[] => {
  const found: string[] = [];
  if (navigator.languages) {
    for (let index = 0; index < navigator.languages.length; index++) {
      found.push(navigator.languages[index]);
    }
  }
  const legacy: { userLanguage?: string } = navigator;
  if (legacy.userLanguage) found.push(legacy.userLanguage);
  if (navigator.language) found.push(navigator.language);
  return found;
};

export const App = () => {
  const platform = getPlatform(navigator.userAgent);
  const [language, region] = navigator.language.split("-");
  const isApple = platform === "Macintosh" || platform === "iPhone";
  const hasTouchScreen = "maxTouchPoints" in navigator && navigator.maxTouchPoints > 0;
  const detected = detectLanguages();
  return (
    <main data-platform={platform} lang={language}>
      <ul>
        {detected.map((code, index) => (
          <li key={index}>{code}</li>
        ))}
      </ul>
      {isApple ? <kbd>⌘</kbd> : <kbd>Ctrl</kbd>}
      <p>{region ? `${language} (${region})` : language}</p>
      {hasTouchScreen ? <button>tap</button> : <button>click</button>}
      {typeof navigator !== "undefined" && navigator.language.startsWith("en") ? (
        <em>english</em>
      ) : (
        <strong>other</strong>
      )}
    </main>
  );
};
