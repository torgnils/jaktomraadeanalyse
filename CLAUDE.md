# Viltterreng – prosjektkontekst

Les denne før du endrer kode. Den fanger beslutninger og fallgruver som ikke er
åpenbare fra koden alene, og som kostet mye feilsøking å finne.

## Hva appen er

En selvstendig PWA (ingen byggesteg, ingen rammeverk) som hjelper med å finne
jaktterreng for skogsfugl og rype. Fire deler:

- **Kart** med bakgrunnskart, offline-nedlasting og septemberanalyse for skogsfugl
- **Habitatguide** – statisk viltfaglig kunnskap, dekker lirype, fjellrype, storfugl, orrfugl
- **Terrengsjekkliste** – fungerer helt offline, dekker alle fire arter
- **Loggbok** – egne observasjoner, lagres i localStorage, CSV-eksport

Kartanalysen dekker **bare storfugl og orrfugl**. Rype er bevisst holdt utenfor
den, fordi datakildene er skogdata og ikke sier noe om vierkratt og snaufjell.

## Filer

```
index.html        struktur, all tekst i guiden
style.css         utseende
app.js            kart, kartlag, sjekkliste, loggbok, versjonsnummer
analyse.js        septemberanalysen (datahenting, poeng, tegning)
habitat-data.js   habitatkunnskapen som ren data
sw.js             service worker: offline app-skall + karttiles
libs/leaflet/     Leaflet lokalt (bevisst, ikke CDN – appen må virke offline)
```

`app.js` eksponerer `window.VT = { map, toast }` som bro til `analyse.js`.
`analyse.js` eksponerer `window.VTAnalyse` og initialiseres fra `app.js`.

`build_single.py` (i mappa over) bygger en selvstendig enkeltfil-HTML til testing
uten webserver. Kjør den etter endringer hvis du vil oppdatere den.

## Datakilder og deres særheter

Tre offentlige tjenester spørres per rute. Alle tre virker fra nettleser –
**ingen CORS-problemer**, det ble bekreftet i felt.

### 1. Naturskog (Miljødirektoratet)
ArcGIS MapServer, lag 2 = `naturskogssannsynlighet`.
Hentes via **JSONP** (`identify` med `callback=`), ikke fetch. Det omgår CORS helt.
Verdien kommer som 0–100 (prosent), ikke 0–1. `normNaturskog()` håndterer begge.

Viktig: ArcGIS' `identify` tar hensyn til lagets synlighet ved gjeldende målestokk
og forholdet mellom `mapExtent` og `imageDisplay`. En kunstig liten boks gir tomme
svar. Bruk et realistisk kartutsnitt (~1 km) og vanlig bildestørrelse.

### 2. SAT-SKOG skogalder (NIBIO)
WMS `GetFeatureInfo` mot `wms.nibio.no/cgi-bin/satskog`, lag `Alder`.
Lag `Arstall` spørres i **samme forespørsel** (kommaseparert i `LAYERS`/`QUERY_LAYERS`)
og gir bildeåret gratis. Uten det vet man ikke om dataene er fra i fjor eller 2004.

### 3. AR5 arealtype (NIBIO)
WMS `GetFeatureInfo` mot `wms.nibio.no/cgi-bin/ar5`, lag `Arealtype`.

### Fallgruven som kostet mest tid

**NIBIO svarer med en tabell, ikke `nøkkel = verdi`.** Svaret ser slik ut:

```
Resultat Sat-skog Areal 13 (ha) Alder 66 år Bestandstreslag Barblanding
Andel gran 38 % Andel furu 48 % Andel lauv 14 % Arstall 2005
```

En parser som leter etter likhetstegn finner ingenting og rapporterer «ingen data»
selv om svaret er helt i orden. Derfor egne uttrekkere (`extractSatskog`,
`extractArealtype`) som matcher etikett fulgt av verdi.

**AR5 oppgir arealtypen som tekst** («Arealtype Skog»), ikke som tallkode.
`AREALTYPE_TEKST` oversetter til AR5s egne koder (skog 30, myr 60, åpen fastmark 50).

**text/plain gir ofte tomt svar; text/html gir utfylt tabell.** Derfor prøves flere
varianter i `WMS_VARIANTS` (format og koordinatsystem) til én gir treff. Varianten
som virket huskes i `virkendeVariant` og brukes for resten av rutene.

**Bruk WMS 1.1.1, ikke 1.3.0.** I 1.3.0 er akserekkefølgen for EPSG:4326 snudd
(lat,lon), en klassisk feilkilde. 1.1.1 bruker alltid lon,lat.

## Metodiske beslutninger

### Rutestørrelse: 300–600 m er riktig, ikke «så fint som mulig»

To feil trekker i hver sin retning:

- **For fine ruter** deler opp samme skogfigur. Kildedataenes figurer er typisk
  10–40 ha (350–600 m tvers over). Ruter under 300 m gir naboruter identisk verdi.
- **For grove ruter** gjør kantsonesøket upresist. Søket bruker naboruter, så med
  1000-metersruter deles kantbonus ut til alt innenfor 1000 m i stedet for 250 m.

`oppdaterBadge()` viser dette live nederst til venstre med grønn/gul/rød prikk.

### Kantsonesøk må måles i meter, ikke i antall naboruter

