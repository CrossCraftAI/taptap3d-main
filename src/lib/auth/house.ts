/** A preference, never a credential: membership is checked on every request. */
export const HOUSE_COOKIE = "taptap3d_house";

export function selectedHouse<T extends { id: string; slug: string }>(
  houses: readonly T[], selected: string | undefined, pinned: string | undefined,
): T | null {
  if (pinned) return houses.find((house) => house.slug === pinned) ?? null;
  if (selected) return houses.find((house) => house.id === selected) ?? null;
  return houses.length === 1 ? houses[0]! : null;
}
