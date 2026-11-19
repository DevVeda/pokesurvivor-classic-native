chrome.action.onClicked.addListener(tab => {
  chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['saves.js', 'download.js'] })
    .catch(() => {});   // pages where scripts can't run (chrome://, the web store…)
});
