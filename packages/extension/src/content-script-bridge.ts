import browser from 'webextension-polyfill';

window.addEventListener('message', (event) => {
  if (
    event.source === window &&
    event.data?.type === 'REACT_ACTIVE' &&
    event.data?.source === 'bippy-extension'
  ) {
    browser.runtime.sendMessage({ type: 'REACT_DETECTED' }).catch(() => {});
  }
});
