import browser from 'webextension-polyfill';

const devtoolsConnections = new Map<number, browser.Runtime.Port>();

browser.runtime.onConnect.addListener((port) => {
  if (port.name.startsWith('devtools-')) {
    const tabId = parseInt(port.name.split('-')[1] || '0', 10);
    devtoolsConnections.set(tabId, port);

    port.onDisconnect.addListener(() => {
      devtoolsConnections.delete(tabId);
    });
  }
});

browser.runtime.onMessage.addListener((message) => {
  if (message.type === 'REACT_DETECTED') {
    devtoolsConnections.forEach((port) => {
      port.postMessage(message);
    });
  }
});
