export const getRandomSetup = (seed: number): string =>
  `(()=>{let state=${seed >>> 0};Math.random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};})();`;
