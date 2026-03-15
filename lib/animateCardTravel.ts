import { cardTravelMs, standardEase } from "./motion";

export type AnimateCardTravelOptions = {
  sourceElement: HTMLElement | null;
  destinationElement: HTMLElement | null;
  durationMs?: number;
  easing?: string;
  initialOpacity?: number;
  finalOpacity?: number;
};

const DEFAULT_DURATION_MS = cardTravelMs;
const DEFAULT_EASING = standardEase;

const measureRect = (element: HTMLElement | null) => {
  if (!element) {
    return null;
  }

  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    return null;
  }

  return rect;
};

export const animateCardTravel = async ({
  sourceElement,
  destinationElement,
  durationMs = DEFAULT_DURATION_MS,
  easing = DEFAULT_EASING,
  initialOpacity = 0.98,
  finalOpacity = 1,
}: AnimateCardTravelOptions): Promise<void> => {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return;
  }

  const sourceRect = measureRect(sourceElement);
  const destinationRect = measureRect(destinationElement);

  if (!sourceRect || !destinationRect || !sourceElement) {
    return;
  }

  const movingCard = sourceElement.cloneNode(true) as HTMLElement;
  movingCard.setAttribute("aria-hidden", "true");
  movingCard.style.position = "fixed";
  movingCard.style.left = `${destinationRect.left}px`;
  movingCard.style.top = `${destinationRect.top}px`;
  movingCard.style.width = `${destinationRect.width}px`;
  movingCard.style.height = `${destinationRect.height}px`;
  movingCard.style.margin = "0";
  movingCard.style.pointerEvents = "none";
  movingCard.style.zIndex = "9999";
  movingCard.style.transformOrigin = "top left";
  movingCard.style.willChange = "transform, opacity";

  document.body.appendChild(movingCard);

  const deltaX = sourceRect.left - destinationRect.left;
  const deltaY = sourceRect.top - destinationRect.top;
  const scaleX = sourceRect.width / destinationRect.width;
  const scaleY = sourceRect.height / destinationRect.height;

  const animation = movingCard.animate(
    [
      {
        transform: `translate(${deltaX}px, ${deltaY}px) scale(${scaleX}, ${scaleY})`,
        opacity: initialOpacity,
      },
      {
        transform: "translate(0px, 0px) scale(1, 1)",
        opacity: finalOpacity,
      },
    ],
    {
      duration: Math.max(0, durationMs),
      easing,
      fill: "both",
    }
  );

  await new Promise<void>((resolve) => {
    const cleanup = () => {
      movingCard.remove();
      resolve();
    };

    animation.addEventListener("finish", cleanup, { once: true });
    animation.addEventListener("cancel", cleanup, { once: true });
  });
};
