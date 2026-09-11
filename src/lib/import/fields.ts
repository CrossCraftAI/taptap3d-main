// The canonical field set a lot is matched ONTO.
//
// Nine fields, carried from the predecessor where they were derived from a real
// client corpus rather than invented — along with two facts that corpus taught,
// both of which are easy to get wrong and expensive to get wrong:
//
//   `ref` IS A STRING AND IS NEVER PARSED AS A NUMBER. The client's own
//   identifiers are "P01", "Lot 12", "SKU-4471". Integer parsing was tried and
//   killed by exactly that.
//
//   A PRICE MAY BE A RANGE. An auction estimate is "800,000 – 1,200,000 HKD",
//   not a number. A model that assumes a point value cannot hold the common case.
//
// Anything the customer sends that is NOT one of these is kept as a custom field
// rather than discarded — the field set is theirs, not ours, and the matching
// screen's job is to propose, not to impose.

import { z } from "zod";

export const CORE_FIELD_KEYS = [
  "ref",
  "title",
  "maker",
  "date",
  "material",
  "dimensions",
  "price",
  "description",
  "images",
] as const;

export type CoreFieldKey = (typeof CORE_FIELD_KEYS)[number];

export interface FieldDefinition {
  key: CoreFieldKey;
  /** Bilingual, because the first customers work in Traditional Chinese. */
  label: { zh: string; en: string };
  /** What a specialist would recognise it by, shown under the label. */
  hint: string;
  /**
   * Header spellings seen in the wild, normalised. Used by inference as the
   * strongest signal. Deliberately generous — a false suggestion costs one
   * click to correct, a missing one costs a person reading every column.
   */
  aliases: readonly string[];
}

export const CORE_FIELDS: readonly FieldDefinition[] = [
  {
    key: "ref",
    label: { zh: "編號", en: "Reference" },
    hint: "The house's own identifier, verbatim — P01, Lot 12, SKU-4471",
    aliases: [
      "ref",
      "reference",
      "lot",
      "lotno",
      "lotnumber",
      "lotnum",
      "no",
      "number",
      "id",
      "sku",
      "code",
      "item",
      "itemno",
      "編號",
      "號",
      "拍品編號",
      "拍品號",
      "貨號",
      "序號",
      "品號",
    ],
  },
  {
    key: "title",
    label: { zh: "品名", en: "Title" },
    hint: "The work's name as it should print",
    aliases: [
      "title",
      "name",
      "work",
      "artwork",
      "itemname",
      "productname",
      "品名",
      "名稱",
      "作品",
      "作品名稱",
      "標題",
      "題目",
    ],
  },
  {
    key: "maker",
    label: { zh: "作者", en: "Maker" },
    hint: "Artist, maker, workshop or kiln",
    aliases: [
      "maker",
      "artist",
      "author",
      "creator",
      "by",
      "attributedto",
      "manufacturer",
      "workshop",
      "作者",
      "藝術家",
      "畫家",
      "作家",
      "款",
      "窯口",
      "製作者",
    ],
  },
  {
    key: "date",
    label: { zh: "年代", en: "Date" },
    hint: "Period, dynasty or year — text, not a calendar date",
    aliases: [
      "date",
      "year",
      "period",
      "era",
      "dynasty",
      "circa",
      "dated",
      "年代",
      "年份",
      "時期",
      "朝代",
      "創作年代",
    ],
  },
  {
    key: "material",
    label: { zh: "材質", en: "Material" },
    hint: "Medium, substrate and technique",
    aliases: [
      "material",
      "medium",
      "technique",
      "substrate",
      "support",
      "materials",
      "材質",
      "媒材",
      "質地",
      "材料",
      "技法",
      "形式",
    ],
  },
  {
    key: "dimensions",
    label: { zh: "尺寸", en: "Dimensions" },
    hint: "Size as written — centimetres unless the text says otherwise",
    aliases: [
      "dimensions",
      "dimension",
      "size",
      "measurements",
      "sizes",
      "hxw",
      "wxh",
      "尺寸",
      "大小",
      "規格",
      "尺幅",
    ],
  },
  {
    key: "price",
    label: { zh: "估價", en: "Estimate" },
    hint: "An estimate may be a range — 800,000–1,200,000 HKD",
    aliases: [
      "price",
      "estimate",
      "estimates",
      "value",
      "valuation",
      "reserve",
      "askingprice",
      "estimatehkd",
      "估價",
      "估值",
      "價格",
      "底價",
      "參考價",
      "預估價",
    ],
  },
  {
    key: "description",
    label: { zh: "描述", en: "Description" },
    hint: "Catalogue note, provenance, condition remarks",
    aliases: [
      "description",
      "desc",
      "notes",
      "note",
      "remarks",
      "detail",
      "details",
      "provenance",
      "condition",
      "catalogue",
      "text",
      "描述",
      "說明",
      "備註",
      "簡介",
      "來源",
      "著錄",
      "釋文",
    ],
  },
  {
    key: "images",
    label: { zh: "圖片", en: "Images" },
    hint: "Filenames or links; photographs are matched to lots by these",
    aliases: [
      "image",
      "images",
      "photo",
      "photos",
      "picture",
      "pictures",
      "file",
      "filename",
      "filenames",
      "url",
      "link",
      "links",
      "圖片",
      "圖檔",
      "照片",
      "影像",
      "檔名",
      "連結",
    ],
  },
] as const;

export const FIELD_BY_KEY: ReadonlyMap<CoreFieldKey, FieldDefinition> = new Map(
  CORE_FIELDS.map((f) => [f.key, f]),
);

/**
 * A lot's values as imported: core fields plus whatever else the customer sent.
 *
 * Everything is a STRING at this stage, deliberately. Import records what the
 * file said; interpreting "800,000–1,200,000" as a range, or a dimension as
 * centimetres, is a later and separately reviewable step. Parsing on the way in
 * is how a spreadsheet's "P01" becomes the number 1.
 */
export const importedLotSchema = z.record(z.string(), z.string());
export type ImportedLot = z.infer<typeof importedLotSchema>;

/**
 * Normalise a header for comparison: fold case, drop spaces, punctuation and
 * the full-width variants a Chinese spreadsheet is full of.
 *
 * Exported because inference and its tests must normalise identically — two
 * normalisers that drift is a bug that presents as "matching got worse".
 */
export function normaliseHeader(raw: string): string {
  return raw
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s_\-/\\.·、，,()（）[\]{}:：;；'"“”‘’]+/g, "")
    .trim();
}
