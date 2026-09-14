const MANY_CORES = 4;

export const App = () => {
  const isPowerful = navigator.hardwareConcurrency > MANY_CORES;
  return <main>{isPowerful ? <table /> : <dl />}</main>;
};
