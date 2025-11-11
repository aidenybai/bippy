import { instrument, isInstrumentationActive } from 'bippy';

let hasReactBeenDetected = false;

const notifyReactDetected = () => {
  if (hasReactBeenDetected) return;
  hasReactBeenDetected = true;
  window.postMessage({ type: 'REACT_ACTIVE', source: 'bippy-extension' }, '*');
};

instrument({
  onActive() {
    notifyReactDetected();
  },
});

setTimeout(() => {
  if (isInstrumentationActive()) {
    notifyReactDetected();
  }
}, 1000);