Dette var en reell feil i en tidligere versjon. Med bare de fire nærmeste naboene
lå alle naboer inne i samme skogfigur ved finmasket rutenett, kantbonusen forsvant,
og **ekte kantterreng fikk lavere score jo finere rutenett man valgte**. Testet:
ved 15×15 og 19×19 ble 9-poengs kantterreng rangert som 6 poeng «middels».

Nå: `naboRadius()` regner ut hvor mange ruter som tilsvarer `KANT_AVSTAND_M` (250 m).
Endrer du dette, verifiser at kantbonus utløses likt på alle oppløsninger.

### Poeng måles mot hva som var oppnåelig

Hver art har sin egen `maks` som bygges opp av de kildene ruta faktisk fikk svar
fra. Uten dette ville en manglende datakilde gjort at alt ble stemplet «lite
lovende» – kartet ville vist svakhet i datagrunnlaget som om det var svakhet i
terrenget.

### Storfugl og orrfugl regnes hver for seg

`scoreStorfugl()` og `scoreOrrfugl()` er separate. Fargen viser hvilken art ruta
peker mot (fiolett/oransje/grønn), styrken viser hvor lovende den er. Skiller det
under 12 prosentpoeng, settes «begge» – ikke utrop en vinner modellen ikke har
grunnlag for.

### Bare lovende ruter tegnes

Å fargelegge alt gjør kartet ulesbart, og poenget er å se terrenget under. Den
stiplede rammen viser hvor analysen er kjørt, så «lite lovende» trenger ingen farge.

### Ytelse

- Arealtype spørres først; er ruta vann/dyrket mark/bebyggelse hoppes de to andre over
- `punktCache` mellomlagrer per punkt rundet til ~11 m, så gjentatte kjøringer er gratis
- 8 samtidige forespørsler

## Service worker – ikke gjør den cache-først igjen

App-skallet bruker **nettverk-først** med cache som reserve (2,5 s tidsavbrudd).
En tidligere cache-først-variant gjorde at en gammel utgave satt fast i nettleseren
i det uendelige, selv etter ny utrulling. Det tok mange runder å diagnostisere.

Karttiles er derimot **cache-først** – det er hele poenget med offline-kart i felt,
og `TILE_CACHE` skal ikke tømmes ved appoppdatering.

`APP_VERSION` i `app.js` vises under «Mer». Bump den ved endringer – den er det
raskeste diagnoseverktøyet når man lurer på om en utrulling har slått gjennom.
Bump også `SHELL_CACHE` i `sw.js`.

## Kjente begrensninger (vær ærlig om disse)

- **Dataene kan være 20+ år gamle.** Flatehogst etter satellittbildets år er usynlig.
  Appen viser bildeåret og advarer, men kan ikke kompensere.
- **Kildene advarer selv mot detaljbruk.** NIBIO: nøyaktigheten for enkeltpunkter i
  SAT-SKOG er «relativt lav», kartet gjelder «på et overordnet nivå».
  Miljødirektoratet: naturskogkartet er ikke verifisert i felt.
- **Blåbær mangler.** Det viktigste septemberfôret er ikke kartlagt i noen av kildene.
  Furuandel og bonitet brukes som omveier.
- **Poengmodellen er ikke validert** mot faktiske fugleobservasjoner.
- **Bestandssvingninger** (smågnagersyklus, klekkevær) betyr trolig mer enn
  habitatforskjellene modellen rangerer.
- **Ikke med:** forstyrrelse fra veier og hytter, terrengform, jakttrykk, grunneierrett.

Ikke fjern forbeholdene i guiden («Hva analysen ikke kan») eller advarslene i
popup-ene for å gjøre appen mer «ryddig». De er der fordi modellen ellers gir
falsk trygghet.

## Testing

Sandkassen har ikke nett til karttjenestene, så testene bruker Playwright med
simulerte svar (`context.route`). Mønsteret som fungerer:

- Mock ArcGIS-JSONP ved å svare med `callback({...})` som `application/javascript`
- Mock NIBIO ved å svare tomt på `text/plain` og med HTML-tabell på `text/html`
- Bruk `devices['iPhone 13']` – flere feil har vært layoutfeil som bare oppsto på mobil

Enhetstesting av uttrekkere og poeng gjøres ved å `eval()` `analyse.js` i Node med
minimale globaler og eksponere de interne funksjonene. Se historikken for mønsteret.

En tidlig feil var at `#map` fikk 0 i høyde på mobil fordi en wrapper manglet
`display: flex`. Kartet så da helt tomt ut selv om alt annet virket. Sjekk alltid
`getBoundingClientRect().height` på `#map` i mobiltest.

## Utrulling

Statiske filer, ingen bygging. På Netlify: dra `app`-mappa inn under nettstedets
Deploys. Merk at netlify.com/drop lager et **nytt nettsted hver gang** – bruk det
eksisterende nettstedets Deploys-felt for å beholde adressen.

Norge i bilder stengte de åpne WMTS-tjenestene i mars 2026 (krever nå token,
forbeholdt Norge digitalt-parter). Derfor brukes Esri World Imagery som flyfotolag.
Har brukeren tilgang via arbeidsgiver (kommune er Norge digitalt-part), er Norge i
bilder et bedre alternativ.

## Språk

All brukertekst og alle kodekommentarer er på norsk. Behold det.
