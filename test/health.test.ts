import { afterEach, expect, it, vi } from "vitest";
const probe = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("@/db", () => ({ getDb: () => probe }));
import { GET } from "@/app/api/health/route";
import { proxy } from "@/proxy";
import { NextRequest } from "next/server";
afterEach(() => { vi.unstubAllEnvs(); probe.execute.mockReset(); });
it("a customer service fails closed when required authentication is missing", async () => {
  vi.stubEnv("TAPTAP3D_REQUIRE_AUTH", "true"); vi.stubEnv("GOOGLE_CLIENT_ID", ""); vi.stubEnv("GOOGLE_CLIENT_SECRET", "");
  expect((await GET()).status).toBe(503); expect(probe.execute).not.toHaveBeenCalled();
  expect(proxy(new NextRequest("https://beta.example.com/settings")).status).toBe(503);
  expect(proxy(new NextRequest("https://beta.example.com/embed/pub_invalid")).status).toBe(200);
});
it("an unauthenticated health response does not disclose a database error", async () => {
  vi.stubEnv("TAPTAP3D_REQUIRE_AUTH", "false");
  probe.execute.mockRejectedValue(new Error("private-host private-user private-password"));
  const response = await GET(); expect(response.status).toBe(503);
  const body = await response.text(); expect(body).not.toContain("private-");
  expect(body).toContain("Database check failed.");
});
