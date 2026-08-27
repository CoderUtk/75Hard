/** Full-screen, tap-anywhere-to-dismiss image viewer. Used by Today and
 *  History. No routing — it is pure local state in the caller. */
export function PhotoOverlay({
  src, alt, onClose,
}: { src: string; alt: string; onClose: () => void }) {
  return (
    <div
      onClick={onClose}
      role="dialog"
      aria-label={alt}
      className="fixed inset-0 z-50 grid place-items-center bg-black/90 p-4"
    >
      <img src={src} alt={alt} className="max-h-full max-w-full rounded-lg" />
    </div>
  );
}
