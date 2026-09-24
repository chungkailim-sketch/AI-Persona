# RF Persona Intelligence

Evidence-grounded AI persona simulation and decision support. This repository implements the PRD in
`../prd/prd.md` following the phased plan in `../plan/plan.md`.

## Running locally

```bash
npm install
cp .env.example .env          # then fill in DATABASE_URL and SESSION_SECRET
npx prisma migrate dev        # creates the schema
npx prisma db seed            # approved domains, first admin, safety controls
npm run dev
```

`MODEL_PROVIDER=mock` is the default. The application runs end to end with no AI key, no email
provider and no object storage — every one of those has a development adapter, and the home page
states which adapter is active for each. Production refuses the development adapters at boot rather
than degrading silently.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` | Production build, including a full TypeScript check |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run test` | Unit and integration tests (Vitest) |
| `npm run test:e2e` | Browser tests (Playwright), including axe accessibility checks |
| `npm run db:migrate` | Create and apply a migration |
| `npm run db:seed` | Idempotent bootstrap seed |
| `npm run worker` | Background job worker |
| `npm run traceability` | Regenerate the requirement traceability matrix |

## Health

`GET /api/health` returns `ok`, `degraded` or `error` with a per-check breakdown for configuration
and database reachability. A degraded response carries HTTP 503 so a platform health check fails
rather than routing traffic to a half-configured instance.

## What is not built yet

Navigation destinations that are not yet functional render an explicit
"Not available in this build" panel naming the phase that delivers them and what they will do. No
screen is filled with illustrative data to look finished. See `src/ui/BuildStatus.tsx`.

## Further reading

- `docs/framework-notes.md` — Next 16 and Prisma 7 rules this codebase must follow
- `docs/phase-status.md` — what each build phase has delivered and verified
