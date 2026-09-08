# The "Løbeklub import" Shortcut

Built once on an iPhone by an admin, shared as an iCloud link, installed by
everyone. The app's IMPORTÉR button opens it with the runner's import token as
input, so nothing in the Shortcut is personal.

Open **Genveje** → **+** → name it exactly `Løbeklub import` (or whatever
`SHORTCUT_NAME` is set to on the service). Add these actions in order:

1. **Modtag input** (Receive input) — from *Hurtig kommando/Del*, type *Tekst*.
   If there is no input: *Stop og svar* "Åbn importen fra Løbeklub-appen".
2. **Find sundhedsprøver** (Find Health Samples): Type = *Træning*;
   filter *Træningstype* is *Løb*; *Startdato* is in the last *30 days*;
   sort by *Startdato*; limit off.
3. **Tekst** — leave empty. Then **Angiv variabel** → `linjer` (a running list).
4. **Gentag for hver** (Repeat with Each) over the health samples:
   1. **Konverter måleenhed** the sample's *Distance* to *km* → `km`.
   2. **Konverter måleenhed** the sample's *Varighed* to *minutter* → `min`.
   3. **Formatér dato** the sample's *Startdato* as ISO 8601 (incl. time) → `start`.
   4. **Tekst**: `start|km|min|Running` (one line, using the three variables).
   5. **Føj til variabel** → `linjer`.
5. **Kombinér tekst** `linjer` with *Ny linje* → `krop`.
6. **Hent indholdet af URL** (Get Contents of URL):
   URL `https://family-running-stats-731133621844.europe-west1.run.app/api/import/apple-health`,
   Method **POST**, Headers: `Authorization` = `Bearer ` + *Hurtig kommando-input*,
   `Content-Type` = `text/plain`; Request body **File** = `krop`.
7. **Hent ordbogsværdi** `imported` from the result → `antal`.
8. **Åbn URL**: `https://family-running-stats-731133621844.europe-west1.run.app/?import=` + `antal`.

Share: ⋯ → **Del** → **Kopiér iCloud-link**. Set that link on the service so the
app can offer it on the setup panel:

```bash
gcloud run services update family-running-stats --region europe-west1 --project athenas-1537948714332 \
  --update-env-vars SHORTCUT_URL="https://www.icloud.com/shortcuts/…"
```

First run on each phone: iOS asks for Health access (Tillad) and whether the
Shortcut may contact the app's domain (Tillad altid). After that it is one tap.

Why text lines and not JSON: Shortcuts can build a list of lines with two
actions; nested JSON needs a dictionary per sample and is fiddly on a phone.
The endpoint accepts both.
