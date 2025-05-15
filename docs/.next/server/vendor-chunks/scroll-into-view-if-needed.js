"use strict";
/*
 * ATTENTION: An "eval-source-map" devtool has been used.
 * This devtool is neither made for production nor for readable output files.
 * It uses "eval()" calls to create a separate source file with attached SourceMaps in the browser devtools.
 * If you are trying to read the output file, select a different devtool (https://webpack.js.org/configuration/devtool/)
 * or disable the default devtool with "devtool: false".
 * If you are looking for production-ready output files, see mode: "production" (https://webpack.js.org/configuration/mode/).
 */
exports.id = "vendor-chunks/scroll-into-view-if-needed";
exports.ids = ["vendor-chunks/scroll-into-view-if-needed"];
exports.modules = {

/***/ "(ssr)/./node_modules/scroll-into-view-if-needed/dist/index.js":
/*!***************************************************************!*\
  !*** ./node_modules/scroll-into-view-if-needed/dist/index.js ***!
  \***************************************************************/
/***/ ((__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) => {

eval("__webpack_require__.r(__webpack_exports__);\n/* harmony export */ __webpack_require__.d(__webpack_exports__, {\n/* harmony export */   \"default\": () => (/* binding */ e)\n/* harmony export */ });\n/* harmony import */ var compute_scroll_into_view__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! compute-scroll-into-view */ \"(ssr)/./node_modules/compute-scroll-into-view/dist/index.js\");\nconst o=t=>!1===t?{block:\"end\",inline:\"nearest\"}:(t=>t===Object(t)&&0!==Object.keys(t).length)(t)?t:{block:\"start\",inline:\"nearest\"};function e(e,r){if(!e.isConnected||!(t=>{let o=t;for(;o&&o.parentNode;){if(o.parentNode===document)return!0;o=o.parentNode instanceof ShadowRoot?o.parentNode.host:o.parentNode}return!1})(e))return;const n=(t=>{const o=window.getComputedStyle(t);return{top:parseFloat(o.scrollMarginTop)||0,right:parseFloat(o.scrollMarginRight)||0,bottom:parseFloat(o.scrollMarginBottom)||0,left:parseFloat(o.scrollMarginLeft)||0}})(e);if((t=>\"object\"==typeof t&&\"function\"==typeof t.behavior)(r))return r.behavior((0,compute_scroll_into_view__WEBPACK_IMPORTED_MODULE_0__.compute)(e,r));const l=\"boolean\"==typeof r||null==r?void 0:r.behavior;for(const{el:a,top:i,left:s}of (0,compute_scroll_into_view__WEBPACK_IMPORTED_MODULE_0__.compute)(e,o(r))){const t=i-n.top+n.bottom,o=s-n.left+n.right;a.scroll({top:t,left:o,behavior:l})}}//# sourceMappingURL=index.js.map\n//# sourceURL=[module]\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiKHNzcikvLi9ub2RlX21vZHVsZXMvc2Nyb2xsLWludG8tdmlldy1pZi1uZWVkZWQvZGlzdC9pbmRleC5qcyIsIm1hcHBpbmdzIjoiOzs7OztBQUFtRCxtQkFBbUIsNkJBQTZCLHFEQUFxRCxnQ0FBZ0MsZ0JBQWdCLHlCQUF5QixRQUFRLEtBQUssZ0JBQWdCLEVBQUUsb0NBQW9DLG9FQUFvRSxTQUFTLFlBQVksYUFBYSxtQ0FBbUMsT0FBTyxpS0FBaUssS0FBSywrRUFBK0UsaUVBQUMsT0FBTyx1REFBdUQsVUFBVSxrQkFBa0IsR0FBRyxpRUFBQyxVQUFVLDRDQUE0QyxVQUFVLHdCQUF3QixHQUF3QiIsInNvdXJjZXMiOlsiL2hvbWUvdWJ1bnR1L3JlcG9zL2JpcHB5L2RvY3Mvbm9kZV9tb2R1bGVzL3Njcm9sbC1pbnRvLXZpZXctaWYtbmVlZGVkL2Rpc3QvaW5kZXguanMiXSwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0e2NvbXB1dGUgYXMgdH1mcm9tXCJjb21wdXRlLXNjcm9sbC1pbnRvLXZpZXdcIjtjb25zdCBvPXQ9PiExPT09dD97YmxvY2s6XCJlbmRcIixpbmxpbmU6XCJuZWFyZXN0XCJ9Oih0PT50PT09T2JqZWN0KHQpJiYwIT09T2JqZWN0LmtleXModCkubGVuZ3RoKSh0KT90OntibG9jazpcInN0YXJ0XCIsaW5saW5lOlwibmVhcmVzdFwifTtmdW5jdGlvbiBlKGUscil7aWYoIWUuaXNDb25uZWN0ZWR8fCEodD0+e2xldCBvPXQ7Zm9yKDtvJiZvLnBhcmVudE5vZGU7KXtpZihvLnBhcmVudE5vZGU9PT1kb2N1bWVudClyZXR1cm4hMDtvPW8ucGFyZW50Tm9kZSBpbnN0YW5jZW9mIFNoYWRvd1Jvb3Q/by5wYXJlbnROb2RlLmhvc3Q6by5wYXJlbnROb2RlfXJldHVybiExfSkoZSkpcmV0dXJuO2NvbnN0IG49KHQ9Pntjb25zdCBvPXdpbmRvdy5nZXRDb21wdXRlZFN0eWxlKHQpO3JldHVybnt0b3A6cGFyc2VGbG9hdChvLnNjcm9sbE1hcmdpblRvcCl8fDAscmlnaHQ6cGFyc2VGbG9hdChvLnNjcm9sbE1hcmdpblJpZ2h0KXx8MCxib3R0b206cGFyc2VGbG9hdChvLnNjcm9sbE1hcmdpbkJvdHRvbSl8fDAsbGVmdDpwYXJzZUZsb2F0KG8uc2Nyb2xsTWFyZ2luTGVmdCl8fDB9fSkoZSk7aWYoKHQ9Plwib2JqZWN0XCI9PXR5cGVvZiB0JiZcImZ1bmN0aW9uXCI9PXR5cGVvZiB0LmJlaGF2aW9yKShyKSlyZXR1cm4gci5iZWhhdmlvcih0KGUscikpO2NvbnN0IGw9XCJib29sZWFuXCI9PXR5cGVvZiByfHxudWxsPT1yP3ZvaWQgMDpyLmJlaGF2aW9yO2Zvcihjb25zdHtlbDphLHRvcDppLGxlZnQ6c31vZiB0KGUsbyhyKSkpe2NvbnN0IHQ9aS1uLnRvcCtuLmJvdHRvbSxvPXMtbi5sZWZ0K24ucmlnaHQ7YS5zY3JvbGwoe3RvcDp0LGxlZnQ6byxiZWhhdmlvcjpsfSl9fWV4cG9ydHtlIGFzIGRlZmF1bHR9Oy8vIyBzb3VyY2VNYXBwaW5nVVJMPWluZGV4LmpzLm1hcFxuIl0sIm5hbWVzIjpbXSwiaWdub3JlTGlzdCI6WzBdLCJzb3VyY2VSb290IjoiIn0=\n//# sourceURL=webpack-internal:///(ssr)/./node_modules/scroll-into-view-if-needed/dist/index.js\n");

/***/ })

};
;