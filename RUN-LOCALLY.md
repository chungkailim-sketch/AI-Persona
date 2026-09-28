# Running Persona Intelligence on your laptop

Two commands, then `http://localhost:3000`.

---

## Before you start

You need two things installed. The setup script checks for both and stops with a clear message if either is missing.

| What | Why | Where |
|---|---|---|
| **Node.js 22 LTS** | Runs the application and the worker | <https://nodejs.org> |
| **Docker Desktop** | Runs PostgreSQL 16 in a container so you don't have to install a database | <https://docker.com/products/docker-desktop> |

If you already have PostgreSQL 16 on this machine, you can skip Docker — the setup script offers that path and you point `DATABASE_URL` at your own server instead.

---

## Setup — once

Open **PowerShell**, go to this folder, and run:

```powershell
.\local\setup.ps1
```

It will:

1. Check Node and Docker.
2. Start PostgreSQL on `127.0.0.1:55432` and create the three databases the app uses.
3. Ask for **your email address** — optional. The demonstration account below always exists; your own address is extra, and only addresses on an approved domain can request a code.
4. Write a `.env` with freshly generated local secrets, or add anything missing to an existing one.
5. `npm install`, apply the migrations, seed, and run the sign-in checks.

The first run takes a few minutes, almost all of it `npm install`.

> **If PowerShell refuses to run the script** — Windows blocks unsigned scripts by default. In the same window:
> ```powershell
> Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
> ```
> That lasts only for that window.

---

## Run — every time

```powershell
.\local\start.ps1
```

This starts **two** processes: the application, and the background worker that executes ingestion and simulation jobs. Both are required — without the worker, a confirmed run sits in the queue and never completes.

Then open **<http://localhost:3000>**.

Stop everything with `Ctrl+C`.

---

## Signing in

| | |
|---|---|
| **Email** | `admin@rfcomms.com` |
| **Code** | `010101` |

That account is a super administrator, so every screen including the admin section is reachable from it.

### What the demonstration account loads for you

Signing in with it once starts a background job that walks **every Mintel databook** in the folder named by `DEMO_DATASET_DIR` through the ordinary pipeline, and leaves you a project called **CBGA Outlook 2027 — demonstration** with the first three steps genuinely finished:

| | |
|---|---|
| **Source data** | 6 datasets, one per market — China, Germany, Indonesia, Mexico, Saudi Arabia, US — each a single longitudinal table covering every wave from 2024 to 2026, plus a **Mintel question index** carrying the verbatim wording. About **676,000 rows** from 29 workbooks. Ingested, profiled, governance recorded, fields reviewed. |
| **Brief** | The CBGA research question, the markets, a hypothesis, and the evidence threshold written *before* any run — including the alternative explanations that have to be ruled out. |
| **Personas** | An approved cohort of 8, built from the real demographic breaks in the source (18-24, 25-34, 35-44, 45-54, working full-time, and so on), every attribute labelled with where it came from. |

It stops there, at step 4. It does **not** start a simulation: a run costs money once a real model provider is configured, and starting one nobody asked for is the behaviour the rest of this application exists to prevent. Press the button yourself.

### If the project doesn't appear

Signing in only *queues* the work. If the project never shows up, run:

```powershell
npm run demo:load
```

That does the whole thing in the foreground — no worker, no sign-in, no queue — and prints either what it built or exactly why it couldn't. It takes a couple of minutes. Add `-- --force` to delete an existing demonstration project and build it again from scratch.

`npm run doctor` also reports the workspace now: whether the databook folder is readable and how many `.xlsx` files are in it, whether the project exists, and whether a provisioning job is pending, failed, or was never created at all.

The four things that cause it:

1. **No worker.** `start.ps1` opens a second PowerShell window for it. If that window closed or errored, the job sits at *pending* forever. `npm run demo:load` sidesteps it entirely.
2. **`DEMO_DATASET_DIR` points somewhere that no longer exists.** The doctor prints the path and the file count.
3. **The app is running older code.** It's read at boot, like `.env` — extract the new source and restart.
4. **A previous attempt failed.** That used to be permanent; it is now retried on the next sign-in, and `npm run demo:load -- --force` forces it immediately.

Three more things worth knowing:

- **It runs once.** Signing in again finds the project and does nothing, so you never get a second copy.
- **The project is flagged.** It carries `isDemo`, so the *Demonstration data* label belongs to the project itself, not only to this deployment.
- **Nothing is faked.** Every record it writes is one the application would have written anyway. The governance acknowledgements say in their own text that they were made automatically and are not a human review, so an audit read later cannot mistake them for somebody's judgement.

Mintel databooks are cross-tabs, not respondent-level files — fifty-odd sheets of toplines and demographic breaks per workbook. The adapter flattens each into one row per question, statement, response option and demographic segment, carrying that segment's own base so nothing downstream has to assume a denominator. **No respondents are invented.** The dataset is aggregate evidence and the personas built from it describe segments, never individuals.

