export type InstallState =
  | 'installed'      // already running as an installed app
  | 'prompt-ready'   // beforeinstallprompt captured — one tap installs
  | 'ios-safari'     // iOS Safari — Share → Add to Home Screen
  | 'ios-other'      // iOS in Chrome/Firefox/etc — must switch to Safari
  | 'manual'         // Chromium, but no prompt event yet — menu instructions
  | 'unsupported';   // browser can't install (Firefox desktop, etc)

/** Pure classifier — the impure bits (display-mode, the stashed event) are
 *  passed in so this is unit-testable. */
export function classifyPlatform(
  ua: string,
  { standalone, hasPrompt }: { standalone: boolean; hasPrompt: boolean },
): InstallState {
  if (standalone) return 'installed';
  if (hasPrompt) return 'prompt-ready';

  const isIOS = /iP(hone|ad|od)/.test(ua);
  if (isIOS) {
    // On iOS every engine is WebKit; only real Safari lacks a browser token.
    const nonSafari = /(CriOS|FxiOS|EdgiOS|OPiOS|GSA)\//.test(ua);
    return nonSafari ? 'ios-other' : 'ios-safari';
  }

  // Chromium desktop/Android usually fires beforeinstallprompt; if it hasn't
  // yet (or won't), a menu instruction is the fallback.
  const isChromium = /Chrome\/|Chromium\/|Edg\//.test(ua) && !/Firefox\//.test(ua);
  return isChromium ? 'manual' : 'unsupported';
}

// --- live state + the deferred beforeinstallprompt ---------------------------

type BIPEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

let deferred: BIPEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as BIPEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    notify();
  });
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function installState(): InstallState {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  return classifyPlatform(ua, { standalone: isStandalone(), hasPrompt: deferred !== null });
}

/** Re-run `cb` whenever the install situation changes. Returns an unsubscribe. */
export function onInstallChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Fire the native install dialog. No-op unless state is 'prompt-ready'. */
export async function promptInstall(): Promise<void> {
  if (!deferred) return;
  const e = deferred;
  deferred = null;
  await e.prompt();
  await e.userChoice.catch(() => undefined);
  notify();
}
