import { afterEach, describe, expect, it, vi } from "vitest";

import type { AdminExam } from "../src/lib/admin-api";
import { listMyPayments, listPlanCatalog } from "../src/lib/api";
import {
  getRevenueSummary,
  grantEntitlement,
  listAdminPayments,
  lookupStudent,
  updatePlan,
} from "../src/lib/billing-admin-api";
import {
  durationText,
  fromMinorUnits,
  grantFormSchema,
  planFormSchema,
  SUGGESTED_FEATURES,
  toDurationDays,
  toMinorUnits,
  toOptionalMinorUnits,
} from "../src/lib/billing-form";
import { BUNDLE_CODE, starterPlans } from "../src/lib/starter-plans";

afterEach(() => vi.unstubAllGlobals());

const form = (overrides: Record<string, unknown> = {}) => ({
  examIds: ["e1"],
  code: "qudurat-90",
  name: "باقة",
  description: "",
  features: "",
  highlighted: false,
  sortOrder: "0",
  price: "199",
  compareAtPrice: "",
  durationDays: "90",
  ...overrides,
});

describe("plan form", () => {
  it("converts riyals to halalas without floating point drift", () => {
    expect(toMinorUnits("199")).toBe(19900);
    expect(toMinorUnits("0.1")).toBe(10);
    expect(toMinorUnits("19.99")).toBe(1999);
    expect(fromMinorUnits(19900)).toBe("199");
    expect(fromMinorUnits(1999)).toBe("19.99");
    expect(fromMinorUnits(1905)).toBe("19.05");
    expect(toOptionalMinorUnits("")).toBeNull();
  });

  it("accepts Arabic-Indic digits and upper-cases the code", () => {
    const parsed = planFormSchema.parse(form({ price: "١٩٩٫٥", durationDays: "٩٠" }));
    expect(parsed).toMatchObject({ code: "QUDURAT-90", price: "199.5", durationDays: "90" });
    expect(toMinorUnits(parsed.price)).toBe(19950);
    expect(toDurationDays(parsed.durationDays)).toBe(90);
  });

  it("reads features one per line, dropping blank lines", () => {
    const parsed = planFormSchema.parse(form({ features: "  أ  \n\nب\r\n" }));
    expect(parsed.features).toEqual(["أ", "ب"]);
    expect(
      planFormSchema.safeParse(form({ features: Array(13).fill("ميزة").join("\n") })).success,
    ).toBe(false);
  });

  it("needs an exam, and a 'was' price above the price", () => {
    expect(planFormSchema.safeParse(form({ examIds: [] })).success).toBe(false);
    expect(planFormSchema.safeParse(form({ compareAtPrice: "199" })).success).toBe(false);
    expect(planFormSchema.safeParse(form({ compareAtPrice: "249" })).success).toBe(true);
  });

  it("treats an empty duration as access without an end, and rejects nonsense", () => {
    expect(
      toDurationDays(grantFormSchema.parse({ examId: "e1", durationDays: "" }).durationDays),
    ).toBeNull();
    expect(grantFormSchema.safeParse({ examId: "e1", durationDays: "0" }).success).toBe(false);
    expect(planFormSchema.safeParse(form({ price: "1.234", durationDays: "" })).success).toBe(
      false,
    );
  });

  it("words durations in Arabic", () => {
    expect(durationText(null)).toBe("بلا نهاية");
    expect(durationText(1)).toBe("يوم واحد");
    expect(durationText(7)).toBe("7 أيام");
    expect(durationText(90)).toBe("90 يومًا");
  });
});

describe("starter package set", () => {
  const exam = (id: string, code: string, nameAr: string): AdminExam => ({
    id,
    code,
    slug: code.toLowerCase(),
    nameAr,
    nameEn: null,
    description: null,
    status: "ACTIVE",
    createdAt: "2026-11-16T00:00:00Z",
  });
  const exams = [
    exam("q", "QUDURAT", "القدرات"),
    exam("t", "TAHSILI", "التحصيلي"),
    exam("s", "STEP", "STEP"),
  ];

  it("makes one plan per exam and one bundle of all, from the exams that exist", () => {
    const plans = starterPlans(exams, {
      perExam: { q: 19_900, t: 19_900, s: 14_900 },
      bundle: 39_900,
      durationDays: 365,
    });
    expect(plans.map((plan) => plan.code)).toEqual([
      "QUDURAT-PLAN",
      "TAHSILI-PLAN",
      "STEP-PLAN",
      BUNDLE_CODE,
    ]);
    const bundle = plans.at(-1);
    expect(bundle).toMatchObject({
      examIds: ["q", "t", "s"],
      priceMinor: 39_900,
      // Cheaper than buying the three: the sum is shown struck through.
      compareAtPriceMinor: 54_700,
      highlighted: true,
      durationDays: 365,
    });
    expect(plans[0]?.features).toEqual([...SUGGESTED_FEATURES]);
  });

  it("shows no 'was' price on a bundle that is not cheaper, and none for a single exam", () => {
    const [onlyBundle] = starterPlans(exams, {
      perExam: { q: 100, t: 100, s: 100 },
      bundle: 500,
      durationDays: null,
    }).slice(-1);
    expect(onlyBundle?.compareAtPriceMinor).toBeNull();
    expect(
      starterPlans(exams.slice(0, 1), { perExam: { q: 100 }, bundle: 0, durationDays: 30 }),
    ).toHaveLength(1);
  });
});

describe("billing clients", () => {
  it("calls the billing routes", async () => {
    const request = vi
      .fn()
      .mockImplementation(async () => Response.json({ items: [], next: null }));
    vi.stubGlobal("fetch", request);
    await lookupStudent("a+b@x.com");
    await updatePlan("p1", { priceMinor: 100 });
    await grantEntitlement({ studentId: "s1", examId: "e1", durationDays: null });
    await listAdminPayments({ status: "SUCCEEDED", cursor: "abc" });
    await getRevenueSummary(30);
    await listPlanCatalog();
    await listMyPayments();
    expect(request.mock.calls.map(([url, init]) => [url, init.method])).toEqual([
      ["/api/v1/admin/students/lookup?identifier=a%2Bb%40x.com", "GET"],
      ["/api/v1/admin/plans/p1", "PATCH"],
      ["/api/v1/admin/entitlements", "POST"],
      ["/api/v1/admin/payments?limit=25&status=SUCCEEDED&cursor=abc", "GET"],
      ["/api/v1/admin/billing/summary?days=30", "GET"],
      ["/api/v1/plans", "GET"],
      ["/api/v1/me/payments", "GET"],
    ]);
  });
});
