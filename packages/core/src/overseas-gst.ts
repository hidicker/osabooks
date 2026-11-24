/**
 * Overseas businesses known to charge New Zealand GST.
 *
 * An overseas supplier registered for NZ GST charges 15% on remote services
 * (software, streaming, advertising) and on low-value goods it sends here --
 * unless the customer has given it a GST number, when it charges none. Most
 * businesses have not, so for these the starting rate is 15%.
 *
 * Kept short on purpose, and checked by hand: only very large businesses
 * where charging NZ GST is well established. IRD publishes no list of who is
 * registered, and a long list of guesses would put them into GST returns as
 * if they were facts. Anything not here is left to the receipt -- and the
 * person's own coding always comes first.
 *
 * Names are the known-business list's own (nz-businesses.ts), so a line is
 * matched the way that list already matches it.
 */
const CHARGES_NZ_GST = new Set([
  // Software and cloud
  "Microsoft",
  "Google Workspace",
  "Google Cloud",
  "Google One",
  "Google Play",
  "Apple",
  "Adobe",
  "Dropbox",
  "Zoom",
  "Amazon Web Services",
  // Advertising
  "Google Ads",
  "Facebook",
  "LinkedIn",
  // Streaming
  "Netflix",
  "Spotify",
  "Disney Plus",
  "YouTube",
  "Amazon Prime",
  "Apple Music",
  // Low-value goods sent here
  "Amazon",
  "AliExpress",
  "Temu",
  "Shein",
  "eBay",
]);

/**
 * Whether a known business is one that charges NZ GST, by its name on the
 * known-business list. False means only "not known", never "does not".
 */
export function chargesNzGst(businessName: string): boolean {
  return CHARGES_NZ_GST.has(businessName);
}

/** The names on the list, for checking them against the known-business list. */
export function overseasGstNames(): string[] {
  return [...CHARGES_NZ_GST];
}
