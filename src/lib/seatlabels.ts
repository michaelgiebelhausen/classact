export interface SeatSpec {
  label: string;
  row: number;
  col: number;
}

/** Row letters: A..Z then AA, AB... for very deep rooms. */
export function rowLetter(rowIndex: number): string {
  let n = rowIndex;
  let label = "";
  do {
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return label;
}

/**
 * Build a rows × cols seat grid. Row A is the front of the room.
 * Labels read like "A1", "B7", "AA3".
 */
export function buildSeatGrid(rows: number, cols: number): SeatSpec[] {
  if (!Number.isInteger(rows) || !Number.isInteger(cols)) {
    throw new Error("Rows and columns must be whole numbers.");
  }
  if (rows < 1 || cols < 1 || rows > 40 || cols > 40) {
    throw new Error("Rooms are limited to 1–40 rows and 1–40 seats per row.");
  }
  const seats: SeatSpec[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      seats.push({ label: `${rowLetter(r)}${c + 1}`, row: r, col: c });
    }
  }
  return seats;
}

/** Adjacent seat coordinates for peer verification (front/back/left/right). */
export function neighborCoords(row: number, col: number) {
  return {
    front: { row: row - 1, col },
    back: { row: row + 1, col },
    left: { row, col: col - 1 },
    right: { row, col: col + 1 },
  } as const;
}
