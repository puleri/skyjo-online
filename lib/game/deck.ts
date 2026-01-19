export type ItemCard = "A" | "B" | "C" | "D" | "E";
export type Card = number | ItemCard;

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

export const createItemCards = (): ItemCard[] => ["A", "B", "C", "D", "E"];

export const shuffleDeck = <T>(cards: T[], rng: () => number = Math.random) => {
  const deck = [...cards];
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
};
