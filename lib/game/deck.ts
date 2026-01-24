export type ItemCode = "A" | "B" | "C" | "D" | "E";
export type ItemCard = { kind: "item"; code: ItemCode };
export type Card = number | ItemCard;
export type SpikeItemCount = "none" | "low" | "medium" | "high";

const addCopies = (deck: number[], value: number, count: number) => {
  for (let i = 0; i < count; i += 1) {
    deck.push(value);
  }
};

export const createSkyjoDeck = () => {
  const deck: number[] = [];
  addCopies(deck, -2, 5);
  addCopies(deck, 0, 15);
  addCopies(deck, -1, 10);
  for (let value = 1; value <= 12; value += 1) {
    addCopies(deck, value, 10);
  }
  return deck;
};

const getItemCardCopies = (count: SpikeItemCount) => {
  switch (count) {
    case "none":
      return 0;
    case "medium":
      return 2;
    case "high":
      return 3;
    case "low":
    default:
      return 1;
  }
};

export const createItemCards = (count: SpikeItemCount = "low"): ItemCard[] => {
  const codes: ItemCode[] = ["A", "B", "C", "D", "E"];
  const copies = getItemCardCopies(count);
  return codes.flatMap((code) =>
    Array.from({ length: copies }, () => ({ kind: "item", code }))
  );
};

export const shuffleDeck = <T>(cards: T[], rng: () => number = Math.random) => {
  const deck = [...cards];
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
};
