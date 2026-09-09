# Sådan bygger du genvejen «Løbeklub import»

Genvejen bygges én gang på én iPhone (din), deles som et iCloud-link, og resten
af familien installerer den fra linket. Knappen **IMPORTÉR FRA APPLE SUNDHED**
i appen åbner genvejen og giver den den indloggede løbers import-nøgle som
input — så der er intet personligt inde i genvejen.

**Ingen løkke.** Genveje kører automatisk en handling på *hele* listen, hvis du
giver den en liste. Derfor henter vi datoerne i én handling, distancerne i én,
varighederne i én og træningstyperne i én — fire lige lange kolonner — og lader
serveren sætte rækkerne sammen igen. Alle handlinger ligger på samme niveau;
der er intet at trække ind i noget andet.

Handlingsnavnene nedenfor er dem, en dansk iPhone viser (kontrolleret på
Andreas' telefon, 9. sep 2026); det engelske navn står i parentes. Du finder en
handling ved at trykke **Søg efter handlinger** nederst og skrive søgeordet.

Det tager 5–10 minutter.

---

## 0. Opret genvejen

1. Åbn appen **Genveje** → fanen **Genveje** → **+** øverst til højre.
2. Tryk på titlen øverst → **Omdøb** → skriv præcis: `Løbeklub import` → OK.

Du behøver **ikke** en «Modtag input»-handling. Appen sender nøglen som
*Genvejsinput*, og den variabel findes altid.

---

## 1. Find træningerne

Søg **sundhed** → vælg **Find sundhedsmålinger** (Find Health Samples).

> Den heder *målinger*, ikke «prøver» eller «data». Søger du på «detaljer»
> finder du ingenting — de handlinger heder «Hent oplysninger om …».

Handlingen kommer ind som «Find *Alle sundhedsmålinger* hvor …».

- Tryk på det blå **Alle sundhedsmålinger**. Der åbner en lang liste af typer
  med et søgefelt øverst. Skriv **træn** i søgefeltet — vælg gruppen for
  træninger (Workouts). Den ligger til sidst, ikke oppe blandt skridt og puls,
  så den er let at overse.
- Tryk **Tilføj filter** → **Startdato** · **er i de sidste** · **30** · **dage**.
- Der skal **ikke** filtreres på træningstype — serveren sorterer selv gåture,
  cykling og styrke fra og beholder løb (se trin 2d).
- **Sortér efter**: Startdato. **Begræns**: slået fra.

Resultatet heder **Sundhedsmålinger**. Alle fire kolonner nedenfor peger på det.

---

## 2. De fire kolonner

Hver kolonne er det samme lille mønster: hent én oplysning for *alle*
træningerne, og lim listen sammen til én tekst med linjeskift.

Handlingen, der henter en oplysning, heder **Hent oplysninger om
sundhedsmåling** (Get Details of Health Sample) — søg på **oplysninger**.
Handlingen, der limer sammen, heder **Kombinér tekst** (Combine Text) — søg på
**kombinér**, og sæt den til at kombinere med **Nye linjer**.

### 2a. Datoerne — byg denne først og tjek den

1. **Hent oplysninger om sundhedsmåling** → **Oplysning** = **Startdato**,
   input = **Sundhedsmålinger** (fra trin 1).
2. **Formatér dato** (Format Date) → **Datoformat**: **ISO 8601**. Tryk
   **Vis mere** → slå **ISO 8601-tid** **til**.
3. **Kombinér tekst** med **Nye linjer**.
4. **Angiv variabel** (Set Variable) → navn `datoer`.

**Stop her og tjek.** Tryk ▶︎ nederst. Resultatet af *Kombinér tekst* skal være
**én linje pr. træning** — har du løbet fem gange på 30 dage, står der fem
datoer. Står der kun én, kører Genveje ikke handlingen på hele listen på din
iOS-version; sig til, så laver jeg løkke-udgaven i stedet. Er der flere linjer,
er resten bare det samme tre gange.

### 2b. Distancerne
1. **Hent oplysninger om sundhedsmåling** → **Oplysning** = distancen,
   input = **Sundhedsmålinger**.
2. **Konverter måleenhed** (Convert Measurement) → til **Kilometer**.
3. **Kombinér tekst** med **Nye linjer**.
4. **Angiv variabel** → `km`.

### 2c. Varighederne
1. **Hent oplysninger om sundhedsmåling** → **Oplysning** = varigheden,
   input = **Sundhedsmålinger**.
2. **Konverter måleenhed** → til **Minutter**.
3. **Kombinér tekst** med **Nye linjer**.
4. **Angiv variabel** → `minutter`.

### 2d. Træningstyperne
1. **Hent oplysninger om sundhedsmåling** → **Oplysning** = træningstypen,
   input = **Sundhedsmålinger**.
2. **Kombinér tekst** med **Nye linjer**.
3. **Angiv variabel** → `typer`.

Det er den, serveren bruger til at beholde løb («Løb», «Udendørs løb»,
«Running») og springe resten over.

> **Enheder er lige meget.** Om der står `6,23` eller `6,23 km` eller `6230 m`
> betyder ikke noget — serveren læser tallet og enheden, hvis den er der. Du
> behøver altså ikke lede efter **Vis enhed**. Komma og punktum går også begge.

---

## 3. Send til løbeklubben

Søg **URL** → **Hent indholdet af URL** (Get Contents of URL).

- URL:
  `https://family-running-stats-731133621844.europe-west1.run.app/api/import/apple-health`
- Tryk **Vis mere**:
  - **Metode**: **POST**
  - **Sidehoveder** (Headers) → **Tilføj nyt sidehoved** to gange:
    - Nøgle `Authorization` · Værdi: skriv `Bearer ` (med mellemrum til sidst) og
      indsæt derefter variablen **Genvejsinput** (Shortcut Input) lige efter.
    - Nøgle `Content-Type` · Værdi `application/json`
  - **Anmodningstekst** (Request Body): **JSON**. Tilføj fire felter, alle af
    typen **Tekst**:

| Nøgle      | Værdi (variabel) |
| ---------- | ---------------- |
| `dates`    | `datoer`         |
| `km`       | `km`             |
| `minutes`  | `minutter`       |
| `types`    | `typer`          |

Nøglerne skal staves præcis som i tabellen (engelsk, små bogstaver). Værdierne
indsætter du med variabel-knappen over tastaturet.

---

## 4. Vis resultatet i appen

Søg **ordbog** → **Hent ordbogsværdi** (Get Dictionary Value).
- Hent **Værdi** for nøglen `imported` i **Indholdet af URL**.

Søg **åbn URL** → **Åbn URL-adresser** (Open URLs). Skriv:

```
https://family-running-stats-731133621844.europe-west1.run.app/?import=[Ordbogsværdi]
```

— altså adressen og til sidst variablen **Ordbogsværdi** indsat lige efter `=`.

Tryk **Færdig** øverst til højre. Det var det: 13 handlinger, alle i én lige række.

---

## 5. Prøv den

Gå i løbeklub-appen → **LOG TUR** → **IMPORTÉR FRA APPLE SUNDHED →**.

Første gang spørger iPhone:
- om genvejen må læse træninger i Sundhed → **Tillad** (evt. **Slå alle til**)
- om den må sende til `family-running-stats-…run.app` → **Tillad altid**

Så hopper den tilbage til appen med «IMPORTERET · 3 NYE TURE FRA APPLE SUNDHED»
(eller «INGEN NYE TURE», hvis alt allerede var med). Kør den gerne to gange —
anden gang skal den sige 0 nye; ingenting kommer med to gange.

**Fejlsøgning**

- «Arkivet eksisterer ikke / kunne ikke finde genvejen»: navnet er ikke præcis
  `Løbeklub import` — omdøb den.
- Den siger «INGEN NYE TURE», men du har løbet: tjek at Nike Run Club / Strava /
  Watch skriver til Sundhed (Sundhed → profil → Apps → tillad *Skriv* for
  træninger). Kun træninger af typen løb tæller — resten springes over med vilje.
- Rødt fejlfelt om ugyldigt token: åbn importen fra appen igen — genvejen må
  ikke startes direkte fra Genveje, for så mangler nøglen.
- Alle ture bliver afvist: kolonnerne er ikke lige lange. Kør ▶︎ og se, om de
  fire *Kombinér tekst*-resultater har samme antal linjer. Det sker, hvis en af
  de fire «Hent oplysninger»-handlinger peger på noget andet end
  **Sundhedsmålinger**.
- En tur kom ind med tosset distance: se på `km`-kolonnen i ▶︎-resultatet.
  Serveren tager tallet som det står, med enhed eller uden.

---

## 6. Del den med familien

I Genveje: hold fingeren på genvejen → **Del** → **Kopiér iCloud-link**.

Læg linket på serveren, så appens opsætningspanel kan vise «Hent genvejen»:

```bash
gcloud run services update family-running-stats --region europe-west1 --project athenas-1537948714332 \
  --update-env-vars SHORTCUT_URL="https://www.icloud.com/shortcuts/…"
```

De andre åbner linket på deres iPhone → **Tilføj genvej** → trykker på knappen
i appen. Én gang. Derefter er det ét tryk.

---

### Hvorfor fire kolonner og ikke JSON pr. tur

En liste af ordbøger kræver **Gentag for hver** og otte handlinger inde i
løkken, hver med en variabel, der skal pege på *Gentag-element*. Fire kolonner
kræver ingen løkke. Serveren tager stadig begge formater (og en tekstlinje pr.
tur, `start|km|minutter|type`), så en genvej bygget efter den gamle
vejledning virker uændret.

### Hvis du vil have det helt automatisk senere

Samme genvej kan køres af en **Automatisering** (Genveje → Automatisering → ny →
*Tidspunkt* hver aften, eller *Træning* når en Watch-træning slutter) med «Kør
straks» slået til — men så mangler den nøglen som input. Sig til, så bygger vi
en variant med nøglen gemt i genvejen.
