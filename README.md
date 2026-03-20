# MerchMonk Vendors BigCommerce App

MerchMonk Vendors is an internal BigCommerce embedded app used to onboard vendors, synchronize supplier catalogs into BigCommerce, project the blank-product and decoration contract used by the storefront/designer, and coordinate downstream supplier order workflows.

The application runtime in this repository is a Next.js app backed by Prisma and PostgreSQL. The deployment source of truth is the sibling [`cdk-app`](../cdk-app) project, not legacy Heroku-era manifests.

## Source Of Truth

- Product direction and architecture roadmap:
  - [`docs/bigcommerce-vendors-app.md`](./docs/bigcommerce-vendors-app.md)
  - [`docs/bigcommerce-vendors-improvement-plan.md`](./docs/bigcommerce-vendors-improvement-plan.md)
- Saved implementation tranche docs:
  - [`docs/bigcommerce-vendors-foundation-tranche-implementation-plan.md`](./docs/bigcommerce-vendors-foundation-tranche-implementation-plan.md)
  - [`docs/bigcommerce-vendors-phase-0-cleanup-implementation-plan.md`](./docs/bigcommerce-vendors-phase-0-cleanup-implementation-plan.md)
- Product contract and storefront consumption guides:
  - [`docs/bigcommerce-product-contract-guide.md`](./docs/bigcommerce-product-contract-guide.md)
  - [`docs/bigcommerce-product-integration-guide.md`](./docs/bigcommerce-product-integration-guide.md)
- Infrastructure and deployment source of truth:
  - [`../cdk-app/README.md`](../cdk-app/README.md)
  - [`../cdk-app/docs/DEPLOY-SETUP.md`](../cdk-app/docs/DEPLOY-SETUP.md)

## Current Runtime Baseline

- Next.js app with pages and API routes
- Prisma ORM with PostgreSQL (`DATABASE_URL`)
- AWS-native observability, async jobs, and snapshot archival
- BigCommerce embedded-app auth/load flow
- Deployment through the sibling `cdk-app` repo to AWS infrastructure

This repository should not be treated as a Heroku, ClearDB, Firebase, or MySQL app.

## Local Development

### Prerequisites

- Node.js `>=20.9`
- npm `>=10 <12` or the repo package-manager version
- a BigCommerce draft app in the Developer Portal
- `ngrok` or another HTTPS tunnel for local callback testing
- AWS credentials with permission to read the deployed DB secret if you are using the shared Aurora/PostgreSQL environment

### 1. Install dependencies

```bash
npm install
```

### 2. Register or update the BigCommerce draft app

For local development, expose the local server over HTTPS and use the tunnel URL for these callbacks:

```text
https://<tunnel-url>/api/auth
https://<tunnel-url>/api/load
https://<tunnel-url>/api/uninstall
```

You can use `ngrok` against the default local app port:

```bash
ngrok http 3000
```

### 3. Configure environment variables

Copy the example file and fill in the values:

```bash
cp .env.example .env
```

Required variables:

- `CLIENT_ID`
- `CLIENT_SECRET`
- `ACCOUNT_UUID`
- `AUTH_CALLBACK`
- `DATABASE_URL`
- `JWT_KEY`

Supporting BigCommerce host variables already exist in the example file:

- `ENVIRONMENT`
- `LOGIN_URL`
- `API_URL`

### 4. Build `DATABASE_URL`

This app uses PostgreSQL through Prisma. In deployed environments, infrastructure and secrets are provisioned by `cdk-app`.

For local development against the shared AWS database:

1. Read the database credentials from AWS Secrets Manager.
2. Use the Aurora/proxy endpoint exposed by the `cdk-app` outputs.
3. Build a PostgreSQL connection string for `DATABASE_URL`.

The example file includes the current secret naming convention and a sample CLI command. The full deploy/bootstrap reference is in [`../cdk-app/docs/DEPLOY-SETUP.md`](../cdk-app/docs/DEPLOY-SETUP.md).

### 5. Apply migrations and seed PromoStandards mappings

For an existing deployed/shared database:

```bash
npm run prisma:migrate:deploy
npm run db:seed
```

For local schema work during development:

```bash
npm run prisma:migrate:dev
```

PromoStandards endpoint mappings are seeded through [`prisma/seed.ts`](./prisma/seed.ts). Request-time endpoint seeding has been removed from operator routes.

### 6. Start the app

```bash
npm run dev
```

## Useful Commands

```bash
npm run dev
npm run build
npm run start -p 3000
npm run test
npm run lint
npm run prisma:generate
npm run prisma:migrate:deploy
npm run db:seed
```

## Production And Deployment

Production deployment is owned by the sibling [`cdk-app`](../cdk-app) repository.

Use that repository for:

- AWS bootstrap and deployer credentials
- VPC, Aurora/PostgreSQL, RDS Proxy, CloudFront, WAF, Lambda, SQS, EventBridge, and shared platform resources
- `VendorsAppStack`, `AdminAppStack`, and shared commerce-platform infrastructure

This repository's [`app.json`](./app.json) is retained only as a legacy metadata manifest. It is not the deployment source of truth.

## Architecture Notes

- BigCommerce is the runtime product authority for storefront/designer product reads.
- MerchMonk DB stores vendor configuration, mappings, jobs, logs, and integration state, not a second operational product catalog.
- Async work runs through the job/control-plane model documented in the roadmap and ADRs.
- The formal architecture decisions for this repository now live under [`docs/adrs/`](./docs/adrs/README.md).
