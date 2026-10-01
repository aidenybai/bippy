/* eslint-disable no-var -- Mirrors create-react-class's ES5 output. */
import * as React from "react";

// create-react-class: a plain constructor whose prototype inherits `isReactComponent`
// from `React.Component.prototype`, with the spec's methods copied on and the
// state coming from `getInitialState`; React constructs it instead of calling it.
var ReactClassComponent = function () {};
Object.assign(ReactClassComponent.prototype, React.Component.prototype, {
  replaceState: function (newState, callback) {
    this.setState(newState, callback);
  },
});

function createReactClass(spec) {
  var Constructor = function (props, context, updater) {
    this.props = props;
    this.context = context;
    this.refs = {};
    this.updater = updater;
    this.state = this.getInitialState ? this.getInitialState() : null;
  };
  Constructor.prototype = new ReactClassComponent();
  Constructor.prototype.constructor = Constructor;
  for (var name in spec) {
    if (name === "getDefaultProps") {
      Constructor.defaultProps = spec[name]();
    } else if (name === "displayName") {
      Constructor.displayName = spec[name];
    } else if (name === "statics") {
      Object.assign(Constructor, spec[name]);
    } else {
      Constructor.prototype[name] = spec[name];
    }
  }
  return Constructor;
}

var Counter = createReactClass({
  displayName: "Counter",
  getDefaultProps: function () {
    return { step: 2, label: "count" };
  },
  getInitialState: function () {
    return { count: this.props.start };
  },
  componentDidMount: function () {
    this.setState({ count: this.state.count + this.props.step });
  },
  render: function () {
    return React.createElement(
      "p",
      { className: this.props.label },
      this.props.label,
      ": ",
      this.state.count,
    );
  },
});

var Anonymous = createReactClass({
  render: function () {
    return React.createElement("i", null, this.props.children);
  },
});

// Not constructed: a function whose prototype lacks `isReactComponent` is a function component.
function Plain(props) {
  return React.createElement("b", null, props.children);
}
Plain.prototype.render = function () {
  return React.createElement("u", null, "never");
};

// `typeof React.Component.prototype.setState` is what create-react-class's
// warnings and `PureComponent.prototype.isPureReactComponent` observe.
var protoFacts = [
  typeof React.Component.prototype.setState,
  typeof React.Component.prototype.isReactComponent,
  React.PureComponent.prototype.isPureReactComponent === true,
  React.Component.prototype.isPureReactComponent === undefined,
].join(",");

export const isExact = true;

export default function App() {
  return React.createElement(
    "div",
    null,
    React.createElement(Counter, { start: 1 }),
    React.createElement(Counter, { start: 10, step: 5, label: "total" }),
    React.createElement(Anonymous, null, "anon"),
    React.createElement(Plain, null, "plain"),
    React.createElement("code", null, protoFacts),
  );
}
