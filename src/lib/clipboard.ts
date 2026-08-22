/**
 * Copy text to the system clipboard.
 *
 * `navigator.clipboard.writeText` is only available in secure contexts
 * (https:// or localhost). When the app is served over plain http on a
 * non-localhost host (e.g. a LAN IP) the Clipboard API is undefined and
 * every copy button silently fails. This helper falls back to the legacy
 * `document.execCommand('copy')` textarea trick in that case, so copy
 * works everywhere the app can run.
 */
export async function copyToClipboard(text: string): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall through to the legacy path below.
    }
  }

  if (typeof document === 'undefined') {
    throw new Error('Clipboard unavailable');
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.top = '0';
  textarea.style.left = '0';
  textarea.style.width = '2em';
  textarea.style.height = '2em';
  textarea.style.padding = '0';
  textarea.style.border = 'none';
  textarea.style.outline = 'none';
  textarea.style.boxShadow = 'none';
  textarea.style.background = 'transparent';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);

  // Focus + select the textarea so iOS and desktop browsers copy its value.
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);

  let succeeded = false;
  try {
    succeeded = document.execCommand('copy');
  } catch {
    succeeded = false;
  } finally {
    document.body.removeChild(textarea);
  }

  if (!succeeded) {
    throw new Error('Clipboard write failed');
  }
}
