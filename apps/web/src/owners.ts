import { ownersOver } from "@nzosa/core";
import type { Entity, Owner } from "@nzosa/core";
import { taxYearEnd, taxYearStart } from "./tax-year.js";

/**
 * The owners' shares across a tax year. A change of shares part-way through
 * counts each share for the days it was in force, so a year before the change
 * keeps the shares it had.
 */
export function ownersInYear(entity: Entity, year: number): Owner[] {
  return ownersOver(entity, taxYearStart(year), taxYearEnd(year));
}

/** One owner's share of an entity across a tax year, as a percentage (0 when none). */
export function percentInYear(entity: Entity, owner: string, year: number): number {
  return ownersInYear(entity, year).find((o) => o.name.trim() === owner.trim())?.percent ?? 0;
}
