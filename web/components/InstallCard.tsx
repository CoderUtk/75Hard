import { useEffect, useState } from 'react';
import { Download, Share } from 'lucide-react';
import { installState, onInstallChange, promptInstall } from '../lib/install';

/** A dismissible-by-context install prompt: renders nothing once the app is
 *  installed or when the browser can't install it. */
export function InstallCard() {
  const [state, setState] = useState(installState);

  useEffect(() => onInstallChange(() => setState(installState())), []);

  if (state === 'installed' || state === 'unsupported') return null;

  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4">
      {state === 'prompt-ready' && (
        <button
          onClick={() => { void promptInstall(); }}
          className="display flex w-full items-center justify-center gap-2 rounded-lg
                     border border-[var(--color-primary)] py-2 text-sm text-[var(--color-primary)]"
        >
          <Download size={16} aria-hidden /> Install 75 Hard
        </button>
      )}

      {state === 'ios-safari' && (
        <p className="flex items-start gap-2 text-sm text-[var(--color-muted)]">
          <Share size={16} aria-hidden className="mt-0.5 shrink-0" />
          <span>Tap the Share button, then <b>Add to Home Screen</b>, to install 75 Hard.</span>
        </p>
      )}

      {state === 'ios-other' && (
        <p className="text-sm text-[var(--color-muted)]">
          Open <b>75hard.navalo.workers.dev</b> in Safari to install the app —
          other iPhone browsers can’t add it to the Home Screen.
        </p>
      )}

      {state === 'manual' && (
        <p className="flex items-start gap-2 text-sm text-[var(--color-muted)]">
          <Download size={16} aria-hidden className="mt-0.5 shrink-0" />
          <span>Open your browser menu and choose <b>Install app</b> (or Add to Home Screen).</span>
        </p>
      )}
    </div>
  );
}
