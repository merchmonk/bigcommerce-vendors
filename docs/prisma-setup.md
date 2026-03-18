# Prisma Setup (Next.js)

This project now uses Prisma ORM for schema, migrations, and seed data.

## Structure

- `prisma/schema.prisma`
- `prisma/migrations/*/migration.sql`
- `prisma/seed.ts`
- `prisma/seeds/promostandards.ts`
- `lib/prisma.ts` (Next.js Prisma client singleton)

## Scripts

- `npm run prisma:generate`
- `npm run prisma:migrate:dev`
- `npm run prisma:migrate:deploy`
- `npm run db:seed`
- `npm run db:migrate` (deploy + seed wrapper)

## Notes

- The initial migration is create-only for an empty database.
- PromoStandards endpoint mappings are seeded through Prisma seed (`prisma/seed.ts`) and reused by runtime seeding.
