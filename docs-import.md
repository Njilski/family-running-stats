# Import af løbeture — hvad der virker og hvad der ikke gør

Status 9. september 2026. Skrevet efter to blindgyder, så ingen bygger dem igen.

Kort version: **appens importknap er fjernet.** Serverens endpoint findes
stadig og er testet, men der er ingen vej ind i det, som er både lovlig og
praktisk. Familien taster sine ture selv — det er tre tryk, og en fejltastet
tur kan slettes igen under MIG.

---

## Blindgyde 1: Genveje kan ikke læse træninger fra Sundhed

**Undersøgt på Andreas' iPhone (dansk iOS), 9. sep 2026. Konklusionen er sikker.**

Sundhed-appen har præcis disse handlinger i Genveje:

| Handling | Læser / skriver |
| --- | --- |
| Søg i Sundhed | — |
| Log sundhedsmåling | skriver |
| Find sundhedsmålinger | læser **målinger** |
| Hent oplysninger om sundhedsmåling | læser en måling |
| Log træning | **skriver** en træning |
| Åbn data / Åbn oversigt / Åbn søvnplan | — |

Der er ingen «Find træninger». **Log træning** skriver, den læser ikke.

Og typelisten i **Find sundhedsmålinger** indeholder kun målinger — skridt,
puls, vand, UV-indeks, vandtemperatur osv. Listen er alfabetisk, og på dansk
ville «Træning» stå mellem *Trappehastighed* og *Træthed*. Den står der ikke.
Der findes altså ingen kombination af handlinger, der giver en løbetur med
distance og varighed.

En træning er i HealthKit en `HKWorkout` — en anden slags objekt end en
`HKQuantitySample`, og Genveje har kun handlinger til det sidste.

**Hvad man kunne narres til at tro virker, men ikke gør:**

- *Find sundhedsmålinger* med typen «Gå- + løbeafstand»: giver mange små
  stumper afstand pr. dag, ikke én tur, og blander gåture ind. Man kan ikke
  regne ture ud af dem.
- En **Automatisering** med udløseren *Træning*: den kan starte en genvej, når
  en træning slutter, men giver ikke træningens data videre.

Tidligere sessioner skrev tre forskellige vejledninger på denne antagelse
(«Find Workouts», «Find Health Samples med type Workouts», «Find
sundhedsprøver») og prøvede aldrig nogen af dem på en telefon. Prøv det på en
telefon, før du skriver en vejledning igen.

## Blindgyde 2: Strava API må ikke bruges til en fælles tavle

Strava har et rigtigt API med webhooks, og teknisk ville det passe perfekt.
Men [API Policy](https://www.strava.com/legal/api_policy) §2.3:

> Strava Data provided by a specific Strava user may be displayed or disclosed
> in your Developer Application only to that user.

Og §6.1 forbyder at vise data om andre brugere, også data der er offentlige på
Strava. §5.4 forbyder at behandle data «in an aggregated, de-identified, or
anonymized manner, for the purposes of analytics».

Hele pointen med Familiens Løbeklub er, at Andreas kan se Majas kilometer.
Det er præcis det, §2.3 forbyder. Det er ikke en detalje, man kan bygge sig
rundt om: enhver visning af en Strava-hentet kilometer til et andet
familiemedlem er den forbudte handling. Reglerne blev strammet i 2024–25 netop
for at lukke den slags.

Strava-ture kommer i øvrigt ind i Apple Sundhed af sig selv, hvis man har slået
det til i Strava-appen. Det er en anden vej end API'et og ikke omfattet af
API-politikken — se nedenfor.

---

## Det, der stadig kan bygges

### Health Auto Export (den eneste automatiske vej)

[Health Auto Export](https://apps.apple.com/dk/app/health-auto-export-json-csv/id1115567069)
er en betalt iOS-app, der kan læse træninger og selv POSTe dem til vores
endpoint på en tidsplan, med `Authorization`-header. Ingen genvej at bygge.

Dens JSON for en træning
([format](https://help.healthyapps.dev/en/health-auto-export/export-format/workouts/)):

```json
{ "workouts": [ {
  "id": "550e8400-…", "name": "Running",
  "start": "2026-09-09 07:00:00 +0200",
  "end": "2026-09-09 07:30:00 +0200",
  "duration": 1800,
  "distance": { "qty": 6.23, "units": "km" }
} ] }
```

Det kræver ~30 linjer i `/api/import/apple-health`: `name` → typefilteret,
`duration` er sekunder, `distance.units` er `km` eller `mi`, og datoformatet
`yyyy-MM-dd HH:mm:ss Z` skal laves til noget `Date.parse` forstår. Er ikke
bygget — Andreas har ikke købt appen.

To forbehold: automatiseringer kører kun, når telefonen er ulåst (Apples
begrænsning), og REST-eksport er en Premium-funktion, hvis pris ikke er
bekræftet.

Fordelen ved denne vej er, at Nike Run Club, Strava og Apple Watch alle skriver
til Sundhed. Én app dækker dem alle, uden at røre Stravas API.

### Sundheds-eksport som XML (gratis, manuel)

Sundhed → profilbilledet → **Eksportér alle sundhedsdata** giver en `export.zip`
med `export.xml`, hvor hver træning står som

```xml
<Workout workoutActivityType="HKWorkoutActivityTypeRunning"
         duration="34.33" durationUnit="min"
         startDate="2026-09-09 07:00:00 +0200" …>
```

Læg zip-filen i `~/Claude`, så kan Claude parse den og importere turene gennem
det eksisterende endpoint. God til at hente det, familien allerede har løbet;
ikke noget man gør hver uge.

---

## Serverens endpoint (uændret, testet)

`POST /api/import/apple-health` findes stadig og virker. Auth: et signeret
`import|<memberId>`-token, enten som `Authorization: Bearer <token>` eller
`?token=<token>`. Token hentes med `GET /api/me/import-token` som indlogget
medlem — der er ingen knap til det i appen længere, så det gøres med curl eller
af Claude i en session.

Tre body-formater, alle testet i `smoke-test.mjs`:

```
JSON  { dates, km, minutes, types }         fire parallelle lister, én linje pr. tur
JSON  { runs: [{ start, km, minutes, type }] }
text  start|km|minutter|type                én tur pr. linje
```

Tal læses med eller uden enhed (`6,23`, `6,23 km`, `6230 m`, `1800 sek`).
Kun træninger med «run» eller «løb» i typen tælles. Dubletter afvises på
`externalId = apple-health:<start ISO>`, også for slettede ture, så en tur man
har smidt væk ikke kommer igen.

Endpointet er altså klar, den dag der findes en klient til det.
