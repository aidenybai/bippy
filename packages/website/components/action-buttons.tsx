import { useEffect, useState } from "react";

const GITHUB_URL = "https://github.com/aidenybai/bippy";
const DEFAULT_STAR_COUNT = "3.5k";

const formatStarCount = (count: number) => {
  if (count >= 1000) return `${(count / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(count);
};

export const ActionButtons = () => {
  const [starCount, setStarCount] = useState(DEFAULT_STAR_COUNT);

  useEffect(() => {
    fetch("https://api.github.com/repos/aidenybai/bippy")
      .then((response) => response.json())
      .then((data) => {
        if (typeof data.stargazers_count === "number") {
          setStarCount(formatStarCount(data.stargazers_count));
        }
      })
      .catch(() => {});
  }, []);

  return (
    <div className="flex w-full max-w-faq items-center gap-1.5">
      <a
        href={GITHUB_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="group flex w-fit items-center justify-between gap-0.5 overflow-clip rounded-full bg-button py-2 pr-1.75 pl-3.5 font-synthesis-none antialiased shadow-button transition-shadow hover:shadow-button-hover active:translate-y-px"
      >
        <div className="flex items-center gap-1.25">
          <svg
            className="size-[0.9375rem] shrink-0 overflow-clip align-middle"
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <defs>
              <clipPath id="bippy-star-clip">
                <rect width="12" height="12" fill="#fff" />
              </clipPath>
            </defs>
            <g clipPath="url(#bippy-star-clip)">
              <path
                className="fill-icon transition-colors group-hover:fill-[#FFC200]"
                fillRule="evenodd"
                clipRule="evenodd"
                d="M6.884 1.195C6.513 0.468 5.474 0.468 5.103 1.195L3.94 3.474L1.414 3.875C0.608 4.004 0.287 4.992 0.864 5.57L2.671 7.38L2.273 9.906C2.145 10.713 2.986 11.323 3.714 10.953L5.994 9.793L8.273 10.953C9.001 11.323 9.842 10.713 9.715 9.906L9.316 7.38L11.124 5.57C11.701 4.992 11.379 4.004 10.573 3.875L8.047 3.474L6.884 1.195Z"
              />
            </g>
          </svg>
          <div className="w-max shrink-0 font-openrunde-medium text-button-label font-medium tracking-install-label text-button-text">
            GitHub
          </div>
        </div>
        <div className="flex flex-col items-start gap-0 rounded-full px-2 py-0.75">
          <div className="flex items-center gap-1.25">
            <div className="w-max shrink-0 font-mono text-button-label font-medium tracking-install-label text-button-text">
              {starCount}
            </div>
          </div>
        </div>
      </a>
    </div>
  );
};
