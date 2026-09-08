# Working on Family Running Stats

Context for Claude sessions picking this project up. It is deliberately built
the same way as `athenas-mailjet-speaker` (same folder on Andreas' Mac), so the
habits from that project carry over unchanged.

## What this is

Andreas' family logs runs; the page shows the stats. Public read, one shared
family password to edit. Storage: Firestore in the shared Athenas GCP project,
collections `running_members` and `running_runs`. Hosted on Cloud Run as
`family-running-stats` in `europe-west1`, deployed automatically from `main`.

## How Andreas works on it with Claude

- The repo is cloned at `~/Claude/family-running-stats` on his Mac. Claude gets
  the `~/Claude` folder connected and delete permission granted (git needs it
  for lock files), and works there through the linked computer.
- Pushes use the fine-grained token in `~/Claude/.athenas-git-credentials`
  (expires 7 December 2026) via the same `credential.helper` config as the
  speaker portal. **Never read, print or move the token.** If a push is
  refused with 403, the token probably lacks access to this repo — that is for
  Andreas to fix in GitHub settings, not for Claude to work around.
- Run `smoke-test.mjs` before every commit. It needs Chromium; in the cloud
  workspace that is `CHROMIUM=/opt/pw-browsers/chromium`. It also needs an
  empty store: `rm -rf data` first.
- Do not `pkill -f "node server.js"` — it matches the agent's own shell and
  kills it. Use `fuser -k 3000/tcp`.
- Markdown-only pushes do not trigger a deploy (`paths-ignore` in the workflow).

## Layout

```
server.js               Routes. requireEdit guards every write.
src/stats.js            All derived numbers. Pure: (members, runs, today) → stats.
src/model.js            validateRun() — the only place a run's shape is decided.
src/store*.js           Facade + Firestore + JSON backends, identical async API.
public/app.js           One fetch of /api/summary renders everything.
public/charts.js        SVG charts, no library.
smoke-test.mjs          Stats unit checks + full browser walk-through.
```

## Decisions worth knowing

**Stats are computed server-side, per request.** The family produces a few
hundred runs a year; recomputing is microseconds and means the browser never
holds stale derived numbers. If it ever gets slow, cache in memory keyed on the
latest `updatedAt` — do not move the maths to the browser.

**Best 5k/10k/half/marathon** = the fastest *pace* among runs at least that
long and at most 1.2× it (`RACE_TOLERANCE`). Pace rather than raw time, or a
10.0 km run always beats a faster 10.5 km one. Untimed runs never count for
pace or bests, only for distance.

**Week streak** counts ISO weeks back from the current week, and the current
week counts as alive even with no run yet — otherwise every streak "breaks" on
Monday morning.

**Colours follow the person.** `colorSlot` is assigned at creation to the
lowest free slot and never changes, so adding or removing a runner never
recolours anyone else. The eight slots are the dataviz skill's validated
categorical palette (checked with its validator; slots 3–5 are low-contrast on
white, which is why the charts always carry a legend and a table view).

**Password check is constant-time** (`crypto.timingSafeEqual`). A missing
`EDIT_PASSWORD` in production disables editing rather than falling back to a
default — the local default `run` exists only when not on Cloud Run.

**Deleting a runner deletes their runs** (Firestore batch). Orphaned runs would
break every per-member stat; the UI says so before confirming.

**Future imports are already in the schema.** Every run has `source`
(`manual` | `strava` | `apple_health`) and `externalId`. `members.integrations`
holds per-runner connection state and is never sent to the browser (see
`publicMember()`); only booleans are. When Strava arrives: OAuth connect per
runner, webhook → fetch activity → `validateRun` with `source: 'strava'`,
upsert on `externalId`.

## Deployment

Same WIF pattern as the speaker portal, own provider
(`github/providers/family-running-stats`, pinned to `Njilski/family-running-stats`),
same deployer service account. The workflow passes `--allow-unauthenticated`
(public read is the point) and no env flags, so secrets attached to the service
survive deploys. Secrets: `running-edit-password`, `running-session-secret` in
Secret Manager. The one-time commands are in README → Deploying.

## Conventions

Comments explain *why*, not what, and are rare. UI prose is plain and says what
to do next. Colours come from `styles.css` tokens; chart colours only from the
`--series-N` slots.

## Security constraints that are not negotiable

- Never handle tokens, secrets or the family password directly. Anything that
  prompts for a credential is for Andreas to type.
- Every write goes through `requireEdit`. A read endpoint must never leak
  `integrations` or anything under it.

## Status

- [ ] GitHub repo `Njilski/family-running-stats` created, token granted access
- [ ] First push to `main`
- [ ] WIF provider + IAM binding (README step 1–2)
- [ ] Secrets created and attached (README step 3 + attach block)
- [ ] First live deploy verified, family added, first run logged
- [ ] Strava integration
- [ ] Apple Health import via Shortcut
