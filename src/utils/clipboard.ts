import { AppEvents } from '@grafana/data';
import { getAppEvents } from '@grafana/runtime';

export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    // No Clipboard API (plain-http Grafana) or permission denied: fall back to a hidden textarea.
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- the only option without the Clipboard API
  const ok = document.execCommand('copy');
  area.remove();
  if (!ok) {
    throw new Error('copy failed');
  }
}

/** Copies and reports the outcome with a Grafana toast. */
export function copyWithToast(text: string, what = 'Copied') {
  copyText(text).then(
    () => getAppEvents().publish({ type: AppEvents.alertSuccess.name, payload: [what] }),
    () => getAppEvents().publish({ type: AppEvents.alertError.name, payload: ['Could not copy to the clipboard'] })
  );
}
