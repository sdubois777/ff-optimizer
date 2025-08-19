export type PlayerRow = {
  Name: string;
  Pos: 'QB' | 'RB' | 'WR' | 'TE' | string;
  Price: number;
  Projection: number;

  // UI flags
  anchor?: boolean;
  exclude?: boolean;
};

export type SolutionRow = {
  Slot: string;
  Name: string;
  Pos: string;
  Price: number;
  Projection: number;
  // "PP$" is calculated by the backend
  ['PP$']?: number;
};

export type Solution = {
  players: PlayerRow[];
  total_price: number;
  total_projection: number;
};
