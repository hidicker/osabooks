import { nzAccountCheckDigitOk, nzAccountParts } from "@nzosa/core";
import { booksCountry } from "./country.js";

/**
 * What to ask about a New Zealand bank account number as it is typed, for a
 * supplier or an employee: null when it is fine, or not for New Zealand books.
 * Asked rather than refused: a number can be right where this cannot tell,
 * and the person can say so. A payment file still leaves out one whose check
 * digit fails (code review of 20 November, 8.2).
 */
export function nzAccountDoubt(value: string): string | null {
  const text = value.trim();
  if (text === "" || booksCountry().id !== "nz") return null;
  const parts = nzAccountParts(text);
  if (parts === null) {
    return `${text} is not a New Zealand bank account number (bank-branch-account-suffix, such as 12-3456-0123456-00), so it cannot go in a payment file.`;
  }
  if (!nzAccountCheckDigitOk(parts)) {
    return `${text}: its check digit does not match, so a digit is probably mistyped or two are swapped. A payment file would leave it out.`;
  }
  return null;
}
