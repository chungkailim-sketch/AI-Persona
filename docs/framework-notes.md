# Framework notes — Next.js 16 / Prisma 7

Written from the docs bundled in `node_modules/next/dist/docs/` for the installed version, not from
memory. These are the points that change how code in this repo must be written.

## Next.js 16

| Area | Rule in this codebase |
| --- | --- |
| Request APIs | `cookies()`, `headers()`, `draftMode()` are async. `params` and `searchParams` are Promises in `page`, `layout` and `route`. Always `await`. Synchronous access was removed in 16. |
| Typed props | `npx next typegen` generates `PageProps<'/route'>`, `LayoutProps<'/route'>`, `RouteContext<'/route'>`. Use those rather than hand-written prop types. |
| Middleware | The `middleware.ts` convention is deprecated. Use `proxy.ts` exporting `proxy()`. Its runtime is Node (not Edge) and is not configurable — which is what lets session verification use `node:crypto`. |
| Typed routes | `typedRoutes: true` is on. A `<Link href>` to a route that does not exist is a **compile error**. Every navigation destination must have a route segment, even when that segment only renders `NotYetBuilt`. |
| Bundler | Turbopack is the default for `dev` and `build`. No `--turbopack` flag, and no webpack config in this project. |
| Cache | `revalidateTag(tag, profile)` now takes a cacheLife profile as a second argument. `updateTag(tag)` gives read-your-writes inside a Server Action; `refresh()` refreshes the client router. `cacheLife`/`cacheTag` are stable (no `unstable_` prefix). |
| PPR | The `experimental_ppr` segment flag is gone; PPR is now `cacheComponents`. Not enabled here. |
| Agent files | `next dev` writes `AGENTS.md`/`CLAUDE.md` at the repo root. Disabled via `agentRules: false` — this project documents itself under `docs/`. |

## Prisma 7

| Area | Rule in this codebase |
| --- | --- |
| Generator | `provider = "prisma-client"` (not `prisma-client-js`), output to `src/generated/prisma`. Import from `@/generated/prisma/client`, never from `@prisma/client`. |
| Datasource | The schema carries **no** `url`. The CLI reads it from `prisma.config.ts`; the runtime passes it to a driver adapter. |
| Driver adapter | `PrismaClient` is constructed with `new PrismaPg({ connectionString })`. There is no embedded query engine binary. |
| CLI config | `prisma.config.ts` replaces the `prisma` key in `package.json`, including the seed command. |
| Generate | `prisma migrate dev` does not always regenerate the client. Run `prisma generate` after a schema change before code that uses the new field. |

## Traps this codebase has already hit

- **CSP without a nonce breaks Next entirely.** `script-src 'self'` blocks the inline bootstrap
  script, so pages render and never hydrate. The policy is built per request in `proxy.ts` with a
  nonce and `'strict-dynamic'`. Never move it back into `next.config.ts`.
- **Client components must not import server crypto.** `src/auth/otp.ts` imports `node:crypto`;
  importing anything from it in a `'use client'` file throws during hydration and drops the page
  into the error boundary. Shared constants live in `src/auth/config.ts`.
- **Module-scope environment reads break `next build`.** The build evaluates every route module to
  collect its configuration, on a machine with no production configuration. `src/lib/prisma.ts`
  therefore constructs its client lazily behind a proxy.
- **The error boundary is accessible**, so an accessibility scan happily passes a page that threw.
  The e2e helpers assert explicitly that no page rendered it.

## Dependency decisions

- **`xlsx` (SheetJS) was removed.** The npm-registry build has an unfixed prototype-pollution and
  ReDoS advisory, and this application parses spreadsheets uploaded by users. Replaced with
  `exceljs`.
- **Transitive pins** in `package.json` `overrides`: `uuid@^11.1.1` (bounds-check fix, reached via
  `exceljs`), `deepmerge-ts@^8` and `mysql2@^3.23.1` (both reached via the Prisma CLI only).
  `npm audit` reports zero vulnerabilities with these in place; the pins should be removed once the
  upstream packages ship the fixed ranges themselves.
- **Tailwind stays on 3.4.** Tailwind 4 moves configuration into CSS and would require rewriting the
  design-token layer, with no security driver. Revisit deliberately, not incidentally.
