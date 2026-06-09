chrome.runtime.onInstalled.addListener((details) => {
  chrome.storage.local.set({
    lastInstalledVersion: chrome.runtime.getManifest().version,
    lastInstallReason: details.reason,
    lastInstallAt: Date.now()
  });

  if (chrome.sidePanel?.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.warn);
  }
});