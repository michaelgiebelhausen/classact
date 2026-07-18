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
