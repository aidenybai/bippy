import browser from 'webextension-polyfill';

void browser.devtools.panels.create('Bippy', 'icon/bippy.png', 'src/panel.html');

try {
  const connectionPort = browser.runtime.connect({
    name: `devtools-${browser.devtools.inspectedWindow.tabId}`,
  });

  connectionPort.onDisconnect.addListener(() => {
    if (browser.runtime.lastError) {
      // ignore
    }
  });
} catch {
  // ignore
}
