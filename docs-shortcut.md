# Sådan bygger du genvejen «Løbeklub import»

Genvejen bygges én gang på én iPhone (din), deles som et iCloud-link, og resten
af familien installerer den fra linket. Knappen **IMPORTÉR FRA APPLE SUNDHED**
i appen åbner genvejen og giver den den indloggede løbers import-nøgle som
input — så der er intet personligt inde i genvejen.

Det tager 5–10 minutter. Navnene på handlingerne er dem, iPhone viser på dansk;
det engelske navn står i parentes, hvis din telefon er på engelsk. Når du skal
finde en handling, trykker du på **Søg efter handlinger** nederst og skriver
søgeordet.

---

## 0. Opret genvejen

1. Åbn appen **Genveje** (Shortcuts) → fanen **Genveje** → **+** øverst til højre.
2. Tryk på titlen øverst («Ny genvej») → **Omdøb** → skriv præcis: `Løbeklub import` → OK.

Du behøver **ikke** en «Modtag input»-handling. Appen sender nøglen som
*Genvejsinput*, og den variabel findes altid.

---

## 1. Find træningerne i Sundhed

Søg **sundhed** → vælg **Find sundhedsprøver** (Find Health Samples).

Handlingen kommer ind som «Find *Alle sundhedsprøver* hvor …».

- Tryk på det blå **Alle sundhedsprøver**. Der åbner en lang liste af typer med et
  søgefelt øverst. Skriv **træn** i søgefeltet (eller rul helt til bunden) — den
  sidste gruppe hedder **Træning** / **Træninger** (Workouts). Vælg den. Den
  ligger *ikke* under skridt, puls osv., så den er let at overse.
- Tryk **Tilføj filter** → **Startdato** (Start Date) · **er i de sidste** (is in
  the last) · **30** · **dage**.
- Der skal **ikke** filtreres på træningstype — serveren sorterer selv gåture,
  cykling og styrke fra og beholder løb (se 3d).
- **Sortér efter**: Startdato. **Begræns**: slået fra.

Resultatet af denne handling hedder **Sundhedsprøver** — det skal vi bruge om et øjeblik.

---

## 2. En tom liste at samle linjer i

Søg **tekst** → vælg **Tekst** (Text). Lad feltet være **tomt**.

Søg **variabel** → vælg **Angiv variabel** (Set Variable). Kald den `linjer`.
Den skal sættes til **Tekst** (den tomme tekst lige ovenfor) — det sker af sig selv.

---

## 3. Løkken: én linje pr. løbetur

Søg **gentag** → vælg **Gentag for hver** (Repeat with Each).

Den skal gentage for **Sundhedsprøver** (resultatet fra trin 1). Hvis den har
valgt noget andet: tryk på den blå variabel i handlingen, vælg **Vælg variabel**
og peg på Find sundhedsprøver-handlingen.

Alt herunder skal ligge **inde i** løkken, dvs. mellem «Gentag for hver» og
«Afslut gentagelse». Handlinger, du tilføjer mens løkken er valgt, lander der.

### 3a. Distancen i km
Søg **detaljer** → **Hent detaljer om sundhedsprøve** (Get Details of Health Sample).
- Tryk på **Detalje** → vælg **Distance**.
- Input skal være **Gentag-element** (Repeat Item).

Søg **konverter** → **Konverter måleenhed** (Convert Measurement).
- Konverterer **Detaljer om sundhedsprøve** (lige ovenfor) til **Kilometer** (km).

### 3b. Varigheden i minutter
Igen **Hent detaljer om sundhedsprøve** → **Detalje** = **Varighed** (Duration), input **Gentag-element**.

Igen **Konverter måleenhed** → til **Minutter** (min).

### 3c. Starttidspunktet som ISO-dato
Igen **Hent detaljer om sundhedsprøve** → **Detalje** = **Startdato** (Start Date), input **Gentag-element**.

Søg **formatér** → **Formatér dato** (Format Date).
- Dato: **Detaljer om sundhedsprøve** (startdatoen lige ovenfor).
- **Datoformat**: **ISO 8601**.
- Tryk **Vis mere** → slå **ISO 8601-tid** (Include ISO 8601 Time) **til**.

### 3d. Træningstypen
Igen **Hent detaljer om sundhedsprøve** → **Detalje** = **Træningstype** /
**Aktivitetstype** (Workout Activity Type), input **Gentag-element**. Det er
den, serveren bruger til at beholde løb («Løb», «Running») og springe resten over.

### 3e. Selve linjen
Søg **tekst** → **Tekst**. Skriv linjen med de fire variabler indsat via
**Vælg variabel** (tryk i feltet → variabel-knappen over tastaturet):

