type LoadingSwipeOverlayProps = {
  isVisible: boolean;
};

export default function LoadingSwipeOverlay({ isVisible }: LoadingSwipeOverlayProps) {
  if (!isVisible) {
    return null;
  }

  return (
    <div className="loading-swipe-overlay" role="status" aria-live="polite">
      <div className="loading-swipe-overlay__spinner" aria-label="Loading" />
    </div>
  );
}
