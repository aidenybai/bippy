"use strict";
/*
 * ATTENTION: An "eval-source-map" devtool has been used.
 * This devtool is neither made for production nor for readable output files.
 * It uses "eval()" calls to create a separate source file with attached SourceMaps in the browser devtools.
 * If you are trying to read the output file, select a different devtool (https://webpack.js.org/configuration/devtool/)
 * or disable the default devtool with "devtool: false".
 * If you are looking for production-ready output files, see mode: "production" (https://webpack.js.org/configuration/mode/).
 */
exports.id = "vendor-chunks/has-flag@4.0.0";
exports.ids = ["vendor-chunks/has-flag@4.0.0"];
exports.modules = {

/***/ "(rsc)/../../node_modules/.pnpm/has-flag@4.0.0/node_modules/has-flag/index.js":
/*!******************************************************************************!*\
  !*** ../../node_modules/.pnpm/has-flag@4.0.0/node_modules/has-flag/index.js ***!
  \******************************************************************************/
/***/ ((module) => {

eval("\n\nmodule.exports = (flag, argv = process.argv) => {\n\tconst prefix = flag.startsWith('-') ? '' : (flag.length === 1 ? '-' : '--');\n\tconst position = argv.indexOf(prefix + flag);\n\tconst terminatorPosition = argv.indexOf('--');\n\treturn position !== -1 && (terminatorPosition === -1 || position < terminatorPosition);\n};\n//# sourceURL=[module]\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiKHJzYykvLi4vLi4vbm9kZV9tb2R1bGVzLy5wbnBtL2hhcy1mbGFnQDQuMC4wL25vZGVfbW9kdWxlcy9oYXMtZmxhZy9pbmRleC5qcyIsIm1hcHBpbmdzIjoiQUFBYTs7QUFFYjtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EiLCJzb3VyY2VzIjpbIi9ob21lL3VidW50dS9yZXBvcy9iaXBweS9ub2RlX21vZHVsZXMvLnBucG0vaGFzLWZsYWdANC4wLjAvbm9kZV9tb2R1bGVzL2hhcy1mbGFnL2luZGV4LmpzIl0sInNvdXJjZXNDb250ZW50IjpbIid1c2Ugc3RyaWN0JztcblxubW9kdWxlLmV4cG9ydHMgPSAoZmxhZywgYXJndiA9IHByb2Nlc3MuYXJndikgPT4ge1xuXHRjb25zdCBwcmVmaXggPSBmbGFnLnN0YXJ0c1dpdGgoJy0nKSA/ICcnIDogKGZsYWcubGVuZ3RoID09PSAxID8gJy0nIDogJy0tJyk7XG5cdGNvbnN0IHBvc2l0aW9uID0gYXJndi5pbmRleE9mKHByZWZpeCArIGZsYWcpO1xuXHRjb25zdCB0ZXJtaW5hdG9yUG9zaXRpb24gPSBhcmd2LmluZGV4T2YoJy0tJyk7XG5cdHJldHVybiBwb3NpdGlvbiAhPT0gLTEgJiYgKHRlcm1pbmF0b3JQb3NpdGlvbiA9PT0gLTEgfHwgcG9zaXRpb24gPCB0ZXJtaW5hdG9yUG9zaXRpb24pO1xufTtcbiJdLCJuYW1lcyI6W10sImlnbm9yZUxpc3QiOlswXSwic291cmNlUm9vdCI6IiJ9\n//# sourceURL=webpack-internal:///(rsc)/../../node_modules/.pnpm/has-flag@4.0.0/node_modules/has-flag/index.js\n");

/***/ })

};
;