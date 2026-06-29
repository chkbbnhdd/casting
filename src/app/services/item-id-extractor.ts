import { Injectable } from '@angular/core';

/**
 * Extracts the DR TV numeric item ID from a page API response or URL path.
 *
 * Three strategies are tried in order:
 * 1. `pageItem.id` — direct ID field on the response item.
 * 2. `pageItem.scopes[]` — first entry that is a numeric string.
 * 3. Path pattern `/_<digits>$` — trailing numeric segment in the content path.
 *
 * Returns `null` if none of the strategies yield an ID.
 */
@Injectable({ providedIn: 'root' })
export class ItemIDExtractor {
  /**
   * Attempts to extract a numeric item ID using the three strategies above.
   *
   * @param path     - Normalised content path (e.g. `/program/title_12345678`).
   * @param pageItem - `item` object from the first page API entry, or `null`.
   * @returns Numeric item ID string, or `null` if unresolvable.
   */
  extract(path: string, pageItem: any): string | null {
    // Try direct ID from response
    const directId = pageItem?.id;
    if (typeof directId === 'string' && directId.trim()) {
      return directId;
    }

    // Try scoped ID from response
    const scopes = pageItem?.scopes;
    if (Array.isArray(scopes)) {
      const scopedId = scopes.find(
        (scope: unknown) => typeof scope === 'string' && /^\d+$/.test(scope)
      );
      if (typeof scopedId === 'string') {
        return scopedId;
      }
    }

    // Try extracting from URL path pattern
    const pathMatch = path.match(/_(\d+)$/);
    return pathMatch?.[1] ?? null;
  }
}