```
[Formateret dato]|[Konverteret måleenhed fra 3a]|[Konverteret måleenhed fra 3b]|[Træningstype fra 3d]
```

Altså: den formaterede dato, en lodret streg `|`, kilometrene, `|`, minutterne,
`|`, træningstypen. Ingen mellemrum. Hvis appen viser flere variabler med samme
navn, så vælg dem via **Vælg variabel** og peg på den rigtige handling i listen.

Tip: tryk på en indsat måleenheds-variabel → du kan slå **Vis enhed** fra, så
der står `6,23` og ikke `6,23 km`. (Serveren klarer begge dele, og både komma og
punktum.)

Søg **føj til** → **Føj til variabel** (Add to Variable) → variabel `linjer`.
Den føjer **Tekst** (linjen ovenfor) til listen.

*Her slutter det, der ligger inde i løkken.*

---

## 4. Saml linjerne til én tekst

Efter **Afslut gentagelse**:

Søg **kombinér** → **Kombinér tekst** (Combine Text).
- Kombinér **linjer** (vælg variablen) med **Ny linje** (New Lines).

---

## 5. Send til løbeklubben

Søg **URL** → **Hent indholdet af URL** (Get Contents of URL).

- URL:
  `https://family-running-stats-731133621844.europe-west1.run.app/api/import/apple-health`
- Tryk **Vis mere**:
  - **Metode**: **POST**
  - **Sidehoveder** (Headers) → **Tilføj nyt sidehoved** to gange:
    - Nøgle `Authorization` · Værdi: skriv `Bearer ` (med mellemrum) og indsæt
      derefter variablen **Genvejsinput** (Shortcut Input) lige efter.
    - Nøgle `Content-Type` · Værdi `text/plain`
  - **Anmodningstekst** (Request Body): vælg **Fil** (File) → **Kombineret tekst**
    (resultatet fra trin 4).

---

## 6. Vis resultatet i appen

Søg **ordbog** → **Hent ordbogsværdi** (Get Dictionary Value).
- Hent **Værdi** for nøglen `imported` i **Indholdet af URL**.

Søg **åbn URL** → **Åbn URL-adresser** (Open URLs). Skriv:

```
https://family-running-stats-731133621844.europe-west1.run.app/?import=[Ordbogsværdi]
```

— altså adressen og til sidst variablen **Ordbogsværdi** indsat lige efter `=`.

Tryk **Færdig** øverst til højre. Det var det.

---

## 7. Prøv den

Gå i løbeklub-appen → **LOG TUR** → **IMPORTÉR FRA APPLE SUNDHED →**.

Første gang spørger iPhone:
- om genvejen må læse **Træning** i Sundhed → **Tillad** (evt. **Slå alle til**)
- om den må sende til `family-running-stats-…run.app` → **Tillad altid**

Så hopper den tilbage til appen med «IMPORTERET · 3 NYE TURE FRA APPLE SUNDHED»
(eller «INGEN NYE TURE», hvis alt allerede var med). Kør den gerne to gange —
anden gang skal den sige 0 nye; ingenting kommer med to gange.

**Fejlsøgning**
- «Arkivet eksisterer ikke / kunne ikke finde genvejen»: navnet er ikke præcis
  `Løbeklub import` — omdøb den.
- Den siger «INGEN NYE TURE» men du har løbet: tjek at Nike Run Club / Strava /
  Watch skriver til Sundhed (Sundhed-appen → profil → Apps → tillad *Skriv*
  for Træning). Kun træninger af typen **Løb** tæller — de andre springes over
  med vilje.
- Rødt fejlfelt fra appen om ugyldigt token: åbn importen fra appen igen —
  genvejen må ikke startes direkte fra Genveje.

---

## 8. Del den med familien

I Genveje: hold fingeren på genvejen → **Del** → **Kopiér iCloud-link**.

Læg linket på serveren, så appens opsætningspanel kan vise «Hent genvejen»:

```bash
gcloud run services update family-running-stats --region europe-west1 --project athenas-1537948714332 \
  --update-env-vars SHORTCUT_URL="https://www.icloud.com/shortcuts/…"
```

De andre åbner linket på deres iPhone → **Tilføj genvej** → trykker på knappen
i appen. Én gang. Derefter er det ét tryk.

---

### Hvorfor tekstlinjer og ikke JSON
Genveje bygger en liste af linjer med to handlinger; en JSON-ordbog pr. tur er
fem. Serveren tager begge formater, så genvejen er den simple.

### Hvis du vil have det helt automatisk senere
Samme genvej kan køres af en **Automatisering** (Genveje → Automatisering → ny →
*Tidspunkt* hver aften, eller *Træning* når en Watch-træning slutter) med «Kør
straks» slået til — men så mangler den nøglen som input. Sig til, så bygger vi
en variant med nøglen gemt i genvejen.
