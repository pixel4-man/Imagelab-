export type ClipboardCopyMethod = 'clipboard-api' | 'exec-command' | 'none';

export interface ClipboardCopyResult {
  ok: boolean;
  method: ClipboardCopyMethod;
  reason?: 'empty_text' | 'clipboard_blocked' | 'unsupported';
}

/**
 * Selects the full contents of a visible input or textarea element so users can
 * manually copy immediately if automatic clipboard writes are restricted.
 */
export function selectElementText(
  el: HTMLTextAreaElement | HTMLInputElement | null
): boolean {
  if (!el) return false;
  try {
    el.focus({ preventScroll: true });
    el.select();
    if (typeof el.setSelectionRange === 'function') {
      el.setSelectionRange(0, el.value.length);
    }
    return true;
  } catch {
    return false;
  }
}

function copyViaExecCommand(text: string): boolean {
  if (
    typeof document === 'undefined' ||
    !document.body ||
    typeof document.execCommand !== 'function'
  ) {
    return false;
  }

  const activeElement = document.activeElement as HTMLElement | null;
  const selection = typeof window !== 'undefined' && window.getSelection ? window.getSelection() : null;
  const savedRanges: Range[] = [];
  if (selection && selection.rangeCount > 0) {
    for (let i = 0; i < selection.rangeCount; i++) {
      savedRanges.push(selection.getRangeAt(i).cloneRange());
    }
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.setAttribute('aria-hidden', 'true');
  textarea.style.position = 'fixed';
  textarea.style.top = '0';
  textarea.style.left = '-9999px';
  textarea.style.width = '2em';
  textarea.style.height = '2em';
  textarea.style.padding = '0';
  textarea.style.border = '0';
  textarea.style.outline = 'none';
  textarea.style.boxShadow = 'none';
  textarea.style.background = 'transparent';
  textarea.style.fontSize = '16px';

  document.body.appendChild(textarea);

  let succeeded = false;
  try {
    textarea.focus({ preventScroll: true });
    textarea.select();
    if (typeof textarea.setSelectionRange === 'function') {
      textarea.setSelectionRange(0, text.length);
    }
    succeeded = document.execCommand('copy');
  } catch {
    succeeded = false;
  } finally {
    try {
      document.body.removeChild(textarea);
    } catch {
      // Ignore DOM cleanup failure
    }
    if (selection) {
      try {
        selection.removeAllRanges();
        for (const range of savedRanges) {
          selection.addRange(range);
        }
      } catch {
        // Ignore selection restore failure
      }
    }
    if (activeElement && typeof activeElement.focus === 'function') {
      try {
        activeElement.focus({ preventScroll: true });
      } catch {
        // Ignore focus restore failure
      }
    }
  }

  return succeeded;
}

/**
 * Copies text to the clipboard safely across desktop and mobile browsers without
 * prompting for extra permissions when transient user activation is intact.
 *
 * IMPORTANT: Call this synchronously when the text is already available inside
 * the click handler so `navigator.clipboard.writeText` retains user activation.
 * If the Async Clipboard API is unavailable, insecure, or rejects (e.g. iframe
 * permission policy or expired activation), falls back cleanly to `execCommand`.
 */
export async function copyTextWithFallback(text: string): Promise<ClipboardCopyResult> {
  if (!text) {
    return { ok: false, method: 'none', reason: 'empty_text' };
  }

  const hasClipboardApi =
    typeof window !== 'undefined' &&
    Boolean(window.isSecureContext) &&
    typeof navigator !== 'undefined' &&
    Boolean(navigator.clipboard) &&
    typeof navigator.clipboard.writeText === 'function';

  if (hasClipboardApi) {
    try {
      await navigator.clipboard.writeText(text);
      return { ok: true, method: 'clipboard-api' };
    } catch {
      // Fall through cleanly to DOM selection fallback
    }
  }

  if (copyViaExecCommand(text)) {
    return { ok: true, method: 'exec-command' };
  }

  return {
    ok: false,
    method: 'none',
    reason:
      hasClipboardApi || (typeof document !== 'undefined' && typeof document.execCommand === 'function')
        ? 'clipboard_blocked'
        : 'unsupported',
  };
}
