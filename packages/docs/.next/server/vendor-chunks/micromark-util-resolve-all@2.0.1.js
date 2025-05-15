"use strict";
/*
 * ATTENTION: An "eval-source-map" devtool has been used.
 * This devtool is neither made for production nor for readable output files.
 * It uses "eval()" calls to create a separate source file with attached SourceMaps in the browser devtools.
 * If you are trying to read the output file, select a different devtool (https://webpack.js.org/configuration/devtool/)
 * or disable the default devtool with "devtool: false".
 * If you are looking for production-ready output files, see mode: "production" (https://webpack.js.org/configuration/mode/).
 */
exports.id = "vendor-chunks/micromark-util-resolve-all@2.0.1";
exports.ids = ["vendor-chunks/micromark-util-resolve-all@2.0.1"];
exports.modules = {

/***/ "(rsc)/../../node_modules/.pnpm/micromark-util-resolve-all@2.0.1/node_modules/micromark-util-resolve-all/index.js":
/*!******************************************************************************************************************!*\
  !*** ../../node_modules/.pnpm/micromark-util-resolve-all@2.0.1/node_modules/micromark-util-resolve-all/index.js ***!
  \******************************************************************************************************************/
/***/ ((__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) => {

eval("__webpack_require__.r(__webpack_exports__);\n/* harmony export */ __webpack_require__.d(__webpack_exports__, {\n/* harmony export */   resolveAll: () => (/* binding */ resolveAll)\n/* harmony export */ });\n/**\n * @import {Event, Resolver, TokenizeContext} from 'micromark-util-types'\n */\n\n/**\n * Call all `resolveAll`s.\n *\n * @param {ReadonlyArray<{resolveAll?: Resolver | undefined}>} constructs\n *   List of constructs, optionally with `resolveAll`s.\n * @param {Array<Event>} events\n *   List of events.\n * @param {TokenizeContext} context\n *   Context used by `tokenize`.\n * @returns {Array<Event>}\n *   Changed events.\n */\nfunction resolveAll(constructs, events, context) {\n  /** @type {Array<Resolver>} */\n  const called = []\n  let index = -1\n\n  while (++index < constructs.length) {\n    const resolve = constructs[index].resolveAll\n\n    if (resolve && !called.includes(resolve)) {\n      events = resolve(events, context)\n      called.push(resolve)\n    }\n  }\n\n  return events\n}\n//# sourceURL=[module]\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiKHJzYykvLi4vLi4vbm9kZV9tb2R1bGVzLy5wbnBtL21pY3JvbWFyay11dGlsLXJlc29sdmUtYWxsQDIuMC4xL25vZGVfbW9kdWxlcy9taWNyb21hcmstdXRpbC1yZXNvbHZlLWFsbC9pbmRleC5qcyIsIm1hcHBpbmdzIjoiOzs7O0FBQUE7QUFDQSxZQUFZLGtDQUFrQztBQUM5Qzs7QUFFQTtBQUNBO0FBQ0E7QUFDQSxXQUFXLGVBQWUsa0NBQWtDLEdBQUc7QUFDL0Q7QUFDQSxXQUFXLGNBQWM7QUFDekI7QUFDQSxXQUFXLGlCQUFpQjtBQUM1QjtBQUNBLGFBQWE7QUFDYjtBQUNBO0FBQ087QUFDUCxhQUFhLGlCQUFpQjtBQUM5QjtBQUNBOztBQUVBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBIiwic291cmNlcyI6WyIvaG9tZS91YnVudHUvcmVwb3MvYmlwcHkvbm9kZV9tb2R1bGVzLy5wbnBtL21pY3JvbWFyay11dGlsLXJlc29sdmUtYWxsQDIuMC4xL25vZGVfbW9kdWxlcy9taWNyb21hcmstdXRpbC1yZXNvbHZlLWFsbC9pbmRleC5qcyJdLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIEBpbXBvcnQge0V2ZW50LCBSZXNvbHZlciwgVG9rZW5pemVDb250ZXh0fSBmcm9tICdtaWNyb21hcmstdXRpbC10eXBlcydcbiAqL1xuXG4vKipcbiAqIENhbGwgYWxsIGByZXNvbHZlQWxsYHMuXG4gKlxuICogQHBhcmFtIHtSZWFkb25seUFycmF5PHtyZXNvbHZlQWxsPzogUmVzb2x2ZXIgfCB1bmRlZmluZWR9Pn0gY29uc3RydWN0c1xuICogICBMaXN0IG9mIGNvbnN0cnVjdHMsIG9wdGlvbmFsbHkgd2l0aCBgcmVzb2x2ZUFsbGBzLlxuICogQHBhcmFtIHtBcnJheTxFdmVudD59IGV2ZW50c1xuICogICBMaXN0IG9mIGV2ZW50cy5cbiAqIEBwYXJhbSB7VG9rZW5pemVDb250ZXh0fSBjb250ZXh0XG4gKiAgIENvbnRleHQgdXNlZCBieSBgdG9rZW5pemVgLlxuICogQHJldHVybnMge0FycmF5PEV2ZW50Pn1cbiAqICAgQ2hhbmdlZCBldmVudHMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZXNvbHZlQWxsKGNvbnN0cnVjdHMsIGV2ZW50cywgY29udGV4dCkge1xuICAvKiogQHR5cGUge0FycmF5PFJlc29sdmVyPn0gKi9cbiAgY29uc3QgY2FsbGVkID0gW11cbiAgbGV0IGluZGV4ID0gLTFcblxuICB3aGlsZSAoKytpbmRleCA8IGNvbnN0cnVjdHMubGVuZ3RoKSB7XG4gICAgY29uc3QgcmVzb2x2ZSA9IGNvbnN0cnVjdHNbaW5kZXhdLnJlc29sdmVBbGxcblxuICAgIGlmIChyZXNvbHZlICYmICFjYWxsZWQuaW5jbHVkZXMocmVzb2x2ZSkpIHtcbiAgICAgIGV2ZW50cyA9IHJlc29sdmUoZXZlbnRzLCBjb250ZXh0KVxuICAgICAgY2FsbGVkLnB1c2gocmVzb2x2ZSlcbiAgICB9XG4gIH1cblxuICByZXR1cm4gZXZlbnRzXG59XG4iXSwibmFtZXMiOltdLCJpZ25vcmVMaXN0IjpbMF0sInNvdXJjZVJvb3QiOiIifQ==\n//# sourceURL=webpack-internal:///(rsc)/../../node_modules/.pnpm/micromark-util-resolve-all@2.0.1/node_modules/micromark-util-resolve-all/index.js\n");

/***/ })

};
;