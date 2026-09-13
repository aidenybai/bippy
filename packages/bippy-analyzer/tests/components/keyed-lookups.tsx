import { useEffect, useState } from "react";

const HOUSE_AUTHOR = "house";
const HOUSE_AVATAR = "/avatars/house.svg";
const ENTRIES = [
  "ada",
  HOUSE_AUTHOR,
  "grace",
  "ada",
  HOUSE_AUTHOR,
  "linus",
  "grace",
  "ada",
  "linus",
  HOUSE_AUTHOR,
  "ada",
  "grace",
];

/** Resolves once the avatar has loaded, so at runtime it depends on the image server. */
const lookupAvatar = (author: string): Promise<string> =>
  new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      resolve(image.naturalWidth > 0 ? image.src : "");
    };
    image.src = `/avatars/${author}.png`;
  });

const Avatars = () => {
  const [avatarUrlMap, setAvatarUrlMap] = useState<Record<string, string>>({});
  useEffect(() => {
    const urls: Record<string, string> = {};
    Promise.all(
      Array.from(new Set(ENTRIES)).map((author) => {
        if (author === HOUSE_AUTHOR) {
          urls[author] = HOUSE_AVATAR;
          return Promise.resolve();
        }
        return lookupAvatar(author).then((url) => {
          urls[author] = url;
        });
      }),
    ).then(() => setAvatarUrlMap(urls));
  }, []);
  return (
    <ul>
      {ENTRIES.map((author, index) => (
        <li key={index}>
          {avatarUrlMap[author] && <img alt={author} src={avatarUrlMap[author]} />}
          <span>{avatarUrlMap[author] ? author : `${author} (pending)`}</span>
        </li>
      ))}
    </ul>
  );
};

export const isPartial = true;

export default Avatars;
