const CreatedAt = () => {
  const createdAt = new Date();
  const copy = new Date(createdAt.getTime());
  const fromNow = new Date(Date.now());
  return (
    <dl>
      {createdAt instanceof Date ? <dt>date</dt> : <dd>not a date</dd>}
      {copy instanceof Date && fromNow instanceof Date ? <dt>copies</dt> : <dd>plain</dd>}
      {createdAt.getMonth() < 12 && createdAt.getDate() >= 1 ? (
        <dt>calendar</dt>
      ) : (
        <dd>out of range</dd>
      )}
      {createdAt.getUTCHours() <= 23 && createdAt.getDay() <= 6 ? <dt>clock</dt> : <dd>wrapped</dd>}
      {typeof createdAt.getFullYear() === "number" ? <dt>year</dt> : <dd>no year</dd>}
      {typeof createdAt.toISOString() === "string" ? <dt>iso</dt> : <dd>no iso</dd>}
      {typeof createdAt.toLocaleDateString() === "string" ? <dt>locale</dt> : <dd>no locale</dd>}
      {typeof createdAt.getTime() === "number" ? <dt>epoch</dt> : <dd>no epoch</dd>}
    </dl>
  );
};

const Footer = () => {
  const year = new Date().getFullYear();
  const legacyYear = 1900 + new Date().getYear();
  return (
    <footer>
      © {year} Example {legacyYear}
    </footer>
  );
};

export default function WallClock() {
  return (
    <section>
      <CreatedAt />
      <Footer />
    </section>
  );
}
