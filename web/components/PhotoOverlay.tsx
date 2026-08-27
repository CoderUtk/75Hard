import { useEffect } from 'react';
import { X } from 'lucide-react';

/** Full-screen, tap-anywhere-to-dismiss image viewer. Used by Today and
 *  History. No routing — it is pure local state in the caller. */
export function PhotoOverlay({
  src, alt, onClose,
}: { src: string; alt: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      className="fixed inset-0 z-50 grid place-items-center bg-black/90 p-4"
    >
      <button
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        aria-label="Close"
        autoFocus
        className="absolute right-4 top-4"
      >
        <X size={28} aria-hidden />
      </button>
      <img src={src} alt={alt} className="max-h-full max-w-full rounded-lg" />
    </div>
  );
}
