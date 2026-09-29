// Which tab of the lot record a field belongs on.
//
// ── WHY THIS IS A MODULE AND NOT A TERNARY ON THE PAGE ──────────────────────
//
// The record's four tabs partition the fields: a field is on exactly one of
// them. A partition written inline is a partition nobody can test, and the one
// interesting half of it — deciding that a column called 保留價 is money and a
// column called 委託人 is not — is a guess about somebody else's spreadsheet.
// A guess belongs somewhere it can be listed, argued with and added to.

import { normaliseHeader } from "@/lib/import/fields";

/**
 * Header spellings that mean money, normalised by `normaliseHeader`.
 *
 * ── THE SAME BARGAIN THE IMPORT MATCHER MAKES, AND FOR THE SAME REASON ──────
 *
 * `CORE_FIELDS.aliases` is deliberately generous because "a false suggestion
 * costs one click to correct, a missing one costs a person reading every
 * column". This list is generous on the same terms and the stake is lower
 * still: nothing here changes a value, a validation or a printed page. The
 * worst a wrong entry does is put a column on the Financial tab instead of the
 * Details tab, and the tab says what its rule was.
 *
 * MATCHED WHOLE, not by substring. `價` alone would be tempting and would
 * take 評價 (an appraisal note) and 定價方式 (how a price was arrived at) with
 * it, and a column of prose would arrive on a tab of numbers.
 */
export const MONEY_HEADERS: readonly string[] = [
  // Chinese, traditional and simplified, as auction houses in Hong Kong write
  // them. 估價 is the core estimate and is here too, because a house that
  // imported a second estimate column under its own header is not unusual.
  "估價",
  "估价",
  "預估價",
  "预估价",
  "保留價",
  "保留价",
  "底價",
  "底价",
  "成交價",
  "成交价",
  "落槌價",
  "落槌价",
  "起拍價",
  "起拍价",
  "售價",
  "售价",
  "價格",
  "价格",
  "佣金",
  "買家佣金",
  "賣家佣金",
  "保險價值",
  "保险价值",
  "投保金額",
  "金額",
  "金额",
  "成本",
  // English.
  "estimate",
  "lowestimate",
  "highestimate",
  "reserve",
  "reserveprice",
  "hammer",
  "hammerprice",
  "startingprice",
  "openingbid",
  "price",
  "saleprice",
  "value",
  "insurancevalue",
  "commission",
  "buyerspremium",
  "premium",
  "cost",
  "amount",
];

const MONEY = new Set(MONEY_HEADERS.map(normaliseHeader));

/**
 * Is this field money?
 *
 * The core estimate always is — it is the field the trade means by the word,
 * and it does not depend on what a spreadsheet called it, because the importer
 * has already resolved 估價 / 底價 / Est. onto the one key. Everything else is
 * the house's own column and is matched on its header.
 *
 * A carried key (`_`-prefixed) is never money. Those are the predecessor's
 * bookkeeping — `_source`, a row marker — and they never print, so grouping
 * them with the estimate would put the one field a specialist reads first
 * beside a set of values that are not values at all.
 */
export function isMoneyField(key: string): boolean {
  // `price`, not `estimate` — the core key is `price` and its label is 估價
  // (src/lib/import/fields.ts). A test asserts this, because the wrong one of
  // those two words reads perfectly and moves nothing.
  if (key === "price") return true;
  if (key.startsWith("_")) return false;
  return MONEY.has(normaliseHeader(key));
}

/**
 * Split the record's rows into the Details tab's and the Financial tab's.
 *
 * ORDER IS PRESERVED inside each half, because the order the record shows its
 * fields in is the template's order and a specialist reads down it.
 *
 * A PARTITION AND NOT TWO FILTERS OVER ONE LIST. Both halves are editable, and
 * a field appearing in two forms is a field whose two editors can show
 * different values the moment one of them is saved.
 */
export function partitionByMoney<T extends { key: string }>(
  rows: readonly T[],
): { details: T[]; financial: T[] } {
  const details: T[] = [];
  const financial: T[] = [];
  for (const row of rows) (isMoneyField(row.key) ? financial : details).push(row);
  return { details, financial };
}
