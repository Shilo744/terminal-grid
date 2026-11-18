// Folder picker: inside the desktop app (Electron) it is the modern Windows dialog, opened at once by the app itself (window.tgNative.pickFolder);
// in a plain browser the server opens the old PowerShell dialog (slow to start, old look). Returns the chosen folder or '' when cancelled.
export async function pickFolder(start) {
  if (window.tgNative && typeof window.tgNative.pickFolder === 'function') return (await window.tgNative.pickFolder(start || '')) || '';
  const res = await fetch('/api/pick-folder', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ start }) });
  const j = await res.json();
  return j.path || '';
}
