import _asyncToGenerator from "@babel/runtime/helpers/esm/asyncToGenerator";
import _createForOfIteratorHelper from "@babel/runtime/helpers/esm/createForOfIteratorHelper";
import _regeneratorRuntime from "@babel/runtime/helpers/esm/regeneratorRuntime";
import _slicedToArray from "@babel/runtime/helpers/esm/slicedToArray";
import _regenerator from "@babel/runtime/regenerator";
import * as React from "react";
import { useEffect, useState } from "react";

// `@babel/preset-env` (ie 11) + `@babel/plugin-transform-runtime` output for
// async functions with try/catch/finally, `for..of` over an array and a
// string, and an awaited async loop; `hooks` use the `@babel/runtime/regenerator`
// runtime object, the rest the `regeneratorRuntime()` helper.

var later = function later(value) {
  return new Promise(function (resolve) {
    return setTimeout(function () {
      return resolve(value);
    }, 0);
  });
};
var failLater = function failLater(message) {
  return new Promise(function (_resolve, reject) {
    return setTimeout(function () {
      return reject(new Error(message));
    }, 0);
  });
};
var hooks = [
  /*#__PURE__*/ (function () {
    var _ref = _asyncToGenerator(
      /*#__PURE__*/ _regenerator.mark(function _callee(memo) {
        return _regenerator.wrap(function (_context) {
          while (1)
            switch ((_context.prev = _context.next)) {
              case 0:
                return _context.abrupt("return", "".concat(memo, "+a"));
              case 1:
              case "end":
                return _context.stop();
            }
        }, _callee);
      }),
    );
    return function (_x) {
      return _ref.apply(this, arguments);
    };
  })(),
  /*#__PURE__*/ (function () {
    var _ref2 = _asyncToGenerator(
      /*#__PURE__*/ _regenerator.mark(function _callee2(memo) {
        return _regenerator.wrap(function (_context2) {
          while (1)
            switch ((_context2.prev = _context2.next)) {
              case 0:
                return _context2.abrupt("return", "".concat(memo, "+b"));
              case 1:
              case "end":
                return _context2.stop();
            }
        }, _callee2);
      }),
    );
    return function (_x2) {
      return _ref2.apply(this, arguments);
    };
  })(),
];
function applyHooks(_x3) {
  return _applyHooks.apply(this, arguments);
}
function _applyHooks() {
  _applyHooks = _asyncToGenerator(
    /*#__PURE__*/ _regeneratorRuntime().mark(function _callee3(initial) {
      var memo, _iterator, _step, hook, _t;
      return _regeneratorRuntime().wrap(
        function (_context3) {
          while (1)
            switch ((_context3.prev = _context3.next)) {
              case 0:
                memo = initial;
                _iterator = _createForOfIteratorHelper(hooks);
                _context3.prev = 1;
                _iterator.s();
              case 2:
                if ((_step = _iterator.n()).done) {
                  _context3.next = 5;
                  break;
                }
                hook = _step.value;
                _context3.next = 3;
                return hook(memo);
              case 3:
                memo = _context3.sent;
              case 4:
                _context3.next = 2;
                break;
              case 5:
                _context3.next = 7;
                break;
              case 6:
                _context3.prev = 6;
                _t = _context3["catch"](1);
                _iterator.e(_t);
              case 7:
                _context3.prev = 7;
                _iterator.f();
                return _context3.finish(7);
              case 8:
                return _context3.abrupt("return", memo);
              case 9:
              case "end":
                return _context3.stop();
            }
        },
        _callee3,
        null,
        [[1, 6, 7, 8]],
      );
    }),
  );
  return _applyHooks.apply(this, arguments);
}
function loadLines() {
  return _loadLines.apply(this, arguments);
}
function _loadLines() {
  _loadLines = _asyncToGenerator(
    /*#__PURE__*/ _regeneratorRuntime().mark(function _callee4() {
      var lines, greeting, _iterator2, _step2, letter, _t2, _t3;
      return _regeneratorRuntime().wrap(
        function (_context4) {
          while (1)
            switch ((_context4.prev = _context4.next)) {
              case 0:
                lines = [];
                _context4.next = 1;
                return later("hello");
              case 1:
                greeting = _context4.sent;
                lines.push(greeting);
                _context4.prev = 2;
                _context4.next = 3;
                return failLater("boom");
              case 3:
                lines.push("unreachable");
                _context4.next = 5;
                break;
              case 4:
                _context4.prev = 4;
                _t2 = _context4["catch"](2);
                lines.push("caught ".concat(_t2.message));
              case 5:
                _context4.prev = 5;
                lines.push("finally");
                return _context4.finish(5);
              case 6:
                _t3 = lines;
                _context4.next = 7;
                return applyHooks("start");
              case 7:
                _t3.push.call(_t3, _context4.sent);
                _iterator2 = _createForOfIteratorHelper("xy");
                try {
                  for (_iterator2.s(); !(_step2 = _iterator2.n()).done; ) {
                    letter = _step2.value;
                    lines.push(letter);
                  }
                } catch (err) {
                  _iterator2.e(err);
                } finally {
                  _iterator2.f();
                }
                return _context4.abrupt("return", lines);
              case 8:
              case "end":
                return _context4.stop();
            }
        },
        _callee4,
        null,
        [[2, 4, 5, 6]],
      );
    }),
  );
  return _loadLines.apply(this, arguments);
}
var CompiledAsync = function CompiledAsync() {
  var _useState = useState([]),
    _useState2 = _slicedToArray(_useState, 2),
    lines = _useState2[0],
    setLines = _useState2[1];
  useEffect(function () {
    loadLines().then(setLines);
  }, []);
  return React.createElement(
    "ul",
    null,
    lines.map(function (line, index) {
      return React.createElement("li", { key: index }, index, ": ", line);
    }),
  );
};
export default CompiledAsync;
