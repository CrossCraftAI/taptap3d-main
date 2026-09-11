// The importer, tested on the shapes a real client file actually takes.
//
// The fixtures below are written in the idiom of the corpus this product was
// built against — Traditional Chinese headers, "P01" references, estimates as
// ranges in HKD, a title block above the grid — because an importer tested only
// on tidy English CSV is an importer that has never met a customer.

import { describe, expect, it } from "vitest";

import { normaliseHeader } from "@/lib/import/fields";
import { inferMapping } from "@/lib/import/infer";
import { findHeaderRow, parsePastedText, parseUpload } from "@/lib/import/parse";
import writeXlsxFile from "write-excel-file/node";

const encode = (s: string): Uint8Array => new TextEncoder().encode(s);

describe("reading a file", () => {
  it("reads a plain CSV", async () => {
    const result = await parseUpload(
      encode("Lot,Title,Artist\nP01,秋山圖,張大千\nP02,墨荷,齊白石\n"),
      "lots.csv",
    );
    expect(result.kind).toBe("table");
    if (result.kind !== "table") return;
    expect(result.headers).toEqual(["Lot", "Title", "Artist"]);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toEqual(["P01", "秋山圖", "張大千"]);
  });

  it("finds the header under a title block, and says what it skipped", async () => {
    // The case that makes a naive importer greet a real spreadsheet with columns
    // called "", "" and "Untitled".
    const csv = [
      "香港宏藝拍賣　2026 秋季拍賣會",
      "",
      "編號,品名,作者,估價",
      "P01,秋山圖,張大千,800000-1200000 HKD",
      "P02,墨荷,齊白石,400000-600000 HKD",
    ].join("\n");
    const result = await parseUpload(encode(csv), "autumn.csv");
    expect(result.kind).toBe("table");
    if (result.kind !== "table") return;
    expect(result.source.headerRow).toBe(2);
    expect(result.headers).toEqual(["編號", "品名", "作者", "估價"]);
    expect(result.rows).toHaveLength(2);
    // What was ignored is kept, so the screen can show it rather than silently
    // discarding a line that might have been a lot.
    expect(result.source.skippedRows[0]?.[0]).toContain("秋季拍賣會");
  });

  it("refuses a merged banner as a header row", () => {
    // One non-empty cell is a title, not a header. Two identical cells are a
    // merged cell spilled across columns.
    expect(findHeaderRow([["Sale catalogue"], ["編號", "品名"]])).toBe(1);
    expect(findHeaderRow([["同", "同"], ["編號", "品名"]])).toBe(1);
  });

  it("pads ragged rows and names blank columns", async () => {
    const result = await parseUpload(
      encode("編號,品名,\nP01,秋山圖\nP02,墨荷,附框\n"),
      "ragged.csv",
    );
    expect(result.kind).toBe("table");
    if (result.kind !== "table") return;
    expect(result.headers).toEqual(["編號", "品名", "Column 3"]);
    // Every row is the width of the header, so nothing downstream index-checks.
    expect(result.rows.every((r) => r.length === 3)).toBe(true);
    expect(result.rows[0]).toEqual(["P01", "秋山圖", ""]);
  });

  it("takes a pasted spreadsheet selection, which arrives tab-separated", () => {
    const result = parsePastedText("編號\t品名\nP01\t秋山圖\nP02\t墨荷");
    expect(result.kind).toBe("table");
    if (result.kind !== "table") return;
    expect(result.source.format).toBe("tsv");
    expect(result.headers).toEqual(["編號", "品名"]);
    expect(result.rows).toHaveLength(2);
  });

  it("never throws — every failure is a reason and a way forward", async () => {
    const empty = await parseUpload(new Uint8Array(), "nothing.csv");
    expect(empty.kind).toBe("unreadable");
    if (empty.kind === "unreadable") {
      expect(empty.reason).toMatch(/empty/i);
      expect(empty.suggestion).toBeTruthy();
    }

    const wrongFormat = await parseUpload(encode("anything"), "report.docx");
    expect(wrongFormat.kind).toBe("unreadable");
    if (wrongFormat.kind === "unreadable") {
      // The Word case is the one most likely to arrive mid-pitch, so its
      // suggestion has to name the escape hatch explicitly.
      expect(wrongFormat.suggestion).toMatch(/paste/i);
    }

    const corrupt = await parseUpload(encode("not a spreadsheet"), "lots.xlsx");
    expect(corrupt.kind).toBe("unreadable");
    if (corrupt.kind === "unreadable") {
      expect(corrupt.suggestion).toBeTruthy();
    }
  });

  it("reads a real .xlsx, and does not turn P01 into a number", async () => {
    // The fixture is GENERATED rather than committed. A binary .xlsx in the
    // repository would trip the guard forbidding tracked spreadsheets — which
    // exists so client material cannot be committed — and weakening that guard
    // to hold a test file would be trading a real rule for a convenience.
    //
    // The assertion that matters is the second one: a spreadsheet cell holding
    // P01 must survive as the string "P01". The predecessor's corpus documented
    // integer parsing turning its references into 1, 2, 3.
    // write-excel-file v4 returns a wrapper with toBuffer/toStream/toFile; the
    // v3 `{ buffer: true }` option was removed. Passing it silently yields the
    // wrapper object, and `new Uint8Array(wrapper)` is empty — which surfaced
    // here as "the file is empty".
    const buffer = await writeXlsxFile([
      [{ value: "編號" }, { value: "品名" }, { value: "估價" }],
      [{ value: "P01" }, { value: "秋山圖" }, { value: "800,000–1,200,000 HKD" }],
      [{ value: "P02" }, { value: "墨荷" }, { value: "400,000–600,000 HKD" }],
    ]).toBuffer();

    const result = await parseUpload(new Uint8Array(buffer), "lots.xlsx");
    // Surface the reason rather than only the verdict: "expected unreadable to
    // be table" says nothing about which of a dozen things went wrong.
    if (result.kind === "unreadable") {
      throw new Error(`xlsx was unreadable: ${result.reason}`);
    }
    if (result.kind !== "table") return;
    expect(result.source.format).toBe("xlsx");
    expect(result.headers).toEqual(["編號", "品名", "估價"]);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]?.[0]).toBe("P01");
    expect(typeof result.rows[0]?.[0]).toBe("string");

    // …and it maps end to end, which is the whole journey step 3 to step 4.
    const suggestions = inferMapping(result.headers, result.rows);
    expect(suggestions.map((s) => s.suggested)).toEqual(["ref", "title", "price"]);
  });

  it("skips a cover sheet and names the sheets it did not use", async () => {
    // A workbook whose first tab is a cover page, terms, or a blank template is
    // ordinary. Taking sheet one unconditionally would report "no data" on a
    // file that is full of lots.
    // Multiple sheets take an array of { data, sheet } objects — not a data
    // array plus a names option.
    const buffer = await writeXlsxFile([
      { sheet: "封面", data: [[{ value: "2026 秋季拍賣會" }]] },
      {
        sheet: "拍品",
        data: [
          [{ value: "編號" }, { value: "品名" }],
          [{ value: "P01" }, { value: "秋山圖" }],
          [{ value: "P02" }, { value: "墨荷" }],
        ],
      },
    ]).toBuffer();

    const result = await parseUpload(new Uint8Array(buffer), "sale.xlsx");
    if (result.kind === "unreadable") {
      throw new Error(`xlsx was unreadable: ${result.reason}`);
    }
    if (result.kind !== "table") return;
    expect(result.source.sheetName).toBe("拍品");
    expect(result.rows).toHaveLength(2);
    // The unused sheets are named rather than silently dropped, so a person can
    // be offered them instead of wondering where their lots went.
    expect(result.source.otherSheets).toContain("封面");
  });

  it("headers with no data beneath them are unreadable, not an empty table", async () => {
    const result = await parseUpload(encode("編號,品名,作者\n"), "headers.csv");
    expect(result.kind).toBe("unreadable");
  });
});

