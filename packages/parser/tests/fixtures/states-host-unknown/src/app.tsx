const WIDE_VIEWPORT = 600;

export const App = () => {
  const isWide = window.innerWidth > WIDE_VIEWPORT;
  return <main>{isWide ? <table /> : <dl />}</main>;
};
