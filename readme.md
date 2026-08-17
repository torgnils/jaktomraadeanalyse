# Viltterreng – app for jakt på rype og skogsfugl

En liten "web-app" (PWA) du kan legge til på hjemskjermen på mobilen. Den gir:


- **Kart** med flere bakgrunnskart (OpenTopoMap, OpenStreetMap, Kartverket) og to **analysekart** du kan slå på oppå kartet: "Naturskog – sannsynlighet" (Miljødirektoratet/Landbruksdirektoratet, lansert januar 2025) og "Skogalder" (NIBIOs SAT-SKOG) — disse viser hvor det er størst sannsynlighet for gammel, lite påvirket skog, som er svært viktig habitat for særlig storfugl. Slås av/på via kartlagvelgeren øverst til høyre på kartet. Krever internett (lagres ikke offline).
- Mulighet til å laste ned bakgrunnskartet for et område på forhånd slik at det virker uten mobildekning ute i terrenget.
- **Septemberanalyse for skogsfugl**: knappen "🎯 Analyser (sept)" deler kartutsnittet i ruter, henter faktiske dataverdier for hver rute (naturskog-sannsynlighet, skogalder, treslagsfordeling og arealtype) og fargelegger hvilke områder som ser mest lovende ut for storfugl/orrfugl på høstjakta. Oppløsningen er valgbar fra 7×7 til 19×19 ruter, og rutestørrelsen i meter vises etter hver kjøring. Trykk på en rute for å se nøyaktig hvorfor den er vurdert slik. Krever internett – egner seg godt til planlegging hjemme før turen.
- **Habitatguide** med kunnskap om hvor lirype, fjellrype, storfugl og orrfugl typisk holder til, etter sesong, døgnrytme og vær — inkludert forklaring av analysekartene over.
- **Terrengsjekkliste** du fyller ut mens du står i terrenget (høyde, vegetasjon, terrengform, le for vær, tegn til vilt) som gir en enkel vurdering: lav / middels / høy sannsynlighet – helt uten behov for nett.
- **Loggbok** for egne observasjoner og markerte punkter, med GPS-posisjon, som bygger opp ditt eget kart over gode områder over tid. Kan eksporteres som CSV.

Alt lagres lokalt på telefonen din (ingen data sendes til noen server).

## Viktig: dette må hostes for å virke som ordentlig app

Nettlesere krever at "installerbare" apper med offline-støtte (service worker) kjøres over **https**, ikke bare åpnes som en fil. Du må derfor legge filene på en enkel gratis vertstjeneste. Raskeste måte, uten konto:

1. Gå til **https://app.netlify.com/drop** i en nettleser på PC-en din.
2. Dra hele `app`-mappen (denne mappen) inn i nettleservinduet.
3. Du får en lenke i stil med `https://noe-tilfeldig-navn.netlify.app`.
4. Åpne denne lenken på mobilen din (i Chrome/Safari).
5. Trykk "Del"/meny → **"Legg til på Hjem-skjerm"**. Nå fungerer den som en egen app-ikon.

Alternativer om du vil ha mer permanent hosting: GitHub Pages, Cloudflare Pages, eller din egen webhotell-konto – bare last opp alt innholdet i `app`-mappen som statiske filer.

## Bruk før du drar på jakt (må ha nett)

1. Åpne appen, gå til fanen **Kart**.
2. Zoom/panorer til området du planlegger å gå i.
3. Trykk **"⬇️ Last ned område"**. Appen laster ned kartrutene for det synlige utsnittet (og litt rundt) slik at kartet virker uten nett i felt.
4. Gjenta for flere områder om du er usikker på nøyaktig hvor du skal gå.

Kartet lastes ned i et par zoomnivåer rundt det du ser – zoom inn til et fornuftig område (f.eks. en fjellside eller dal) fremfor et helt fylke, ellers blir nedlastingen for stor.

## Bruk ute i terrenget (uten nett)

- **Min posisjon** viser deg som prikk på det nedlastede kartet (GPS trenger ikke mobildekning).
- **Terrengsjekkliste**-fanen virker helt offline og gir deg en rask vurdering av stedet du står.
- **Marker punkt** i kartet lar deg tagge interessante steder direkte.
- **Logg**-fanen lar deg registrere observasjoner med GPS-posisjon selv uten nett – dataene ligger trygt på telefonen til du er tilbake i dekning.

## Om oppdateringer (hvorfor "gammel versjon" ikke lenger skal skje)

Tidligere versjoner av appen brukte en "cache-først"-strategi som gjorde at nettleseren kunne fortsette å vise en gammel utgave av appen selv etter at en ny var lagt ut. Fra og med versjon 1.3 henter appen alltid nyeste utgave fra nettet når du har dekning, og bruker kun den lagrede kopien når nettet er borte eller svært tregt. Kartrutene du har lastet ned for offline bruk berøres ikke av dette – de ligger trygt lagret som før.

Under "Mer" i appen vises et **versjonsnummer**. Er du usikker på om en ny opplasting har slått gjennom på en lenke, sjekk det tallet – og bruk eventuelt knappen "Se etter ny versjon".

## Viktige forbehold

- Habitatinformasjonen er generell viltfaglig kunnskap ment som støtte til egen vurdering – ikke en fasit. Lokale forhold, bestand og værforhold varierer mye.
- Sjekk alltid gjeldende jakttider, kvoter og eventuelle grunneier-/fellingstillatelser før du drar ut – dette er ikke noe appen håndterer.
- Kartlaget bruker Kartverkets åpne kartdata, med OpenStreetMap som reserveløsning hvis Kartverket-tjenesten er nede. Test gjerne at kartet laster fint hjemme (med nett) før du er avhengig av det i felt, og juster kartlag-valget (øverst til høyre på kartet) om ett av lagene ikke laster.
- All lagret informasjon (logg, punkter) ligger kun lokalt i nettleseren på telefonen. Eksporter jevnlig til CSV (fra "Mer"/Logg) om du vil ta vare på dataene, spesielt før du bytter telefon eller nettleser.

## Filoversikt

```
app/
  index.html          – selve appen (struktur)
  style.css           – utseende
  app.js              – all logikk (kart, sjekkliste, loggbok)
  habitat-data.js      – habitatkunnskap for artene
  sw.js               – service worker (offline-kart og app)
  manifest.json       – gjør appen installerbar på hjemskjerm
  icon-192.png / icon-512.png – app-ikoner
  libs/leaflet/       – kartbiblioteket Leaflet (lokalt, for offline-støtte)
```

Vil du ha noe endret – flere arter, andre terrengfaktorer i sjekklisten, annen kartkilde, værvarsel-integrasjon når det er nett osv. – bare si ifra, så bygger vi videre på dette.
