export async function openOptions(): Promise<void> {
  if (typeof chrome === 'undefined') return;
  const optionsUrl = chrome.runtime.getURL('options.html');
  if (chrome.tabs?.query && chrome.tabs?.create) {
    const tabs = await chrome.tabs.query({ url: optionsUrl });
    if (tabs.length > 0 && tabs[0]?.id !== undefined) {
      await chrome.tabs.update(tabs[0].id, { active: true });
      if (tabs[0].windowId) {
        await chrome.windows.update(tabs[0].windowId, { focused: true });
      }
      return;
    }
    await chrome.tabs.create({ url: optionsUrl });
  } else if (chrome.runtime?.openOptionsPage) {
    chrome.runtime.openOptionsPage();
  }
}
