import { randomInt } from "crypto";

export const ROWS = 4;
export const COLS = 5;

export const MULTIPLIERS = [1, 2, 3, 5] as const;
export const BET_STEPS = [1, 2, 5, 10, 20, 50, 100] as const;

export type Multiplier = (typeof MULTIPLIERS)[number];
export type BetStep = (typeof BET_STEPS)[number];

export type SymbolId = "A" | "K" | "Q" | "J" | "S" | "H" | "D" | "C";

// Keep valueTimes100 integer to avoid float rounding drift.
// payoutCents = (ways * valueTimes100 * betCents * multiplier) / 100
export const SYMBOLS: Record<
  SymbolId,
  {
    id: SymbolId;
    // Example: 1.5 -> 150
    valueTimes100: number;
  }
> = {
  A: { id: "A", valueTimes100: 200 },
  K: { id: "K", valueTimes100: 150 },
  Q: { id: "Q", valueTimes100: 100 },
  J: { id: "J", valueTimes100: 80 },
  S: { id: "S", valueTimes100: 40 },
  H: { id: "H", valueTimes100: 40 },
  D: { id: "D", valueTimes100: 20 },
  C: { id: "C", valueTimes100: 20 },
};

const WEIGHTS: SymbolId[] = [
  "C",
  "C",
  "C",
  "D",
  "D",
  "D",
  "H",
  "H",
  "S",
  "S",
  "J",
  "J",
  "Q",
  "Q",
  "K",
  "A",
];

export type Coord = { c: number; r: number };

export type SuperAceStep = {
  multiplier: Multiplier;
  payoutCents: number;
  winningCoords: Coord[];
  gridAfter: SymbolId[][];
};

export type SuperAceSpinResult = {
  initialGrid: SymbolId[][];
  steps: SuperAceStep[];
  finalGrid: SymbolId[][];
  totalWinCents: number;
};

function getRandomIntExclusive(maxExclusive: number) {
  // randomInt's upper bound is exclusive.
  return randomInt(0, maxExclusive);
}

export function randomSymbolId() {
  const randIndex = getRandomIntExclusive(WEIGHTS.length);
  return WEIGHTS[randIndex]!;
}

export function initGrid() {
  const grid: SymbolId[][] = [];
  for (let c = 0; c < COLS; c++) {
    const col: SymbolId[] = [];
    for (let r = 0; r < ROWS; r++) {
      col.push(randomSymbolId());
    }
    grid.push(col);
  }
  return grid;
}

function hasCoord(coord: Coord, set: Set<string>) {
  return set.has(`${coord.c},${coord.r}`);
}

function evaluateWins(params: {
  grid: SymbolId[][];
  betCents: number;
  multiplier: Multiplier;
}) {
  const { grid, betCents, multiplier } = params;

  const uniqueSymbolsCol0 = new Set<SymbolId>();
  for (let r = 0; r < ROWS; r++) {
    uniqueSymbolsCol0.add(grid[0]![r]!);
  }

  let totalWinCents = 0;
  const winningCoords: Coord[] = [];

  // Check each unique symbol from left to right
  for (const symId of uniqueSymbolsCol0) {
    const colCounts = [0, 0, 0, 0, 0];
    const coordsForSymbol: Coord[] = [];

    // Count occurrences and record coordinates in each column
    for (let c = 0; c < COLS; c++) {
      let foundInCol = false;
      for (let r = 0; r < ROWS; r++) {
        if (grid[c]![r]! === symId) {
          colCounts[c] += 1;
          coordsForSymbol.push({ c, r });
          foundInCol = true;
        }
      }

      // If a column doesn't have the symbol, break the chain
      if (!foundInCol) break;
    }

    // If chain reached at least column 2 (meaning 3 columns matched: 0, 1, 2)
    if (colCounts[0] > 0 && colCounts[1] > 0 && colCounts[2] > 0) {
      // Calculate ways and how many consecutive columns matched from the left
      let ways = 1;
      let matchingCols = 0;
      for (let c = 0; c < COLS; c++) {
        if (colCounts[c] > 0) {
          ways *= colCounts[c]!;
          matchingCols += 1;
        } else {
          break;
        }
      }

      const valueTimes100 = SYMBOLS[symId]!.valueTimes100;
      // payoutCents = ways * valueTimes100 * betCents * multiplier / 100
      const payoutCents = Math.round(
        (ways * valueTimes100 * betCents * multiplier) / 100
      );

      totalWinCents += payoutCents;

      const validCoords = coordsForSymbol.filter(
        (coord) => coord.c < matchingCols
      );
      winningCoords.push(...validCoords);
    }
  }

  return { totalWinCents, winningCoords };
}

export function simulateSuperAceSpin(params: {
  betCents: number;
}): SuperAceSpinResult {
  const { betCents } = params;

  let balanceWinCents = 0;
  let currentMultiplierIndex = 0;

  let grid = initGrid();
  const initialGrid = grid.map((col) => [...col]);

  const steps: SuperAceStep[] = [];
  let hasWins = true;

  while (hasWins) {
    const multiplier = MULTIPLIERS[currentMultiplierIndex]!;
    const result = evaluateWins({ grid, betCents, multiplier });

    if (result.totalWinCents > 0) {
      balanceWinCents += result.totalWinCents;

      const winnerSet = new Set<string>(
        result.winningCoords.map((coord) => `${coord.c},${coord.r}`)
      );

      // Destroy winning cards, then shift down + fill top with new randoms
      const gridAfter: SymbolId[][] = [];
      for (let c = 0; c < COLS; c++) {
        const survivors: SymbolId[] = [];
        for (let r = 0; r < ROWS; r++) {
          if (!hasCoord({ c, r }, winnerSet)) {
            survivors.push(grid[c]![r]!);
          }
        }

        while (survivors.length < ROWS) {
          survivors.unshift(randomSymbolId());
        }
        gridAfter.push(survivors);
      }

      steps.push({
        multiplier,
        payoutCents: result.totalWinCents,
        winningCoords: result.winningCoords,
        gridAfter,
      });

      grid = gridAfter;

      if (currentMultiplierIndex < MULTIPLIERS.length - 1) {
        currentMultiplierIndex += 1;
      }
    } else {
      hasWins = false;
    }
  }

  const finalGrid = grid.map((col) => [...col]);
  return {
    initialGrid,
    steps,
    finalGrid,
    totalWinCents: balanceWinCents,
  };
}