describe("normalising a header", () => {
  it("folds case, width, spacing and punctuation", () => {
    expect(normaliseHeader("Lot No.")).toBe(normaliseHeader("lot_no"));
    expect(normaliseHeader("Estimate (HKD)")).toBe(normaliseHeader("estimatehkd"));
    // Full-width characters are what a Chinese spreadsheet is full of.
    expect(normaliseHeader("編　號")).toBe("編號");
  });
});

describe("suggesting a mapping", () => {
  const chinese = {
    headers: ["編號", "品名", "作者", "年代", "材質", "尺寸", "估價", "說明", "圖檔"],
    rows: [
      [
        "P01",
        "秋山圖",
        "張大千",
        "1968",
        "設色紙本",
        "96 x 45 cm",
        "800,000–1,200,000 HKD",
        "民國五十七年作，鈐印二方，上款人為作者友人，來源：香港私人收藏，得自藝術家本人",
        "P01.jpg",
      ],
      [
        "P02",
        "墨荷",
        "齊白石",
        "1943",
        "水墨紙本",
        "103 x 34 cm",
        "400,000–600,000 HKD",
        "題識：白石老人八十三歲作於京華，鈐印一方，著錄於《齊白石全集》第三卷",
        "P02.jpg",
      ],
      [
        "P03",
        "竹石人物圖",
        "張大千",
        "1945",
        "設色紙本",
        "134 x 67 cm",
        "1,500,000–2,000,000 HKD",
        "乙酉年作，款識完整，曾經香港蘇富比一九九八年春季拍賣，來源顯赫",
        "P03.jpg",
      ],
    ],
  };

  it("maps a Traditional Chinese sheet from its headers", () => {
    const suggestions = inferMapping(chinese.headers, chinese.rows);
    const byHeader = Object.fromEntries(
      suggestions.map((s) => [s.header, s.suggested]),
    );
    expect(byHeader["編號"]).toBe("ref");
    expect(byHeader["品名"]).toBe("title");
    expect(byHeader["作者"]).toBe("maker");
    expect(byHeader["年代"]).toBe("date");
    expect(byHeader["材質"]).toBe("material");
    expect(byHeader["尺寸"]).toBe("dimensions");
    expect(byHeader["估價"]).toBe("price");
    expect(byHeader["說明"]).toBe("description");
    expect(byHeader["圖檔"]).toBe("images");
  });

  it("explains every suggestion it makes", () => {
    // A confidence number without a reason is not an explanation, and the person
    // clearing the mapping is deciding whether to trust it.
    for (const s of inferMapping(chinese.headers, chinese.rows)) {
      expect(s.reason.length).toBeGreaterThan(10);
    }
  });

  it("maps English headers with decoration", () => {
    const suggestions = inferMapping(
      ["Lot No.", "Title", "Artist", "Estimate (HKD)", "Image File"],
      [["P01", "Autumn Mountains", "Zhang Daqian", "800,000-1,200,000", "p01.jpg"]],
    );
    expect(suggestions.map((s) => s.suggested)).toEqual([
      "ref",
      "title",
      "maker",
      "price",
      "images",
    ]);
  });

  it("infers from values when the headers are useless", () => {
    // The real reason this screen exists: an export with no header row, or one
    // whose headers are Column1..Column5.
    const suggestions = inferMapping(
      ["Column 1", "Column 2", "Column 3", "Column 4"],
      [
        ["P01", "96 x 45 cm", "800,000–1,200,000 HKD", "P01.jpg"],
        ["P02", "103 x 34 cm", "400,000–600,000 HKD", "P02.jpg"],
        ["P03", "134 x 67 cm", "1,500,000–2,000,000 HKD", "P03.jpg"],
      ],
    );
    const byColumn = suggestions.map((s) => s.suggested);
    expect(byColumn[0]).toBe("ref");
    expect(byColumn[1]).toBe("dimensions");
    expect(byColumn[2]).toBe("price");
    expect(byColumn[3]).toBe("images");
  });

  it("gives one field to one column, and says who was outranked", () => {
    // Two estimate columns is the common real case — a low and a high — and
    // silently mapping both would make the second overwrite the first.
    const suggestions = inferMapping(
      ["編號", "估價下限", "估價上限"],
      [
        ["P01", "800,000 HKD", "1,200,000 HKD"],
        ["P02", "400,000 HKD", "600,000 HKD"],
      ],
    );
    const priced = suggestions.filter((s) => s.suggested === "price");
    expect(priced).toHaveLength(1);

    const loser = suggestions.find(
      (s) => s.suggested === null && s.header.startsWith("估價"),
    );
    expect(loser?.reason).toMatch(/outranked|another column/i);
    // …and it still offers price as an alternative, so one click fixes it.
    expect(loser?.alternatives).toContain("price");
  });

  it("says it does not know rather than guessing", () => {
    const suggestions = inferMapping(
      ["倉位"],
      [["A-12"], ["B-04"], ["C-77"]],
    );
    const only = suggestions[0]!;
    // A warehouse location is not a core field, and inventing one for it would
    // put shelf numbers in the catalogue.
    if (only.suggested === null) {
      expect(only.reason).toMatch(/no confident match|custom field/i);
    } else {
      // If shape inference did claim it, the confidence must be low enough that
      // the screen shows it as a guess rather than an answer.
      expect(only.confidence).toBeLessThan(0.8);
    }
  });
});
