import { useRef, useState, type ChangeEvent } from 'react';
import { Camera } from 'lucide-react';
import { api, ApiError } from '../api';
import { resizeToJpeg } from '../lib/image';
import { PhotoOverlay } from './PhotoOverlay';

export function PhotoTile({
  date, hasPhoto, onChange,
}: { date: string; hasPhoto: boolean; onChange: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [full, setFull] = useState(false);
  // Bump on replace so the <img> re-requests instead of showing the cached one.
  const [v, setV] = useState(0);
  const src = `${api.photoUrl(date)}?v=${v}`;

  async function pick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // let the same file be re-picked later
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const blob = await resizeToJpeg(file);
      await api.uploadPhoto(blob);
      setV((n) => n + 1);
      onChange();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not upload the photo');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-6">
      <div className="display text-xs text-[var(--color-muted)]">Progress photo</div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={pick}
      />

      {hasPhoto ? (
        <>
          <button onClick={() => setFull(true)} className="mt-2 block w-full" aria-label="View progress photo">
            <img src={src} alt={`Progress photo for ${date}`} className="h-48 w-full rounded-xl object-cover" />
          </button>
          <button
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className="mt-2 display text-xs text-[var(--color-primary)]"
          >
            {busy ? 'Uploading…' : 'Replace'}
          </button>
        </>
      ) : (
        <button
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="mt-2 flex h-32 w-full items-center justify-center gap-2 rounded-xl
                     border border-dashed border-[var(--color-border)] text-[var(--color-muted)]"
        >
          <Camera size={18} aria-hidden />
          {busy ? 'Uploading…' : 'Add progress photo'}
        </button>
      )}

      {error && <p role="alert" className="mt-1 text-sm text-[var(--color-destructive)]">{error}</p>}

      {full && (
        <PhotoOverlay src={src} alt={`Progress photo for ${date}`} onClose={() => setFull(false)} />
      )}
    </section>
  );
}
