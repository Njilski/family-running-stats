# Familiens Løbeklub

A phone-first web app where a family of five logs runs and sees who leads the
week, month, year and all-time. Ranking is on **adjusted kilometres** — real km
× a per-member age adjustment — so a six-year-old can beat an adult. Medals,
taunts, a weekly winner poster, teasing messages. Danish UI, Modernist design
(flat, zero radius, 2px black rules, one red, Archivo).

Built on the same stack as the Opus speaker portal so both are maintained the
same way: Node/Express, Firestore (JSON file locally), Cloud Run, automatic
deploys from GitHub via Workload Identity Federation.

Live at https://family-running-stats-731133621844.europe-west1.run.app (log in with the family code).

## Quick start

```bash
npm install
npm start
```

Open http://localhost:3000, tap a name, type `1234` (the local family code).
Data lives in `data/store.json`; the five members are seeded on first run.

## Testing

```bash
rm -rf data && node server.js &
CHROMIUM=/opt/pw-browsers/chromium node smoke-test.mjs   # or: node smoke-test.mjs
```

Part 0 checks the maths (points snapshot, periods, medals, recap, nudges).
Part 1 drives a phone-sized browser through all eight screens. Run it before
every commit; it needs an empty store.

## How it works

- **Login**: name tile + the family's 4-digit code, once per device (a signed
  cookie for a year). Adults and children alike — no e-mail, no passwords.
  `isAdmin` on a member allows editing everyone's adjustment.
- **Points** = km × `adjustmentAtLog`, a snapshot taken when the run is saved.
  Changing an adjustment never rewrites history ("Ændringer gælder fra næste tur").
- **Deleting a run**: a run logged by mistake is removed from MIG — your own
  always, anyone's if you are admin, with no time limit. It is a soft delete
  (`deletedAt` on the row), so the record survives in Firestore and can be put
  back by hand; every read path skips it, the messages it caused are removed,
  and an imported run stays deduped so it cannot return on the next import.
- **Periods**: ISO week Mon 00:00 → Sun 23:59 (Europe/Copenhagen), calendar
  month, calendar year, all-time. Medals = closed weeks won on points.
- **Beskeder** are generated on the server when a run is saved: OVERHALET (you
  were passed), HALER IND (someone came within 5 points of you, the leader),
  STIME (a streak of weeks), NY TUR (every run, opt-in), plus a computed
  UGEN LUKKER reminder from Friday on. Each member dismisses their own.
- **Ugens resultat** is the most recently closed week (or the running week if
  last week was empty). "Send praleriet" uses the share sheet, or copies text.

## What's where

```
server.js               Express: login, /api/state, log a run, adjustments, prefs, nudges
src/stats.js            Standings per period, medals, recap, streaks — pure functions
src/nudges.js           Message generation on save + per-member filtering
src/model.js            Member/activity shapes, validation, the five seed members
src/store*.js           Facade + Firestore (running_members/activities/nudges) + JSON
public/index.html       Shell; app.js renders all eight screens; styles.css = Modernist tokens
public/manifest.webmanifest, icon*  Installable on a phone (add to home screen)
smoke-test.mjs          Headless end-to-end test (Playwright)
.github/workflows/      Auto-deploy to Cloud Run on push to main
CLAUDE.md               Working notes for whoever picks this up next
```

Archivo is vendored from `@fontsource/archivo` — no CDN at runtime.

## Environment

| Variable | Effect |
|---|---|
| `FAMILY_PIN` | The 4-digit family code. Locally defaults to `1234`; **in production a missing value means nobody can log in.** |
| `SESSION_SECRET` | Signs the member cookie. |
| `FAMILY_NAME` | Kicker text (default `FAMILIENS LØBEKLUB`). |
| `TZ` | Defaults to `Europe/Copenhagen` in code and in the image. |
| `PORT` | Local port (default 3000; Cloud Run injects its own). |
| `K_SERVICE` / `USE_FIRESTORE=1` | Switches storage to Firestore. Set automatically on Cloud Run. |

## Members

The five from the design are seeded (Andreas admin). An admin manages members on
the Justering screen: **REDIGÉR** on a row edits name, age, role and initials;
**+ TILFØJ MEDLEM** adds one; a member (never yourself) can be removed together
with all their runs. Age sets the *suggested* adjustment (adult 1,00 · 11 → 1,60
· 9 → 1,85 · 6 → 2,40, with the ages in between filled in); the actual
adjustment is set with the – / + steppers and applies from the next run.

## Logging a run

Distance and time have steppers (0,5 km / 5 min) and both numbers can be tapped
to type an exact value: `6,23` (comma or dot), and time as `34`, `34,5`,
`34:20` or `1:02:15`. Time is stored as decimal minutes.

