"use client";

export function HousePicker({ houses, currentId }: {
  houses: readonly { id: string; name: string }[]; currentId: string | null;
}) {
  return (
    <form action="/api/auth/house" method="POST" className="flex items-center gap-1">
      <select name="orgId" aria-label="Organisation" defaultValue={currentId ?? ""}
        className="min-h-[var(--tap)] max-w-[16rem] border border-rule bg-paper px-2 text-[13px] text-ink"
        onChange={(event) => event.currentTarget.form?.requestSubmit()} required>
        <option value="" disabled>Choose your house</option>
        {houses.map((house) => <option key={house.id} value={house.id}>{house.name}</option>)}
      </select>
      <noscript><button type="submit" className="min-h-[var(--tap)] px-2 text-[13px]">Switch</button></noscript>
    </form>
  );
}