### A standard user

Signing in with any other address does none of the above. No project, no preloaded data, no cohort — the platform behaves exactly as it does for a real user, starting at an empty Source data step. The demonstration path is gated on the address matching `DEMO_SIGN_IN_EMAIL` exactly.

Any **other** approved address gets a normal random code, **printed in the terminal window running `start.ps1`** — no email provider is configured locally. Request a code in the browser, read it off the terminal, type it in.

### Why a fixed code is safe here, and only here

A predictable sign-in code is a published password, so it is fenced in rather than trusted:

- it is **salted and scrypt-hashed before storage**, exactly like a random code — no plaintext code is written to the database in either case;
- it **expires in ten minutes** and is **capped at five attempts**, like any other code;
- it works **only for that one address** — submitting `010101` for anyone else fails;
- the application **refuses to start** when `NODE_ENV=production` and `DEMO_SIGN_IN_EMAIL` or `DEMO_SIGN_IN_CODE` is set. Not ignored — refused, at boot, with the reason printed. A fixed code that was quietly disabled in production is a configuration somebody would eventually believe was working;
- it is listed on **Settings → integrations** as *Demonstration sign-in: fixed code*, so nobody has to read the environment to discover it;
- every code request from that address is written to the audit log with the reason *fixed demonstration code*, so a log read later cannot mistake it for a real sign-in.

To turn it off, delete the two `DEMO_SIGN_IN_*` lines from `.env` and restart.

### If the code is rejected

You'll see **"That code is not valid. Request a new one if it has expired."** The message is identical for every cause — that's what stops the endpoint being used to discover which addresses exist — so don't try to read anything into it.

In development the application creates the approved domain and the account from `.env` by itself, the first time a code is requested, so there is **no seed step to forget**. That leaves only two things that can go wrong:

0. **The project never appeared.** That is provisioning, not sign-in. Check **Admin → Job queue** for a `demo_provision` job: if it is pending, the worker is not running; if it failed, the row names the reason. The most common one is `DEMO_DATASET_DIR` pointing at a folder that has moved.
1. **The app is running with an older `.env`.** The file is read once, at boot. If you edited or replaced it while the server was running, that server still has the old one. Stop it and run `.\local\start.ps1` again. This is the common one.
2. **The code expired or was already used.** Codes last ten minutes, and a successful sign-in kills every other outstanding code for that address. Request a fresh one.

If it's neither, run:

```powershell
npm run doctor
```

It checks the same preconditions the server checks, in the same order, and names the one that failed: environment, database, approved domain, account, outstanding codes, and your last few refusals from the audit log. The terminal running the app also prints the reason whenever it declines to send a code.

## Watching work happen live

The data, personas, simulation and results steps are live screens. Ingestion stages, every model
call and every run stage are recorded as they happen and streamed to the browser — nothing on those
screens moves because time passed. The mock provider answers in milliseconds, so a run can finish
before you see it; to watch one, start the worker with pacing:

```powershell
$env:MOCK_PROVIDER_DELAY_MS=300; npm run worker
```

The theme switch is the sun/moon button in the top bar; Settings → Appearance offers Light, Dark
and System. The choice is saved to your account and to this browser.

## Useful commands

| Command | What it does |
|---|---|
| `npm run dev` | Application only (no worker) |
| `npm run worker` | Worker only |
| `npm test` | 591 unit, component and integration tests |
| `npm run test:e2e` | 52 browser tests, including accessibility scans in light and dark |
| `npm run typecheck` | TypeScript, no emit |
| `npm run db:reset` | Drop everything and re-apply migrations and seed |
| `npm run doctor` | Explain why sign-in, or the demonstration workspace, is not working |
| `npm run demo:load` | Build the demonstration workspace now, in the foreground |
| `npm run demo:load -- --force` | Delete it and build it again from scratch |
| `npx prisma studio` | Browse the database in a GUI |

---

## If something goes wrong

**`prisma migrate deploy` fails** — the database isn't up. `docker compose -f local\docker-compose.yml ps` will tell you; `... up -d` starts it.

**Port 3000 is taken** — `npm run dev -- -p 3001`, and change `APP_BASE_URL` in `.env` to match. The two must agree or sign-in links point at the wrong place.

**Port 55432 is taken** — edit the port mapping in `local\docker-compose.yml` and the three URLs in `.env` together.

**A page renders but nothing responds to clicks** — that is a hydration failure, and the browser console will name the module. It is worth reporting rather than working around.

**A run stays at "queued"** — the worker isn't running. Check the second PowerShell window, or the **Job queue** screen under Admin, which shows pending, running, failed and stalled counts.
