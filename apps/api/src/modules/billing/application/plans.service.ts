import { Inject, Injectable } from "@nestjs/common";

import type { ActorContext } from "../../../common/actor.js";
import { CATALOG_LOOKUP, type CatalogLookup } from "../../catalog/catalog.contract.js";
import {
  ExamNotFound,
  InvalidPlanTransition,
  PlanContentInvalid,
  PlanFieldsLocked,
  PlanNotFound,
  PlanNotSellable,
} from "../domain/billing.errors.js";
import { isSupportedCurrency, minimumSellablePriceMinor } from "../domain/money.js";
import { canTransitionPlan, type PlanStatus } from "../domain/plan-lifecycle.js";
import { contentProblems, lockedFields, type PlanContent } from "../domain/plan-rules.js";
import { BILLING_STORE, type BillingStore, type Plan } from "../domain/ports.js";

export type NewPlan = PlanContent & { code: string; currency: string };

export type PlanChanges = Partial<PlanContent>;

/** A plan as the pricing page lists it: with the names of the exams it unlocks. */
export interface PlanOffer {
  plan: Plan;
  exams: { id: string; code: string; nameAr: string }[];
}

/**
 * Plans: what a student can buy. A plan unlocks one exam, or several for a
 * bundle (the Product Owner's four packages, 2026-11-16: one per exam plus
 * one covering all of them). Which exams those are is data, never code.
 */
@Injectable()
export class PlansService {
  constructor(
    @Inject(BILLING_STORE) private readonly store: BillingStore,
    @Inject(CATALOG_LOOKUP) private readonly catalog: CatalogLookup,
  ) {}

  listAll(filter: { examId?: string }): Promise<Plan[]> {
    return this.store.listPlans(filter);
  }

  /** Every plan a student can buy now, in display order. */
  async catalogForSale(): Promise<PlanOffer[]> {
    const active = new Map((await this.catalog.activeExams()).map((exam) => [exam.id, exam]));
    const plans = await this.store.listPlans({ status: "ACTIVE" });
    return plans.flatMap((plan) => {
      const exams = plan.examIds.map((id) => active.get(id));
      // A bundle is on sale only while every exam in it is: it must deliver all it promises.
      if (exams.length === 0 || exams.some((exam) => exam === undefined)) return [];
      return [{ plan, exams: exams as PlanOffer["exams"] }];
    });
  }

  /** Plans on sale that unlock this exam: its own, and the bundles that include it. */
  async listForSale(examId: string): Promise<PlanOffer[]> {
    return (await this.catalogForSale()).filter((offer) => offer.plan.examIds.includes(examId));
  }

  async create(input: NewPlan): Promise<Plan> {
    assertValidContent(input);
    await this.assertExamsExist(input.examIds);
    return this.store.createPlan(input);
  }

  async update(planId: string, changes: PlanChanges, actor: ActorContext): Promise<Plan> {
    if (changes.examIds !== undefined) await this.assertExamsExist(changes.examIds);
    const updated = await this.store.updatePlan(
      planId,
      (current) => {
        const locked = lockedFields(current.status, changes);
        if (locked.length > 0) throw new PlanFieldsLocked(current.status, locked);
        const next = { ...contentOf(current), ...changes };
        assertValidContent(next);
        // On sale, a price must stay one the provider can charge — the same floor as activation.
        if (current.status === "ACTIVE") assertSellablePrice(next.priceMinor, current.currency);
        return changes;
      },
      actor,
    );
    if (!updated) throw new PlanNotFound();
    return updated;
  }

  async activate(planId: string, actor: ActorContext): Promise<Plan> {
    const plan = await this.requirePlan(planId);
    this.assertTransition(plan.status, "ACTIVE");

    assertSellablePrice(plan.priceMinor, plan.currency);
    if (plan.examIds.length === 0) throw new PlanNotSellable("The plan unlocks no exam.");
    for (const examId of plan.examIds) {
      if ((await this.catalog.examStatus(examId)) === "ARCHIVED") {
        throw new PlanNotSellable("An exam of this plan is archived.");
      }
    }
    return this.transition(plan, "ACTIVE", actor);
  }

  async retire(planId: string, actor: ActorContext): Promise<Plan> {
    const plan = await this.requirePlan(planId);
    this.assertTransition(plan.status, "RETIRED");
    return this.transition(plan, "RETIRED", actor);
  }

  private async assertExamsExist(examIds: readonly string[]): Promise<void> {
    for (const examId of examIds) {
      const status = await this.catalog.examStatus(examId);
      if (status === null || status === "ARCHIVED") throw new ExamNotFound();
    }
  }

  private async requirePlan(planId: string): Promise<Plan> {
    const plan = await this.store.findPlan(planId);
    if (!plan) throw new PlanNotFound();
    return plan;
  }

  private assertTransition(from: PlanStatus, to: PlanStatus): void {
    if (!canTransitionPlan(from, to)) throw new InvalidPlanTransition(from, to);
  }

  private async transition(plan: Plan, to: PlanStatus, actor: ActorContext): Promise<Plan> {
    const moved = await this.store.transitionPlan(plan.id, plan.status, to, actor);
    // Someone else moved the plan between our read and our write.
    if (!moved) throw new InvalidPlanTransition(plan.status, to);
    return moved;
  }
}

function contentOf(plan: Plan): PlanContent {
  return {
    name: plan.name,
    description: plan.description,
    features: plan.features,
    highlighted: plan.highlighted,
    sortOrder: plan.sortOrder,
    priceMinor: plan.priceMinor,
    compareAtPriceMinor: plan.compareAtPriceMinor,
    durationDays: plan.durationDays,
    examIds: plan.examIds,
  };
}

function assertSellablePrice(priceMinor: number, currency: string): void {
  if (!isSupportedCurrency(currency)) {
    throw new PlanNotSellable(`Plans cannot be sold in ${currency} yet.`);
  }
  if (priceMinor < minimumSellablePriceMinor(currency)) {
    throw new PlanNotSellable("The price is below the minimum the payment provider accepts.");
  }
}

function assertValidContent(content: PlanContent): void {
  const problems = contentProblems(content);
  if (problems.length > 0) throw new PlanContentInvalid(problems);
}
