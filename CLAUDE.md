# Working on Familiens Løbeklub

Context for Claude sessions picking this project up. It is deliberately built
the same way as `athenas-mailjet-speaker` (same folder on Andreas' Mac), so the
habits from that project carry over unchanged.

## What this is

Andreas' family (Andreas 44, Maja 42, Asger 11, Johan 9, Aksel 6) logs runs;
the app ranks them on age-adjusted points. The UI is a faithful build of the
"Familiens Løbeklub" design handoff (Modernist system, Danish copy, 8 screens).
Storage: Firestore in the shared Athenas GCP project, collections
`running_members`, `running_activities`, `running_nudges`. Hosted on Cloud Run
as `family-running-stats` in `europe-west1`, deployed automatically from `main`.

## How Andreas works on it with Claude

- The repo is cloned at `~/Claude/family-running-stats` on his Mac. Claude gets
  the `~/Claude` folder connected and delete permission granted (git needs it
  for lock files), and works there through the linked computer.
- Pushes use the fine-grained token in `~/Claude/.athenas-git-credentials`
  (expires 7 December 2026) via the same `credential.helper` config as the
  speaker portal. **Never read, print or move the token.**
- Develop and test in the cloud workspace (Chromium at
  `/opt/pw-browsers/chromium`), then copy the tree to the Mac and commit there.
- Run `smoke-test.mjs` before every commit. It needs an empty store: `rm -rf data`.
- Do not `pkill -f "node server.js"` — it matches the agent's own shell and
  kills it. Use `fuser -k 3000/tcp`.
- Markdown-only pushes do not trigger a deploy (`paths-ignore` in the workflow).

## Layout

```
server.js        Routes. requireMember on everything but /api/family and /api/login.
src/stats.js     computeAll(members, activities, now) → every number on every screen.
src/nudges.js    nudgesForSave (before/after standings) + nudgesFor(member).
src/model.js     validateActivity() takes the adjustment snapshot. SEED_MEMBERS.
src/store*.js    Facade + Firestore + JSON backends, identical async API.
public/app.js    State machine mirroring the prototype's renderVals(); templates per screen.
public/styles.css  Modernist tokens + the component classes transcribed from the design.
smoke-test.mjs   Logic checks + full browser walk-through at 402×874.
```

## Decisions worth knowing

**Faithful to the design, adapted in two places.** (1) The handoff proposed
magic-link login for adults via Supabase Auth; we have no Supabase, so everyone
uses the name tile + family code that the login screen shows anyway. Admin is
`isAdmin` on the member (Andreas). (2) New members are added by an admin via
`POST /api/members`; the invite link is on the roadmap.

**`adjustmentAtLog` is sacred.** Points are computed from the snapshot on each
activity, never from the member's current adjustment. The Justering screen
promises this in copy; the smoke test asserts it.

**Stats are computed server-side, per request** (`computeAll`). A family logs
hundreds of runs a year; it is microseconds. `/api/state` returns all four
periods at once so the period switch is instant and offline-safe. Do not move
the maths to the browser.

**Weeks are ISO weeks in Europe/Copenhagen.** `process.env.TZ` is set at the
top of `server.js` and in the Dockerfile so Cloud Run (UTC) rolls the week over
at Danish midnight. Medals count only *closed* weeks; the recap shows last week,
falling back to the running week when last week was empty.

**Nudges are events, not state.** Created on save by diffing this week's
standings before/after; HALER IND fires only on the run that crosses the
5-point line, otherwise it would repeat on every run. Each member has their own
dismissed list; `about` prevents you being nudged about yourself; `pref` maps to
the three toggles. Anything older than 14 days is hidden.

**The board is live.** Every tab change and tab-visibility change refetches
`/api/state`, so a run logged on another phone shows up without a reload.

**Design fidelity rules.** Zero radius, 2px ink rules, hairline dividers, flush
left everything, tabular numerals, Danish decimal comma (`n()` in app.js),
accent red only where the design has it, body-size red text uses
`--color-accent-700`. Archivo is vendored from `@fontsource/archivo`.

## Deployment

Same WIF pattern as the speaker portal, own provider
(`github/providers/family-running-stats`, pinned to `Njilski/family-running-stats`),
same deployer service account. The workflow passes `--allow-unauthenticated`
(the app itself gates on the family code) and no env flags, so secrets attached
to the service survive deploys. Secrets: `running-family-pin`,
`running-session-secret`. One-time commands: README → Deploying.

## Conventions

Comments explain *why*, not what, and are rare. UI copy is Danish, plain, a bit
cheeky, and says what to do next. Colours only from the tokens in `styles.css`.

## Security constraints that are not negotiable

- Never handle the family code, tokens or secrets directly. Anything that
  prompts for a credential is for Andreas to type.
- Every write is scoped to `req.member`; a member logs runs only for
  themselves and edits only their own adjustment unless `isAdmin`.
- `integrations` on a member never reaches the browser (`publicMember()`).

## Status

- [x] App built to the design, smoke test green, pushed to GitHub
- [ ] WIF provider + IAM binding (README step 1–2)
- [ ] Secrets created and attached (README step 3 + attach block)
- [ ] First live deploy verified; family logs the first run
- [ ] Invite link for new members
- [ ] Push notifications / Sunday e-mail
- [ ] Strava, Apple Health imports
