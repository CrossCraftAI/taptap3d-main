import { describe, expect, it } from "vitest";
import { approvedFields, privateId, publicationQuery, registeredOrigins } from "@/lib/publication";
import { escapeHtml } from "@/lib/publication-html";
describe("publication approval boundaries", () => {
  it("copies only explicitly selected fields", () => {
    expect(approvedFields({ title: "Vessel", reserve: "8000", _source: "private" }, ["title"], {})).toEqual({ title: "Vessel" });
  });
  it("refuses restricted, carried, unknown and structured fields", () => {
    const fields = { title: "Vessel", reserve: "8000", _source: "private", nested: { private: true } };
    for (const key of ["reserve", "_source", "missing", "nested"])
      expect(() => approvedFields(fields, [key], { reserve: "house" })).toThrow();
    expect(() => approvedFields(fields, [], {})).toThrow();
  });
  it("does not interpret HTML or prototype keys", () => {
    expect(escapeHtml('<img src=x onerror="alert(1)">')).toBe('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
    expect(() => approvedFields({}, ["constructor"], {})).toThrow();
  });
  it("projects one chosen translation without exposing arbitrary nested values", () => {
    expect(approvedFields({ title: { zh: "陶器", en: "Vessel" } }, ["title"], {}, "en")).toEqual({ title: "Vessel" });
    expect(approvedFields({ title: { zh: "陶器", en: "Vessel" } }, ["title"], {}, "zh-Hant")).toEqual({ title: "陶器" });
    expect(() => approvedFields({ title: { zh: "陶器" } }, ["title"], {}, "en")).toThrow(/chosen language/);
    expect(() => approvedFields({ title: { en: "Vessel", private: "Secret" } }, ["title"], {}, "en")).toThrow();
  });
  it("accepts exact HTTPS origins and refuses credentials, wildcards and paths", () => {
    expect(registeredOrigins(["https://shop.example.com", "https://shop.example.com/"])).toEqual(["https://shop.example.com"]);
    for (const origin of ["http://shop.example.com", "https://user:password@shop.example.com", "https://shop.example.com/path", "*", "https://*.example.com"])
      expect(() => registeredOrigins([origin])).toThrow();
  });
  it("does not accept private lot ids or unknown and duplicate selectors", () => {
    expect(() => privateId("318bb23b-3806-4e5d-9752-018533713adc")).toThrow();
    for (const query of ["?tenant=a", "?locale=en&locale=zh-Hant", "?revision=", "?theme=sepia", "?locale=fr"])
      expect(() => publicationQuery(new URL(`https://example.com/${query}`), true)).toThrow();
  });
});
