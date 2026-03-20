# BigCommerce Vendors Phase 0 Cleanup Implementation Plan

## Purpose

This document defines the execution scope for the Phase 0 baseline-reconciliation work described in [`docs/bigcommerce-vendors-improvement-plan.md`](./bigcommerce-vendors-improvement-plan.md).

It exists to lock what this cleanup tranche does and does not cover before repository-level documentation is rewritten.

## Status

Implemented

## In Scope

- reconcile top-level repository documentation with the implemented AWS/CDK/PostgreSQL architecture
- rewrite `README.md` to match the current local-development and deployment workflow
- reconcile `app.json` so it no longer implies Heroku, ClearDB, Firebase, or MySQL deployment
- document the sibling `cdk-app` project as the deployment source of truth
- add the ADR set required by the roadmap
- update supporting docs that still imply request-time PromoStandards seeding or manual PromoStandards endpoint onboarding

## Out Of Scope

- new sync, pricing, BFF, operator, or order features
- additional AWS infrastructure changes
- refactoring runtime code solely for Phase 0 cleanup
- deleting historical analysis documents that are intentionally preserved for context

## Repositories Touched

- `bigcommerce-vendors`

Referenced but not modified in this tranche:

- `cdk-app`

## Deliverables

- saved Phase 0 cleanup execution doc
- roadmap pointer to this cleanup tranche
- rewritten top-level `README.md`
- reconciled `app.json`
- ADR set covering the architecture decisions required by the roadmap
- updated setup and ETL architecture docs so they match the implemented bootstrap and onboarding behavior

## Acceptance Criteria

- repository-level setup and deployment docs no longer contradict the actual AWS/CDK/PostgreSQL runtime
- `README.md` points developers to the sibling `cdk-app` project for deployment source-of-truth details
- `app.json` no longer implies Heroku/ClearDB/Firebase/MySQL deployment assumptions
- ADRs exist for the decisions explicitly called out in the roadmap
- supporting docs no longer claim PromoStandards runtime seeding or manual PromoStandards endpoint setup in the operator form

## Progress Checklist

- [x] create the Phase 0 cleanup execution doc
- [x] add a roadmap pointer to this cleanup tranche
- [x] rewrite the top-level `README.md`
- [x] reconcile `app.json`
- [x] add ADRs for the required architecture decisions
- [x] update setup docs to reflect bootstrap-only seeding
- [x] update ETL architecture docs to reflect discovery-driven PromoStandards onboarding
- [x] review the doc set for remaining Phase 0 contradictions

## Delivered In This Tranche

- Replaced the top-level repository README with current setup guidance based on:
  - BigCommerce draft app callbacks
  - Prisma/PostgreSQL
  - AWS Secrets Manager for local DB credential discovery
  - sibling `cdk-app` deployment ownership
- Rewrote `app.json` as a legacy metadata manifest so it no longer advertises Heroku/ClearDB/Firebase/MySQL assumptions.
- Added ADRs for:
  - BigCommerce product contract strategy
  - pricing authority
  - async job model
  - BigCommerce vs MerchMonk data ownership
  - customization projection contract
  - logging and observability standards
- Updated supporting docs so they match the implemented bootstrap-only PromoStandards seeding flow and discovery-driven operator experience.

## Risks And Dependencies

- `cdk-app` remains the deployment source of truth, so future infrastructure changes there may require follow-on doc updates here
- historical analysis docs in this repository remain intentionally preserved and may describe superseded states unless marked otherwise
- local setup guidance still depends on valid AWS credentials for Secrets Manager access when using the deployed Aurora/PostgreSQL environment

## Explicit Non-Goals

- do not change runtime behavior or infrastructure in this tranche
- do not add new operator workflows beyond documentation cleanup
- do not treat this tranche as a substitute for the broader implementation roadmap

## Verification

- verified `README.md`, `app.json`, and setup docs against:
  - `package.json`
  - `.env.example`
  - `prisma/schema.prisma`
  - `prisma/seed.ts`
  - `../cdk-app/docs/DEPLOY-SETUP.md`
  - `../cdk-app/bin/cdk-app.ts`
  - `../cdk-app/lib/cdk-aurora-stack.ts`
  - `../cdk-app/lib/commerce-platform-stack.ts`
- ran repository-wide searches to confirm Phase 0 source-of-truth docs no longer advertise Heroku/ClearDB/Firebase/MySQL deployment assumptions