## Deploying

**Push to `main` and it deploys itself.** `.github/workflows/deploy.yml` builds
from source and releases to Cloud Run using Workload Identity Federation, so no
service-account key exists anywhere. Markdown-only pushes skip the deploy.

Project `athenas-1537948714332`, region `europe-west1`, service
`family-running-stats`. Firestore collections `running_members`,
`running_activities`, `running_nudges` (prefixed: the project is shared).

### One-time setup (done — kept for reference and for a second family)

Run in Cloud Shell. The pool `github` and the deployer `portal-deployer` exist
from the speaker portal; this adds a provider pinned to this repo.

```bash
PROJECT=athenas-1537948714332
PROJECT_NUMBER=731133621844
REPO=Njilski/family-running-stats
SA=portal-deployer@$PROJECT.iam.gserviceaccount.com

# 1. A WIF provider that only accepts tokens minted for this repo
gcloud iam workload-identity-pools providers create-oidc family-running-stats \
  --project=$PROJECT --location=global --workload-identity-pool=github \
  --display-name="GitHub: family-running-stats" \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
  --attribute-condition="assertion.repository == '$REPO'"

# 2. Let that repo's workflows act as the deployer
gcloud iam service-accounts add-iam-policy-binding $SA --project=$PROJECT \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github/attribute.repository/$REPO"

# 3. Secrets (type them in; never paste them into a chat)
printf '1234' | gcloud secrets create running-family-pin --data-file=- --project=$PROJECT   # your real 4 digits
openssl rand -base64 48 | gcloud secrets create running-session-secret --data-file=- --project=$PROJECT
```

Push to `main` once; the first deploy creates the service (public URL, but
nobody can log in until the code is attached). Then:

```bash
RUNTIME_SA=$(gcloud run services describe family-running-stats --region europe-west1 --project $PROJECT --format='value(spec.template.spec.serviceAccountName)')
RUNTIME_SA=${RUNTIME_SA:-$PROJECT_NUMBER-compute@developer.gserviceaccount.com}
for s in running-family-pin running-session-secret; do
  gcloud secrets add-iam-policy-binding $s --project=$PROJECT \
    --member="serviceAccount:$RUNTIME_SA" --role=roles/secretmanager.secretAccessor
done
gcloud run services update family-running-stats --region europe-west1 --project $PROJECT \
  --set-secrets FAMILY_PIN=running-family-pin:latest,SESSION_SECRET=running-session-secret:latest
```

Later deploys keep those. Add env vars with `--update-env-vars`, never
`--set-env-vars` (which replaces the whole set).

**Changing the family code**: add a new secret version, disable the old one,
and roll a revision so `latest` is re-read (Cloud Run resolves it at instance start):

```bash
read -s -p "Ny kode: " PIN && printf '%s' "$PIN" | gcloud secrets versions add running-family-pin --data-file=- --project=$PROJECT; unset PIN
gcloud secrets versions disable 1 --secret=running-family-pin --project=$PROJECT   # the previous version number
gcloud run services update family-running-stats --region europe-west1 --project $PROJECT \
  --set-secrets FAMILY_PIN=running-family-pin:latest,SESSION_SECRET=running-session-secret:latest
```

## Import from Apple Health (covers Nike Run Club, Strava, Apple Watch)

A web page cannot read HealthKit, so the phone pushes. **IMPORTÉR FRA APPLE
SUNDHED** on Log tur opens a shared iOS Shortcut with the runner's signed import
token as input; the Shortcut reads the last 30 days of running workouts from
Health and POSTs them to `/api/import/apple-health` (text lines
`start|km|minutes|type` or JSON `{ runs: [...] }`), then reopens the app with
`?import=<count>`. Runs are keyed on `apple-health:<start ISO>` so a re-import
never duplicates; non-running workouts are skipped; the current adjustment is
snapshotted at import time like any other run. How to build and share the
Shortcut once: `docs-shortcut.md`. Set `SHORTCUT_URL` (and optionally
`SHORTCUT_NAME`) on the service so the setup panel can link to it.

Anything that syncs to Apple Health — Nike Run Club, Strava, the Watch — comes
along for free. Direct Strava/NRC integrations were assessed and dropped:
Strava's API terms forbid showing one user's data to others (the whole point of
a family board) and require a paid developer subscription; Nike has no API.

## Roadmap

- Invite link for new members (`/join/<token>`), so a child can join from their own phone.
- Push notifications for Beskeder (currently in-app only); a Sunday e-mail
  with the poster as a first step.
- Automatic import (a nightly Shortcut automation per phone, or the paid
  Health Auto Export app posting to the same endpoint) instead of one tap.
