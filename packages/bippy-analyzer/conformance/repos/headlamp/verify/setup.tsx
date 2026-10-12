// The app's modules import each other in cycles, which resolve only in the order its root
// imports them, so they load from there before any component does.
import "/src/App";
