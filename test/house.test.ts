import { describe, expect, it } from "vitest";
import { selectedHouse } from "@/lib/auth/house";

const houses = [{ id: "a", slug: "alpha" }, { id: "b", slug: "beta" }];
describe("house selection never grants membership", () => {
  it("does not guess between memberships", () => {
    expect(selectedHouse(houses, undefined, undefined)).toBeNull();
  });
  it("accepts a selected membership", () => {
    expect(selectedHouse(houses, "b", undefined)?.id).toBe("b");
  });
  it("refuses forged and removed memberships", () => {
    expect(selectedHouse(houses, "other", undefined)).toBeNull();
    expect(selectedHouse([houses[0]!], "b", undefined)).toBeNull();
  });
  it("a deployment pin cannot admit a nonmember", () => {
    expect(selectedHouse([houses[0]!], "a", "beta")).toBeNull();
    expect(selectedHouse(houses, "a", "beta")?.id).toBe("b");
  });
  it("a single membership needs no preference", () => {
    expect(selectedHouse([houses[0]!], undefined, undefined)?.id).toBe("a");
  });
});
