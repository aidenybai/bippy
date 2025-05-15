"use strict";
/*
 * ATTENTION: An "eval-source-map" devtool has been used.
 * This devtool is neither made for production nor for readable output files.
 * It uses "eval()" calls to create a separate source file with attached SourceMaps in the browser devtools.
 * If you are trying to read the output file, select a different devtool (https://webpack.js.org/configuration/devtool/)
 * or disable the default devtool with "devtool: false".
 * If you are looking for production-ready output files, see mode: "production" (https://webpack.js.org/configuration/mode/).
 */
exports.id = "vendor-chunks/longest-streak";
exports.ids = ["vendor-chunks/longest-streak"];
exports.modules = {

/***/ "(rsc)/./node_modules/longest-streak/index.js":
/*!**********************************************!*\
  !*** ./node_modules/longest-streak/index.js ***!
  \**********************************************/
/***/ ((__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) => {

eval("__webpack_require__.r(__webpack_exports__);\n/* harmony export */ __webpack_require__.d(__webpack_exports__, {\n/* harmony export */   longestStreak: () => (/* binding */ longestStreak)\n/* harmony export */ });\n/**\n * Get the count of the longest repeating streak of `substring` in `value`.\n *\n * @param {string} value\n *   Content to search in.\n * @param {string} substring\n *   Substring to look for, typically one character.\n * @returns {number}\n *   Count of most frequent adjacent `substring`s in `value`.\n */\nfunction longestStreak(value, substring) {\n  const source = String(value)\n  let index = source.indexOf(substring)\n  let expected = index\n  let count = 0\n  let max = 0\n\n  if (typeof substring !== 'string') {\n    throw new TypeError('Expected substring')\n  }\n\n  while (index !== -1) {\n    if (index === expected) {\n      if (++count > max) {\n        max = count\n      }\n    } else {\n      count = 1\n    }\n\n    expected = index + substring.length\n    index = source.indexOf(substring, expected)\n  }\n\n  return max\n}\n//# sourceURL=[module]\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiKHJzYykvLi9ub2RlX21vZHVsZXMvbG9uZ2VzdC1zdHJlYWsvaW5kZXguanMiLCJtYXBwaW5ncyI6Ijs7OztBQUFBO0FBQ0E7QUFDQTtBQUNBLFdBQVcsUUFBUTtBQUNuQjtBQUNBLFdBQVcsUUFBUTtBQUNuQjtBQUNBLGFBQWE7QUFDYjtBQUNBO0FBQ087QUFDUDtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsTUFBTTtBQUNOO0FBQ0E7O0FBRUE7QUFDQTtBQUNBOztBQUVBO0FBQ0EiLCJzb3VyY2VzIjpbIi9ob21lL3VidW50dS9yZXBvcy9iaXBweS9kb2NzL25vZGVfbW9kdWxlcy9sb25nZXN0LXN0cmVhay9pbmRleC5qcyJdLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIEdldCB0aGUgY291bnQgb2YgdGhlIGxvbmdlc3QgcmVwZWF0aW5nIHN0cmVhayBvZiBgc3Vic3RyaW5nYCBpbiBgdmFsdWVgLlxuICpcbiAqIEBwYXJhbSB7c3RyaW5nfSB2YWx1ZVxuICogICBDb250ZW50IHRvIHNlYXJjaCBpbi5cbiAqIEBwYXJhbSB7c3RyaW5nfSBzdWJzdHJpbmdcbiAqICAgU3Vic3RyaW5nIHRvIGxvb2sgZm9yLCB0eXBpY2FsbHkgb25lIGNoYXJhY3Rlci5cbiAqIEByZXR1cm5zIHtudW1iZXJ9XG4gKiAgIENvdW50IG9mIG1vc3QgZnJlcXVlbnQgYWRqYWNlbnQgYHN1YnN0cmluZ2BzIGluIGB2YWx1ZWAuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBsb25nZXN0U3RyZWFrKHZhbHVlLCBzdWJzdHJpbmcpIHtcbiAgY29uc3Qgc291cmNlID0gU3RyaW5nKHZhbHVlKVxuICBsZXQgaW5kZXggPSBzb3VyY2UuaW5kZXhPZihzdWJzdHJpbmcpXG4gIGxldCBleHBlY3RlZCA9IGluZGV4XG4gIGxldCBjb3VudCA9IDBcbiAgbGV0IG1heCA9IDBcblxuICBpZiAodHlwZW9mIHN1YnN0cmluZyAhPT0gJ3N0cmluZycpIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdFeHBlY3RlZCBzdWJzdHJpbmcnKVxuICB9XG5cbiAgd2hpbGUgKGluZGV4ICE9PSAtMSkge1xuICAgIGlmIChpbmRleCA9PT0gZXhwZWN0ZWQpIHtcbiAgICAgIGlmICgrK2NvdW50ID4gbWF4KSB7XG4gICAgICAgIG1heCA9IGNvdW50XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIGNvdW50ID0gMVxuICAgIH1cblxuICAgIGV4cGVjdGVkID0gaW5kZXggKyBzdWJzdHJpbmcubGVuZ3RoXG4gICAgaW5kZXggPSBzb3VyY2UuaW5kZXhPZihzdWJzdHJpbmcsIGV4cGVjdGVkKVxuICB9XG5cbiAgcmV0dXJuIG1heFxufVxuIl0sIm5hbWVzIjpbXSwiaWdub3JlTGlzdCI6WzBdLCJzb3VyY2VSb290IjoiIn0=\n//# sourceURL=webpack-internal:///(rsc)/./node_modules/longest-streak/index.js\n");

/***/ })

};
;