export type PreloadAssetType = "image" | "audio" | "fetch";

export type PreloadAsset = {
  path: string;
  type: PreloadAssetType;
};

export const PRELOAD_PRIORITY_GROUPS: Array<{ label: string; assets: PreloadAsset[] }> = [
  {
    label: "cardbacks",
    assets: [
      { path: "/images/misty-cardback.png", type: "image" },
      { path: "/images/misty-cardback-dark.png", type: "image" },
      { path: "/images/wide.png", type: "image" },
      { path: "/images/wide-dark.png", type: "image" },
      { path: "/images/cardback.png", type: "image" },
      { path: "/images/cardback-dark.png", type: "image" },
    ],
  },
  {
    label: "card-draw-sounds",
    assets: [
      { path: "/sounds/card-draw/minus-one.wav", type: "audio" },
      { path: "/sounds/card-draw/minus-two.wav", type: "audio" },
      { path: "/sounds/card-draw/zero.wav", type: "audio" },
      { path: "/sounds/card-draw/one-nine.wav", type: "audio" },
      { path: "/sounds/card-draw/ten-eleven.wav", type: "audio" },
      { path: "/sounds/card-draw/twelve.wav", type: "audio" },
      { path: "/sounds/card-draw/reveal-trade.wav", type: "audio" },
      { path: "/sounds/card-draw/discard-to-select.wav", type: "audio" },
      { path: "/sounds/card-draw/mist-item.wav", type: "audio" },
      { path: "/sounds/card-draw/wild-item.wav", type: "audio" },
      { path: "/sounds/card-draw/mirror-item.wav", type: "audio" },
    ],
  },
  {
    label: "game-icons",
    assets: [
      { path: "/eye-icon.png", type: "image" },
      { path: "/trade-icon.svg", type: "image" },
    ],
  },
  {
    label: "notification-sounds",
    assets: [
      { path: "/sounds/notifications/your-turn.wav", type: "audio" },
      { path: "/sounds/notifications/final-turn.wav", type: "audio" },
      { path: "/sounds/notifications/hey-your-turn.wav", type: "audio" },
      { path: "/sounds/notifications/clear-row.wav", type: "audio" },
      { path: "/sounds/notifications/clear-column.wav", type: "audio" },
    ],
  },
  {
    label: "everything-else",
    assets: [
      { path: "/cards/wild.png", type: "image" },
      { path: "/cards/swap.png", type: "image" },
      { path: "/cards/mist.png", type: "image" },
      { path: "/cards/push.png", type: "image" },
      { path: "/cards/mirror.png", type: "image" },
      { path: "/sounds/theme/main-theme-loop.wav", type: "audio" },
      { path: "/sounds/theme/theme-reprised-quiet.wav", type: "audio" },
    ],
  },
];

export const CRITICAL_PRELOAD_GROUP_LABELS = new Set(["cardbacks", "card-draw-sounds"]);
