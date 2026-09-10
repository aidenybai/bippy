const slugify = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase();

const TITLES = ["Café Crème", "Ångström Units", "naïve résumé"];

const SlugList = () => (
  <ul>
    {TITLES.map((title) => {
      const slug = slugify(title);
      return (
        <li
          key={slug}
          data-slug={slug}
          data-composed={title.normalize() === title ? "same" : "changed"}
        >
          {slug.endsWith("-units") ? <strong>{slug}</strong> : <span>{slug}</span>}
        </li>
      );
    })}
  </ul>
);

export const isExact = true;

export default function UnicodeNormalize() {
  return <SlugList />;
}
