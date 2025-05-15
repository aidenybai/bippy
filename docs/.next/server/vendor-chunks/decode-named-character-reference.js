"use strict";
/*
 * ATTENTION: An "eval-source-map" devtool has been used.
 * This devtool is neither made for production nor for readable output files.
 * It uses "eval()" calls to create a separate source file with attached SourceMaps in the browser devtools.
 * If you are trying to read the output file, select a different devtool (https://webpack.js.org/configuration/devtool/)
 * or disable the default devtool with "devtool: false".
 * If you are looking for production-ready output files, see mode: "production" (https://webpack.js.org/configuration/mode/).
 */
exports.id = "vendor-chunks/decode-named-character-reference";
exports.ids = ["vendor-chunks/decode-named-character-reference"];
exports.modules = {

/***/ "(rsc)/./node_modules/decode-named-character-reference/index.js":
/*!****************************************************************!*\
  !*** ./node_modules/decode-named-character-reference/index.js ***!
  \****************************************************************/
/***/ ((__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) => {

eval("__webpack_require__.r(__webpack_exports__);\n/* harmony export */ __webpack_require__.d(__webpack_exports__, {\n/* harmony export */   decodeNamedCharacterReference: () => (/* binding */ decodeNamedCharacterReference)\n/* harmony export */ });\n/* harmony import */ var character_entities__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! character-entities */ \"(rsc)/./node_modules/character-entities/index.js\");\n\n\n// To do: next major: use `Object.hasOwn`.\nconst own = {}.hasOwnProperty\n\n/**\n * Decode a single character reference (without the `&` or `;`).\n * You probably only need this when you’re building parsers yourself that follow\n * different rules compared to HTML.\n * This is optimized to be tiny in browsers.\n *\n * @param {string} value\n *   `notin` (named), `#123` (deci), `#x123` (hexa).\n * @returns {string|false}\n *   Decoded reference.\n */\nfunction decodeNamedCharacterReference(value) {\n  return own.call(character_entities__WEBPACK_IMPORTED_MODULE_0__.characterEntities, value) ? character_entities__WEBPACK_IMPORTED_MODULE_0__.characterEntities[value] : false\n}\n//# sourceURL=[module]\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiKHJzYykvLi9ub2RlX21vZHVsZXMvZGVjb2RlLW5hbWVkLWNoYXJhY3Rlci1yZWZlcmVuY2UvaW5kZXguanMiLCJtYXBwaW5ncyI6Ijs7Ozs7QUFBb0Q7O0FBRXBEO0FBQ0EsY0FBYzs7QUFFZDtBQUNBLDZEQUE2RDtBQUM3RDtBQUNBO0FBQ0E7QUFDQTtBQUNBLFdBQVcsUUFBUTtBQUNuQjtBQUNBLGFBQWE7QUFDYjtBQUNBO0FBQ087QUFDUCxrQkFBa0IsaUVBQWlCLFdBQVcsaUVBQWlCO0FBQy9EIiwic291cmNlcyI6WyIvaG9tZS91YnVudHUvcmVwb3MvYmlwcHkvZG9jcy9ub2RlX21vZHVsZXMvZGVjb2RlLW5hbWVkLWNoYXJhY3Rlci1yZWZlcmVuY2UvaW5kZXguanMiXSwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHtjaGFyYWN0ZXJFbnRpdGllc30gZnJvbSAnY2hhcmFjdGVyLWVudGl0aWVzJ1xuXG4vLyBUbyBkbzogbmV4dCBtYWpvcjogdXNlIGBPYmplY3QuaGFzT3duYC5cbmNvbnN0IG93biA9IHt9Lmhhc093blByb3BlcnR5XG5cbi8qKlxuICogRGVjb2RlIGEgc2luZ2xlIGNoYXJhY3RlciByZWZlcmVuY2UgKHdpdGhvdXQgdGhlIGAmYCBvciBgO2ApLlxuICogWW91IHByb2JhYmx5IG9ubHkgbmVlZCB0aGlzIHdoZW4geW914oCZcmUgYnVpbGRpbmcgcGFyc2VycyB5b3Vyc2VsZiB0aGF0IGZvbGxvd1xuICogZGlmZmVyZW50IHJ1bGVzIGNvbXBhcmVkIHRvIEhUTUwuXG4gKiBUaGlzIGlzIG9wdGltaXplZCB0byBiZSB0aW55IGluIGJyb3dzZXJzLlxuICpcbiAqIEBwYXJhbSB7c3RyaW5nfSB2YWx1ZVxuICogICBgbm90aW5gIChuYW1lZCksIGAjMTIzYCAoZGVjaSksIGAjeDEyM2AgKGhleGEpLlxuICogQHJldHVybnMge3N0cmluZ3xmYWxzZX1cbiAqICAgRGVjb2RlZCByZWZlcmVuY2UuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBkZWNvZGVOYW1lZENoYXJhY3RlclJlZmVyZW5jZSh2YWx1ZSkge1xuICByZXR1cm4gb3duLmNhbGwoY2hhcmFjdGVyRW50aXRpZXMsIHZhbHVlKSA/IGNoYXJhY3RlckVudGl0aWVzW3ZhbHVlXSA6IGZhbHNlXG59XG4iXSwibmFtZXMiOltdLCJpZ25vcmVMaXN0IjpbMF0sInNvdXJjZVJvb3QiOiIifQ==\n//# sourceURL=webpack-internal:///(rsc)/./node_modules/decode-named-character-reference/index.js\n");

/***/ })

};
;