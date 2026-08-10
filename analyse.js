// Viltterreng – områdeanalyse for skogsfugl på høstjakt (september)
//
// Henter FAKTISKE dataverdier (ikke bare kartbilder) og regner ut hvilke ruter
// i kartet som ser mest lovende ut for storfugl/orrfugl i september:
//
//   1) Naturskog-sannsynlighet  (Miljødirektoratet/Landbruksdirektoratet)
//   2) Skogalder, SAT-SKOG      (NIBIO)
//   3) Arealtype AR5            (NIBIO)  – brukes til å finne myr/skog-kantsoner
//
// Om datahenting og CORS:
// Nettlesere blokkerer som hovedregel at en nettside leser data fra en annen
// nettadresse, med mindre tjenesten uttrykkelig tillater det (CORS). Derfor:
//   * Naturskog hentes via ArcGIS sitt JSONP-grensesnitt, som ikke rammes av
//     CORS i det hele tatt, og derfor virker uansett.
//   * NIBIO-tjenestene er vanlig WMS og må hentes med fetch. Blir de blokkert,
//     tilbyr appen å prøve på nytt via en mellomtjeneste (proxy).

(function () {
  "use strict";

  // ---- Tjenester ----------------------------------------------------------
  const ARCGIS_BASE =
    "https://image001.miljodirektoratet.no/arcgis/rest/services/naturskog/naturskog_v1/MapServer";
  const ARCGIS_LAYER_NATURSKOG = 2; // naturskogssannsynlighet

  const SOURCES = {
    naturskog: {
      label: "Naturskog",
      mode: "arcgis",
      layerId: ARCGIS_LAYER_NATURSKOG,
    },
    alder: {
      label: "Skogalder",
      mode: "wms",
      base: "https://wms.nibio.no/cgi-bin/satskog",
      layer: "Alder",
      // Årstallet for satellittbildet hentes i SAMME forespørsel. Uten det vet
      // man ikke om «gammel skog» er observert i fjor eller for 20 år siden –
      // og flatehogst etter bildedatoen er usynlig i dataene.
      layerExtra: "Arstall",
      keys: ["alder", "age", "value"],
      extract: extractSatskog,
    },
    arealtype: {
      label: "Arealtype",
      mode: "wms",
      base: "https://wms.nibio.no/cgi-bin/ar5",
      layer: "Arealtype",
      keys: ["artype", "arealtype", "value"],
      extract: extractArealtype,
    },
  };

  // NIBIO svarer med en tabell der etiketten står foran verdien
  // ("Alder 66 år", "Arealtype Skog"), ikke som nøkkel=verdi. Derfor egne
  // uttrekkere per tjeneste, med den generelle nøkkel=verdi-tolkningen som
  // reserve dersom en server likevel svarer i det formatet.
  function extractSatskog(text) {
    const t = String(text).replace(/&aring;/gi, "å").replace(/\s+/g, " ");
    const ut = { verdi: null, ekstra: {} };

    let m = t.match(/\bAlder\b\s*[:=]?\s*'?(\d+(?:[.,]\d+)?)/i);
    if (m) ut.verdi = parseFloat(m[1].replace(",", "."));

    m = t.match(/Andel\s+furu\s*[:=]?\s*(\d+(?:[.,]\d+)?)/i);
    if (m) ut.ekstra.andelFuru = parseFloat(m[1].replace(",", "."));
    m = t.match(/Andel\s+lauv\s*[:=]?\s*(\d+(?:[.,]\d+)?)/i);
    if (m) ut.ekstra.andelLauv = parseFloat(m[1].replace(",", "."));
    m = t.match(/Bestandstreslag\s+([A-Za-zÆØÅæøå]+)/i);
    if (m) ut.ekstra.treslag = m[1];

    // Årstall for satellittbildet. Alt som har skjedd etter dette året –
    // ikke minst flatehogst – er usynlig for dataene.
    m = t.match(/(?:\bArstall\b|\bÅrstall\b|\bAar\b|\bÅr\b)\s*[:=]?\s*'?((?:19|20)\d{2})/i);
    if (!m) m = t.match(/\b((?:19|20)\d{2})\b/); // reserve: eneste 4-sifrede årstall
    if (m) ut.ekstra.bildeAr = parseInt(m[1], 10);

    // Størrelsen på skogfiguren svaret gjelder for. Er ruta i analysen mye
    // mindre enn denne, later kartet som om det er mer detaljert enn kilden.
    m = t.match(/Areal\s*[:=]?\s*(\d+(?:[.,]\d+)?)\s*\(?\s*ha/i);
    if (m) ut.ekstra.polygonHa = parseFloat(m[1].replace(",", "."));

    return ut;
  }

  // AR5 oppgir arealtypen som tekst i HTML-svaret. Kodene under er AR5s egne.
  const AREALTYPE_TEKST = [
    ["åpen fastmark", 50], ["apen fastmark", 50],
    ["fulldyrka jord", 21], ["overflatedyrka jord", 22], ["innmarksbeite", 23],
    ["ikke kartlagt", 99], ["snøisbre", 70], ["snoisbre", 70],
    ["ferskvann", 81], ["samferdsel", 12], ["bebygd", 12],
    ["skog", 30], ["myr", 60], ["hav", 82],
  ];

  function extractArealtype(text) {
    const t = String(text).replace(/\s+/g, " ");
    const lav = t.toLowerCase();
    const ut = { verdi: null, ekstra: {} };

    // Foretrekk verdien som står rett etter etiketten "Arealtype".
    for (const [navn, kode] of AREALTYPE_TEKST) {
      if (new RegExp("arealtype\\s+" + navn.replace(/\s+/g, "\\s+") + "\\b", "i").test(lav)) {
        ut.verdi = kode;
        break;
      }
    }
    // Reserve: numerisk kode fra text/plain-varianten.
    if (ut.verdi === null) {
      const m = t.match(/\bartype\b\s*[:=]\s*'?(\d+)/i);
      if (m) ut.verdi = parseInt(m[1], 10);
    }

    const b = t.match(/Skogbonitet\s+([A-Za-zÆØÅæøå]+)/i);
    if (b) ut.ekstra.bonitet = b[1];
    const tr = t.match(/\bTreslag\s+([A-Za-zÆØÅæøå]+)/i);
    if (tr) ut.ekstra.treslagAr5 = tr[1];

    // AR5 oppgir areal i dekar (10 dekar = 1 hektar).
    const ar = t.match(/Areal\s*\(\s*dekar\s*\)\s*[:=]?\s*(\d+(?:[.,]\d+)?)/i);
    if (ar) ut.ekstra.polygonHaAr5 = parseFloat(ar[1].replace(",", ".")) / 10;

    // Verifiseringsdato sier når arealtypen sist ble kontrollert.
    const v = t.match(/Verifiseringsdato\s*[:=]?\s*(\d{2})\.(\d{2})\.((?:19|20)\d{2})/i);
    if (v) ut.ekstra.verifisertAr = parseInt(v[3], 10);

    return ut;
  }

  // Mellomtjenester som kan brukes hvis direkte tilgang blokkeres.
  // Slått AV som standard – forespørslene går da via en tredjepart.
  const PROXIES = [
    { navn: "corsproxy.io", wrap: (u) => "https://corsproxy.io/?url=" + encodeURIComponent(u) },
    { navn: "allorigins", wrap: (u) => "https://api.allorigins.win/raw?url=" + encodeURIComponent(u) },
  ];
  let proxyIndex = -1; // -1 = direkte, ellers indeks i PROXIES

  // AR5 arealtypekoder
  const ARTYPE_SKOG = 30;
  const ARTYPE_MYR = 60;
  const ARTYPE_APEN_FASTMARK = 50;

  let resultLayer = null;
  let running = false;

  const NAA_AR = new Date().getFullYear();

  function vt() { return window.VT || {}; }

  function median(tall) {
    const s = tall.slice().sort((a, b) => a - b);
    if (!s.length) return null;
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  function toast(msg, ms) { if (vt().toast) vt().toast(msg, ms); }

  // ---- JSONP (omgår CORS) -------------------------------------------------
  let jsonpTeller = 0;
  function jsonp(url, timeoutMs) {
    return new Promise((resolve, reject) => {
      const cb = "__vt_cb_" + (++jsonpTeller) + "_" + (jsonpTeller * 7919 % 100000);
      const script = document.createElement("script");
      let ferdig = false;

      const rydd = () => {
        ferdig = true;
        try { delete window[cb]; } catch (e) { window[cb] = undefined; }
        if (script.parentNode) script.parentNode.removeChild(script);
        clearTimeout(timer);
      };
      const timer = setTimeout(() => {
        if (!ferdig) { rydd(); reject(new Error("tidsavbrudd")); }
      }, timeoutMs || 15000);

      window[cb] = (data) => { if (!ferdig) { rydd(); resolve(data); } };
      script.onerror = () => { if (!ferdig) { rydd(); reject(new Error("lastefeil")); } };
      script.src = url + (url.indexOf("?") >= 0 ? "&" : "?") + "callback=" + cb;
      document.head.appendChild(script);
    });
  }

  // Merk: ArcGIS' identify tar hensyn til lagets synlighet ved gjeldende
  // målestokk, og til forholdet mellom mapExtent og imageDisplay. Vi bruker
  // derfor et realistisk kartutsnitt (ca. 1 km) og en vanlig bildestørrelse,
  // ikke en kunstig liten boks – det gir langt mer pålitelige treff.
  function arcgisIdentifyUrl(lat, lng, layerId, altVariant) {
    const dLat = 0.005;
    const dLng = 0.01; // ca. samme avstand i meter som dLat på 60° nord
    const p = new URLSearchParams({
      geometry: JSON.stringify({ x: lng, y: lat, spatialReference: { wkid: 4326 } }),
      geometryType: "esriGeometryPoint",
      sr: "4326",
      // "all" i stedet for "all:2" som reserve – noen tjenester svarer bare på den formen
      layers: altVariant ? "all" : "all:" + layerId,
      tolerance: "3",
      mapExtent: [lng - dLng, lat - dLat, lng + dLng, lat + dLat].join(","),
      imageDisplay: "400,400,96",
      returnGeometry: "false",
      f: "json",
    });
    return ARCGIS_BASE + "/identify?" + p.toString();
  }

  function lesArcgisVerdi(data) {
    if (!data || !data.results || !data.results.length) return null;
    const r = data.results[0];
    const kandidater = [];
    if (r.value !== undefined) kandidater.push(r.value);
    if (r.attributes) {
      for (const k in r.attributes) kandidater.push(r.attributes[k]);
    }
    for (const v of kandidater) {
      if (v === null || v === undefined) continue;
      const s = String(v).trim();
      if (!s || /nodata/i.test(s)) continue;
      const num = parseFloat(s.replace(",", "."));
      if (!isNaN(num)) return num;
    }
    return null;
  }

  // ---- WMS GetFeatureInfo -------------------------------------------------
  // WMS 1.1.1 brukes bevisst: i 1.3.0 er akserekkefølgen for EPSG:4326 snudd
  // (lat,lon), en klassisk feilkilde. 1.1.1 bruker alltid lon,lat.
  //
  // Erfaring fra testing: en kunstig liten 3x3-piksels forespørsel gir tomt
  // svar hos flere servere. Vi bruker derfor et realistisk kartutsnitt med
  // vanlig bildestørrelse og spørrepunkt midt i bildet, og prøver flere
  // koordinatsystemer/formater til ett gir data.
  // Rekkefølgen er satt etter hva NIBIO faktisk svarer på: HTML-varianten gir
  // en utfylt tabell, mens text/plain ofte kommer tom tilbake. Når en variant
  // først gir treff, huskes den for resten av spørringene.
  const WMS_VARIANTS = [
    { srs: "EPSG:4326", info: "text/html" },
    { srs: "EPSG:4326", info: "text/html", utenEkstra: true },
    { srs: "EPSG:4326", info: "text/plain" },
    { srs: "EPSG:4258", info: "text/plain", utenEkstra: true },
    { srs: "EPSG:3857", info: "text/plain", mercator: true, utenEkstra: true },
    { srs: "EPSG:4258", info: "text/html", utenEkstra: true },
  ];

  function toMercator(lat, lng) {
    const x = (lng * 20037508.34) / 180;
    let y = Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) / (Math.PI / 180);
    y = (y * 20037508.34) / 180;
    return { x, y };
  }

  function featureInfoUrl(svc, lat, lng, variant) {
    let bbox;
    if (variant.mercator) {
      const m = toMercator(lat, lng);
      const d = 300; // meter
      bbox = [m.x - d, m.y - d, m.x + d, m.y + d].join(",");
    } else {
      const dLat = 0.002;
      const dLng = 0.004; // ~samme avstand i meter som dLat på 60° nord
      bbox = [lng - dLng, lat - dLat, lng + dLng, lat + dLat].join(",");
    }
    // Flere lag kan spørres i én forespørsel – gratis tilleggsinformasjon.
    const lagListe = (!variant.utenEkstra && svc.layerExtra)
      ? svc.layer + "," + svc.layerExtra
      : svc.layer;

    const p = new URLSearchParams({
      SERVICE: "WMS", VERSION: "1.1.1", REQUEST: "GetFeatureInfo",
      LAYERS: lagListe, QUERY_LAYERS: lagListe,
      SRS: variant.srs, BBOX: bbox,
      WIDTH: "101", HEIGHT: "101", X: "50", Y: "50",
      INFO_FORMAT: variant.info, FEATURE_COUNT: "3",
    });
    return svc.base + (svc.base.indexOf("?") >= 0 ? "&" : "?") + p.toString();
  }

  function stripHtml(s) {
    return String(s)
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(tr|p|div|li)>/gi, "\n")
      .replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;/gi, " ");
  }

  function parseFeatureInfo(text) {
    const out = {};
    if (!text) return out;
    const re = /^[\s\-*]*([A-Za-z_][\w \-\.]*?)\s*[:=]\s*'?([^'\n\r]*?)'?\s*$/gm;
    let m;
    while ((m = re.exec(text)) !== null) {
      const key = m[1].trim().toLowerCase();
      const val = m[2].trim();
      if (val !== "" && !(key in out)) out[key] = val;
    }
    return out;
  }

  function pickValue(parsed, keys) {
    for (const k of keys) {
      if (k in parsed) {
        const num = parseFloat(String(parsed[k]).replace(",", "."));
        if (!isNaN(num)) return num;
      }
    }
    for (const k in parsed) {
      if (k.indexOf("bbox") >= 0) continue;
      const num = parseFloat(String(parsed[k]).replace(",", "."));
      if (!isNaN(num)) return num;
    }
    return null;
  }

  // Husker hvilken spørrevariant som ga treff for hver tjeneste, slik at
  // resten av rutene i en analyse går rett på den som virker.
  const virkendeVariant = {};

  // Mellomlager for punktoppslag. Nøkkelen rundes til ~11 m, så nabo-analyser
  // og gjentatte kjøringer over samme område slipper å spørre tjenestene på
  // nytt. Det gjør finmasket analyse langt raskere og skåner kildene.
  const punktCache = new Map();

  async function sporPunktCachet(navn, lat, lng) {
    const nokkel = navn + ":" + lat.toFixed(4) + "," + lng.toFixed(4);
    if (punktCache.has(nokkel)) return punktCache.get(nokkel);
    const r = await sporPunkt(navn, lat, lng);
    // Bare vellykkede svar mellomlagres – feil skal kunne prøves på nytt.
    if (r.ok) punktCache.set(nokkel, r);
    return r;
  }

  function nettverksfeil(e) {
    return e instanceof TypeError ||
      /Failed to fetch|NetworkError|load failed/i.test(e.message || "");
  }

  // Returnerer alltid et objekt – kaster aldri – slik at feiltypen kan vises.
  async function sporPunkt(navn, lat, lng) {
    const svc = SOURCES[navn];

    if (svc.mode === "arcgis") {
      for (const alt of [false, true]) {
        try {
          const data = await jsonp(arcgisIdentifyUrl(lat, lng, svc.layerId, alt));
          const verdi = lesArcgisVerdi(data);
          if (verdi !== null) return { ok: true, verdi, rå: JSON.stringify(data).slice(0, 400) };
          if (alt) return { ok: true, verdi: null, rå: JSON.stringify(data).slice(0, 400) };
        } catch (e) {
          if (alt) return { ok: false, feiltype: "blokkert", melding: e.message || String(e) };
        }
      }
      return { ok: true, verdi: null };
    }

    // WMS: prøv den varianten som virket sist, ellers alle i tur og orden.
    const rekkefolge = virkendeVariant[navn]
      ? [virkendeVariant[navn]].concat(WMS_VARIANTS.filter((v) => v !== virkendeVariant[navn]))
      : WMS_VARIANTS;

    let sisteRå = "";
    let sisteFeil = null;

    for (const variant of rekkefolge) {
      let url = featureInfoUrl(svc, lat, lng, variant);
      if (proxyIndex >= 0) url = PROXIES[proxyIndex].wrap(url);
      try {
        const resp = await fetch(url);
        if (!resp.ok) { sisteFeil = { feiltype: "http", melding: "HTTP " + resp.status }; continue; }
        let text = await resp.text();
        if (variant.info === "text/html") text = stripHtml(text);
        sisteRå = text.slice(0, 400);

        // Først tjenestespesifikk uttrekker (tabellformat), så den generelle.
        let verdi = null, ekstra = {};
        if (svc.extract) {
          const r = svc.extract(text);
          verdi = r.verdi;
          ekstra = r.ekstra || {};
        }
        if (verdi === null) verdi = pickValue(parseFeatureInfo(text), svc.keys);

        if (verdi !== null) {
          virkendeVariant[navn] = variant;
          return { ok: true, verdi, ekstra, rå: sisteRå, variant: variant.srs + " / " + variant.info };
        }
      } catch (e) {
        sisteFeil = {
          feiltype: nettverksfeil(e) ? "blokkert" : "annet",
          melding: e.message || String(e),
        };
      }
    }

    if (sisteFeil && !sisteRå) return { ok: false, feiltype: sisteFeil.feiltype, melding: sisteFeil.melding };
    return { ok: true, verdi: null, rå: sisteRå };
  }

  // ---- Poengberegning -----------------------------------------------------
  function normNaturskog(v) {
    if (v === null || isNaN(v)) return null;
    if (v <= 1.0001) return Math.max(0, v);
    if (v <= 100) return Math.max(0, v / 100);
    return null;
  }

  // ---- Poeng per art -----------------------------------------------------
  //
  // Storfugl og orrfugl vil ha ulike ting, og en felles score skjuler hvilken
  // art et område faktisk peker mot. Derfor regnes de hver for seg, og hver
  // score måles mot hva som var oppnåelig med de dataene ruta faktisk fikk.
  //
  // Storfugl: eldre, lite påvirket barskog, gjerne furu, med bærlyng i bunnen.
  // Orrfugl:  mosaikk av yngre skog, lauv og myr — kantsonene er avgjørende.

  function scoreStorfugl(cell, naboer) {
    const g = [];
    let p = 0, maks = 0;
    const art = cell.arealtype;
    const erSkog = art === ARTYPE_SKOG, erMyr = art === ARTYPE_MYR;
    const ns = normNaturskog(cell.naturskog);
    const a = cell.alder;
    const furu = cell.ekstra.andelFuru;

    if (art !== null) {
      maks += 2;
      if (erSkog) { p += 2; g.push("Skogsmark."); }
      else if (erMyr) g.push("Myr – storfugl bruker kanten, ikke selve myra.");
    }
    if (ns !== null) {
      maks += 3;
      if (ns >= 0.7) { p += 3; g.push(`Høy naturskogssannsynlighet (${Math.round(ns * 100)} %) – kjernehabitat.`); }
      else if (ns >= 0.4) { p += 2; g.push(`Middels naturskogssannsynlighet (${Math.round(ns * 100)} %).`); }
      else if (ns >= 0.2) { p += 1; g.push(`Noe naturskogspreg (${Math.round(ns * 100)} %).`); }
    }
    if (a !== null && a > 0) {
      maks += 3;
      if (a >= 80) { p += 3; g.push(`Gammel skog (~${Math.round(a)} år) – viktigst for storfugl.`); }
      else if (a >= 60) { p += 2; g.push(`Eldre skog (~${Math.round(a)} år).`); }
      else if (a >= 40) { p += 1; g.push(`Middelaldrende skog (~${Math.round(a)} år).`); }
      else g.push(`Ung skog (~${Math.round(a)} år) – lite aktuelt for storfugl.`);
    }
    if (furu !== undefined) {
      maks += 2;
      if (furu >= 50) { p += 2; g.push(`Furudominert (${Math.round(furu)} %) – klassisk storfuglterreng.`); }
      else if (furu >= 30) { p += 1; g.push(`Noe furu (${Math.round(furu)} %).`); }
    }
    if (art !== null) {
      maks += 2;
      if (erSkog && naboer.some((n) => n && n.arealtype === ARTYPE_MYR)) {
        p += 2; g.push("Kantsone mot myr – bær og insekter i september.");
      }
    }
    return { poeng: p, maks, andel: maks ? p / maks : 0, grunner: g };
  }

  function scoreOrrfugl(cell, naboer) {
    const g = [];
    let p = 0, maks = 0;
    const art = cell.arealtype;
    const erSkog = art === ARTYPE_SKOG, erMyr = art === ARTYPE_MYR;
    const ns = normNaturskog(cell.naturskog);
    const a = cell.alder;
    const lauv = cell.ekstra.andelLauv;

    if (art !== null) {
      maks += 2;
      if (erMyr) { p += 2; g.push("Myr – kjerneområde for orrfugl."); }
      else if (erSkog) { p += 1; g.push("Skogsmark."); }
    }
    if (art !== null) {
      maks += 3;
      const myrNabo = naboer.some((n) => n && n.arealtype === ARTYPE_MYR);
      const skogNabo = naboer.some((n) => n && n.arealtype === ARTYPE_SKOG);
      if (erSkog && myrNabo) { p += 3; g.push("Kantsone skog/myr – det viktigste for orrfugl i september."); }
      else if (erMyr && skogNabo) { p += 3; g.push("Myr inntil skog – beite og dekning på samme sted."); }
    }
    if (a !== null && a > 0) {
      maks += 3;
      if (a >= 10 && a < 40) { p += 3; g.push(`Ung skog (~${Math.round(a)} år) – gjenvekst som orrfugl liker.`); }
      else if (a < 70) { p += 2; g.push(`Middelaldrende skog (~${Math.round(a)} år).`); }
      else { p += 1; g.push(`Eldre skog (~${Math.round(a)} år) – mindre typisk, men brukbart i mosaikk.`); }
    }
    if (lauv !== undefined) {
      maks += 2;
      if (lauv >= 30) { p += 2; g.push(`Mye lauv (${Math.round(lauv)} %) – bjørk er viktig for orrfugl.`); }
      else if (lauv >= 15) { p += 1; g.push(`Noe lauvinnslag (${Math.round(lauv)} %).`); }
    }
    if (a !== null && a > 0) {
      maks += 2;
      const ulikAlder = naboer.some((n) => n && n.alder !== null && n.alder > 0 && Math.abs(n.alder - a) >= 30);
      if (ulikAlder) { p += 2; g.push("Aldersmosaikk i nærheten – variasjon orrfugl trives i."); }
    }
    if (ns !== null) {
      maks += 1;
      if (ns >= 0.4) { p += 1; g.push("Noe naturskogspreg gir ro og dekning."); }
    }
    return { poeng: p, maks, andel: maks ? p / maks : 0, grunner: g };
  }

  // Slår de to artsscorene sammen til én vurdering per rute: hvor lovende
  // ruta er (styrken til den beste arten), og hvilken art den peker mot.
  function scoreCell(cell, neighbours) {
    const art = cell.arealtype;
    if (art !== null && art !== ARTYPE_SKOG && art !== ARTYPE_MYR && art !== ARTYPE_APEN_FASTMARK) {
      return { niva: "uegnet", dominant: null, grunner: ["Arealtypen er ikke skog eller myr."] };
    }

    const s = scoreStorfugl(cell, neighbours);
    const o = scoreOrrfugl(cell, neighbours);
    if (s.maks === 0 && o.maks === 0) {
      return { niva: "uegnet", dominant: null, grunner: ["Ingen data for denne ruta."] };
    }

    let kilder = 0;
    if (cell.arealtype !== null) kilder++;
    if (cell.naturskog !== null) kilder++;
    if (cell.alder !== null) kilder++;

    const beste = Math.max(s.andel, o.andel);
    let niva;
    if (beste >= 0.72) niva = "svaert_god";
    else if (beste >= 0.55) niva = "god";
    else if (beste >= 0.38) niva = "middels";
    else niva = "lav";

    // Er forskjellen liten, er det uærlig å utrope en vinner.
    const diff = s.andel - o.andel;
    let dominant;
    if (Math.abs(diff) < 0.12) dominant = "begge";
    else dominant = diff > 0 ? "storfugl" : "orrfugl";

    return { niva, dominant, storfugl: s, orrfugl: o, beste, kilder };
  }

  // Bare de lovende rutene tegnes. Å fargelegge alt gjør kartet ulesbart –
  // og poenget er nettopp å se terrenget (koter, bekker, myrer) under de
  // områdene som peker seg ut. Den stiplede rammen viser uansett hvor
  // analysen er kjørt, så «lite lovende» trenger ingen farge.
  // Fargen sier hvilken ART ruta peker mot, styrken sier hvor lovende den er.
  const ART_FARGE = {
    storfugl: "#9b7bf5", // fiolett
    orrfugl:  "#ef9a3d", // oransje
    begge:    "#33d17a", // grønn
  };
  const ART_NAVN = {
    storfugl: "Storfugl",
    orrfugl: "Orrfugl",
    begge: "Begge like aktuelle",
  };
  const NIVA_STIL = {
    svaert_god: { opacity: 0.55, kant: 1.6, tekst: "Svært lovende" },
    god:        { opacity: 0.36, kant: 0,   tekst: "Lovende" },
    middels:    { opacity: 0.18, kant: 0,   tekst: "Middels" },
    lav:        { opacity: 0.00, kant: 0,   tekst: "Lite lovende" },
    uegnet:     { opacity: 0.00, kant: 0,   tekst: "Uegnet" },
  };

  // ---- Hurtigtest av datakildene -----------------------------------------
  let testMarkor = null;

  async function testKilder() {
    const map = vt().map && vt().map();
    if (!map) return;
    const c = map.getCenter();

    // Vis tydelig HVOR vi tester – ellers er det umulig å vurdere svaret.
    if (testMarkor) map.removeLayer(testMarkor);
    testMarkor = L.circleMarker([c.lat, c.lng], {
      radius: 9, color: "#e6be5a", weight: 3, fillColor: "#e6be5a", fillOpacity: 0.35,
    }).addTo(map).bindPopup("Testpunkt for datakildene").openPopup();

    const koord = `${c.lat.toFixed(5)}, ${c.lng.toFixed(5)}`;
    settInfo(`<strong>Tester datakildene...</strong><br>Punkt: ${koord}`);

    const navn = Object.keys(SOURCES);
    const res = await Promise.all(navn.map((n) => sporPunkt(n, c.lat, c.lng)));

    const linjer = navn.map((n, i) => {
      const r = res[i];
      const l = SOURCES[n].label;
      if (r.ok && r.verdi !== null) {
        return `✅ <strong>${l}</strong>: verdi ${r.verdi}` +
          (r.variant ? ` <small>(${r.variant})</small>` : "");
      }
      if (r.ok) {
        return `⚠️ <strong>${l}</strong>: svarte, men uten verdi her` +
          (r.rå ? `<br><small style="opacity:.75;">Svar: <code>${escapeHtml(r.rå.slice(0, 200))}</code></small>` : "");
      }
      if (r.feiltype === "blokkert") return `⛔️ <strong>${l}</strong>: blokkert av nettleseren (CORS)`;
      return `❌ <strong>${l}</strong>: ${escapeHtml(r.melding || "")}`;
    });

    const noenBlokkert = res.some((r) => !r.ok && r.feiltype === "blokkert");
    const noenTomme = res.some((r) => r.ok && r.verdi === null);

    settInfo(
      `<strong>Test av datakilder</strong><br>` +
      `Testpunkt (midt i kartet): <code>${koord}</code> – markert med gul ring.<br><br>` +
      linjer.join("<br>") +
      (noenTomme
        ? `<br><br><small>Står det «uten verdi», sjekk at den gule ringen faktisk ligger i skog. ` +
          `Kartutsnittets midtpunkt kan lett havne på vann, myr eller dyrket mark.</small>`
        : "") +
      (noenBlokkert
        ? `<br><br>Noen kilder er blokkert. Prøv via en mellomtjeneste:` +
          `<br><button class="btn small" id="btnProxyPa" style="margin-top:6px;">Slå på mellomtjeneste og test igjen</button>`
        : "") +
      lukkKnapp()
    );
    koblePanelKnapper();
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  // ---- Kjør analyse -------------------------------------------------------
  async function analyser() {
    const map = vt().map && vt().map();
    if (!map) return;

    if (running) { toast("Analysen kjører allerede."); return; }
    if (!navigator.onLine) {
      toast("Områdeanalysen henter data fra nett, og krever internett.", 5000);
      return;
    }
    if (location.protocol === "file:") {
      settInfo(
        "<strong>Analysen virker ikke i den lokale enkeltfil-versjonen</strong><br>" +
        "Nettlesere blokkerer datahenting fra filer som åpnes direkte fra disk. " +
        "Bruk den nettbaserte versjonen (Netlify-adressen) for å kjøre analysen." +
        lukkKnapp()
      );
      koblePanelKnapper();
      return;
    }
    if (map.getZoom() < 10) {
      toast("Zoom nærmere (minst zoomnivå 10) før du analyserer.", 5000);
      return;
    }

    const valgt = document.getElementById("analyseOpplosning");
    const N = valgt ? parseInt(valgt.value, 10) : 11;

    const bounds = map.getBounds();
    const south = bounds.getSouth(), north = bounds.getNorth();
    const west = bounds.getWest(), east = bounds.getEast();
    const dLat = (north - south) / N, dLng = (east - west) / N;

    // Rutestørrelse i meter, slik at du vet hvor grov analysen faktisk blir.
    const midtLat = (north + south) / 2;
    const meterLat = Math.round(dLat * 111320);
    const meterLng = Math.round(dLng * 111320 * Math.cos((midtLat * Math.PI) / 180));

    // Advar før de tyngste kjøringene – de gjør mange oppslag mot offentlige
    // tjenester og tar tid.
    if (N >= 15) {
      const maksOppslag = N * N * 3;
      const ok = window.confirm(
        `${N}×${N} = ${N * N} ruter à ca. ${meterLng}×${meterLat} m.\n` +
        `Dette gjør inntil ${maksOppslag} oppslag mot karttjenestene og kan ta ett til to minutter.\n\n` +
        `Fortsette?`
      );
      if (!ok) return;
    }

    const cells = [];
    for (let row = 0; row < N; row++) {
      for (let col = 0; col < N; col++) {
        const s = south + row * dLat, n = s + dLat;
        const w = west + col * dLng, e = w + dLng;
        cells.push({
          row, col, bounds: [[s, w], [n, e]],
          lat: (s + n) / 2, lng: (w + e) / 2,
          naturskog: null, alder: null, arealtype: null, ekstra: {}, feil: [],
        });
      }
    }

    running = true;
    const ui = visProgress(cells.length);
    const status = {};
    Object.keys(SOURCES).forEach((n) => { status[n] = { ok: 0, blokkert: 0, annet: 0, sisteFeil: "" }; });
    let ferdig = 0;

    function bokfor(cell, navn, r) {
      if (r.ok) {
        cell[navn] = r.verdi;
        if (r.ekstra) Object.assign(cell.ekstra, r.ekstra);
        if (r.verdi !== null) status[navn].ok++;
      } else {
        cell.feil.push(navn);
        if (r.feiltype === "blokkert") status[navn].blokkert++;
        else status[navn].annet++;
        status[navn].sisteFeil = r.melding;
      }
    }

    let hoppetOver = 0;

    async function behandle(cell) {
      // Arealtypen spørres først. Er ruta vann, dyrket mark eller bebyggelse,
      // er den uaktuell uansett – da sparer vi to oppslag per rute. På et
      // finmasket rutenett utgjør det svært mange færre forespørsler.
      const rArt = await sporPunktCachet("arealtype", cell.lat, cell.lng);
      bokfor(cell, "arealtype", rArt);

      const a = cell.arealtype;
      const uaktuell = a !== null && a !== ARTYPE_SKOG && a !== ARTYPE_MYR && a !== ARTYPE_APEN_FASTMARK;
      if (uaktuell) {
        hoppetOver++;
        ferdig++;
        ui.oppdater(ferdig);
        return;
      }

      await Promise.all(["naturskog", "alder"].map(async (navn) => {
        bokfor(cell, navn, await sporPunktCachet(navn, cell.lat, cell.lng));
      }));
      ferdig++;
      ui.oppdater(ferdig);
    }

    const KO = cells.slice();
    const ARBEIDERE = 8;
    await Promise.all(Array.from({ length: ARBEIDERE }, async () => {
      while (KO.length) {
        const c = KO.shift();
        if (c) await behandle(c);
      }
    }));

    ui.fjern();
    running = false;

    const totaltOk = Object.keys(status).reduce((s, n) => s + status[n].ok, 0);
    if (totaltOk === 0) { visIngenData(status); return; }
    tegnResultat(map, cells, N, status, { meterLat, meterLng, hoppetOver });
  }

  // Kantsonen mellom skog og myr er det tyngst vektede septembersignalet.
  // Tidligere så vi bare på de fire nærmeste rutene, noe som ga en alvorlig
  // skjevhet: med et finmasket rutenett lå alle naboene inne i SAMME
  // skogfigur, ingen nabo hadde annen arealtype, og kantbonusen forsvant.
  // Ekte kantterreng fikk da LAVERE score jo finere rutenett man valgte.
  //
  // Nå søkes det i stedet innenfor en fast avstand i meter, uavhengig av
  // hvor finmasket rutenettet er. Det koster ingen ekstra oppslag – vi
  // bruker data vi allerede har hentet.
  const KANT_AVSTAND_M = 250;

  function naboRadius(celleMeter) {
    return Math.max(1, Math.min(5, Math.round(KANT_AVSTAND_M / Math.max(celleMeter, 1))));
  }

  function naboer(cells, cell, radius) {
    const r = radius || 1;
    const ut = [];
    for (const x of cells) {
      if (x === cell) continue;
      if (Math.abs(x.row - cell.row) <= r && Math.abs(x.col - cell.col) <= r) ut.push(x);
    }
    return ut;
  }

  function tegnResultat(map, cells, N, status, info) {
    if (resultLayer) { map.removeLayer(resultLayer); resultLayer = null; }
    resultLayer = L.layerGroup().addTo(map);

    // Ramme rundt hele det analyserte området, slik at det alltid er tydelig
    // hvor analysen gjelder – også der rutene er tomme/uegnet og usynlige.
    const alle = cells.map((c) => c.bounds);
    const sør = Math.min.apply(null, alle.map((b) => b[0][0]));
    const vest = Math.min.apply(null, alle.map((b) => b[0][1]));
    const nord = Math.max.apply(null, alle.map((b) => b[1][0]));
    const øst = Math.max.apply(null, alle.map((b) => b[1][1]));
    L.rectangle([[sør, vest], [nord, øst]], {
      color: "#e6be5a", weight: 2, dashArray: "6 5", fill: false,
    }).addTo(resultLayer).bindPopup("Analysert område");

    const celleMeter = (info.meterLat + info.meterLng) / 2;
    const radius = naboRadius(celleMeter);

    let antallGode = 0;
    const artTeller = { storfugl: 0, orrfugl: 0, begge: 0 };
    cells.forEach((cell) => {
      const res = scoreCell(cell, naboer(cells, cell, radius));
      const stil = NIVA_STIL[res.niva];
      if (!stil || stil.opacity === 0) return;
      if (res.niva === "svaert_god" || res.niva === "god") {
        antallGode++;
        if (res.dominant) artTeller[res.dominant]++;
      }

      const farge = ART_FARGE[res.dominant] || ART_FARGE.begge;
      const rect = L.rectangle(cell.bounds, {
        color: farge,
        weight: stil.kant,
        opacity: stil.kant ? 0.9 : 0,
        fillColor: farge,
        fillOpacity: stil.opacity,
      }).addTo(resultLayer);

      const detaljer = [];
      const nsP = normNaturskog(cell.naturskog);
      if (nsP !== null) detaljer.push("Naturskog: " + Math.round(nsP * 100) + " %");
      if (cell.alder !== null) detaljer.push("Skogalder: ~" + Math.round(cell.alder) + " år");
      if (cell.arealtype !== null) detaljer.push("Arealtype (AR5-kode): " + cell.arealtype);
      if (cell.ekstra.andelFuru !== undefined) detaljer.push("Furu: " + Math.round(cell.ekstra.andelFuru) + " %");
      if (cell.ekstra.andelLauv !== undefined) detaljer.push("Lauv: " + Math.round(cell.ekstra.andelLauv) + " %");
      if (cell.feil.length) detaljer.push("Manglet data fra: " + cell.feil.join(", "));

      // Dataalder – det viktigste forbeholdet ved hver enkelt rute.
      const bAr = cell.ekstra.bildeAr;
      let aldersVarsel = "";
      if (bAr) {
        const dataAlder = NAA_AR - bAr;
        detaljer.push(`Satellittbilde fra ${bAr} (${dataAlder} år gammelt)`);
        if (dataAlder >= 8) {
          aldersVarsel =
            `<br><br><span style="color:#e6be5a;">⚠️ Skogdataene er fra ${bAr}. ` +
            `Hogst etter den tid vises ikke. Sjekk flyfoto før du stoler på dette.</span>`;
        }
      } else {
        aldersVarsel =
          `<br><br><span style="color:#e6be5a;">⚠️ Ukjent bildeår på skogdataene – ` +
          `de kan være mange år gamle. Sjekk flyfoto.</span>`;
      }
      if (cell.ekstra.verifisertAr) detaljer.push(`Arealtype verifisert ${cell.ekstra.verifisertAr}`);

      const flyfotoLenke =
        `<br><br><a href="https://www.google.com/maps/@${cell.lat.toFixed(5)},${cell.lng.toFixed(5)},1000m/data=!3m1!1e3" ` +
        `target="_blank" rel="noopener" style="color:#8fd3ff;">🛰️ Se flyfoto for denne ruta</a>`;

      const s2 = res.storfugl, o2 = res.orrfugl;
      const pst = (x) => Math.round(x.andel * 100);
      const artLinje =
        res.dominant === "begge"
          ? `<strong>Begge arter like aktuelle her</strong>`
          : `<strong>${ART_NAVN[res.dominant]} mest sannsynlig</strong>`;

      rect.bindPopup(
        `${artLinje}<br><span style="opacity:.8;">${stil.tekst} – september</span><br><br>` +
        `<span style="color:${ART_FARGE.storfugl};">■</span> Storfugl ${pst(s2)} % ` +
        `<small>(${s2.poeng}/${s2.maks} p)</small><br>` +
        `<span style="color:${ART_FARGE.orrfugl};">■</span> Orrfugl ${pst(o2)} % ` +
        `<small>(${o2.poeng}/${o2.maks} p)</small>` +
        `<br><br><u>Storfugl</u><br>` + (s2.grunner.length ? s2.grunner.map((g) => "• " + g).join("<br>") : "• ingen utslag") +
        `<br><br><u>Orrfugl</u><br>` + (o2.grunner.length ? o2.grunner.map((g) => "• " + g).join("<br>") : "• ingen utslag") +
        `<br><br><small>Basert på ${res.kilder} av 3 datakilder.` +
        (res.kilder < 3 ? " Færre kilder gir mer usikker vurdering." : "") + "</small>" +
        (detaljer.length ? "<br><small>" + detaljer.join("<br>") + "</small>" : "") +
        aldersVarsel +
        flyfotoLenke,
        { maxHeight: 280, maxWidth: 300, autoPanPadding: L.point(12, 96) }
      );
    });

    // --- Forbehold basert på hva dataene faktisk viste seg å være ---
    const bildeAr = cells.map((c) => c.ekstra.bildeAr).filter(Boolean);
    const medianAr = median(bildeAr);
    const polygonHa = cells
      .map((c) => c.ekstra.polygonHa || c.ekstra.polygonHaAr5)
      .filter((v) => typeof v === "number" && v > 0);
    const medianPolygon = median(polygonHa);
    const celleHa = (info.meterLat * info.meterLng) / 10000;

    let forbehold = "";
    if (medianAr) {
      const alder = NAA_AR - medianAr;
      forbehold +=
        `<br><br><span style="color:${alder >= 8 ? "#e6be5a" : "var(--text-dim)"};">` +
        `📅 Skogdataene er i snitt fra <strong>${medianAr}</strong> (${alder} år gamle). ` +
        (alder >= 8
          ? `Flatehogst etter den tid er usynlig for analysen — sjekk flyfoto før du drar ut.`
          : `Relativt ferske data.`) +
        `</span>`;
    } else {
      forbehold +=
        `<br><br><span style="color:#e6be5a;">📅 Fikk ikke lest bildeår fra skogdataene. ` +
        `Anta at de kan være mange år gamle.</span>`;
    }

    if (medianPolygon && medianPolygon > celleHa * 3) {
      forbehold +=
        `<br><br><span style="color:#e6be5a;">🔍 Rutene (${celleHa.toFixed(1)} ha) er mye mindre enn ` +
        `kildedataenes figurer (typisk ${medianPolygon.toFixed(0)} ha). Naboruter henter da samme verdi — ` +
        `kartet blir ikke mer presist av finere rutenett. Vurder en grovere innstilling.</span>`;
    }

    const mangler = Object.keys(SOURCES).filter((n) => status[n].ok === 0);
    settInfo(
      `<strong>Septemberanalyse – skogsfugl</strong><br>` +
      `<span style="color:var(--accent-2);">Rutenett ${N}×${N} — hver rute ` +
      `<strong>${info.meterLng} × ${info.meterLat} m</strong>. Kantsoner søkt innenfor ${KANT_AVSTAND_M} m.</span><br><br>` +
      `<span style="color:${ART_FARGE.storfugl};">■</span> Storfugl &nbsp; ` +
      `<span style="color:${ART_FARGE.orrfugl};">■</span> Orrfugl &nbsp; ` +
      `<span style="color:${ART_FARGE.begge};">■</span> Begge<br>` +
      `<small>Fargen viser hvilken art ruta peker mot, styrken på fargen hvor lovende den er. ` +
      `Trykk på en rute for å se poeng for begge arter.</small><br>` +
      `${antallGode} av ${cells.length} ruter kom ut som lovende eller bedre` +
      (antallGode
        ? ` — av dem <strong style="color:${ART_FARGE.storfugl};">${artTeller.storfugl} storfugl</strong>, ` +
          `<strong style="color:${ART_FARGE.orrfugl};">${artTeller.orrfugl} orrfugl</strong>, ` +
          `<strong style="color:${ART_FARGE.begge};">${artTeller.begge} begge</strong>`
        : "") +
      (info.hoppetOver ? `, og ${info.hoppetOver} ruter ble luket bort som vann/dyrket mark/bebyggelse` : "") +
      `.` +
      (mangler.length
        ? `<br><br><span style="color:var(--danger);">Merk: fikk ikke data for ` +
          mangler.map((n) => SOURCES[n].label.toLowerCase()).join(", ") +
          `. Vurderingen bygger da bare på de øvrige kildene og blir mindre presis.</span>` +
          (mangler.some((n) => status[n].blokkert > 0)
            ? `<br><button class="btn small" id="btnProxyPa" style="margin-top:6px;">Prøv de manglende via mellomtjeneste</button>`
            : "")
        : "") +
      forbehold +
      `<br><br><small>Kilder: Miljødirektoratet/Landbruksdirektoratet (naturskog), NIBIO (SAT-SKOG, AR5). ` +
      `Modellert kartdata som ikke er verifisert i felt – bruk som utgangspunkt for hvor du skal lete, ` +
      `ikke som svar på hvor fuglen står.</small>` +
      lukkKnapp()
    );
    koblePanelKnapper();
  }

  function visIngenData(status) {
    const linjer = Object.keys(SOURCES).map((n) => {
      const s = status[n];
      const l = SOURCES[n].label;
      if (s.blokkert > 0) return `⛔️ <strong>${l}</strong>: blokkert av nettleseren (CORS)`;
      if (s.annet > 0) return `❌ <strong>${l}</strong>: ${s.sisteFeil}`;
      return `⚠️ <strong>${l}</strong>: svarte, men uten data her`;
    });
    const noenBlokkert = Object.keys(status).some((n) => status[n].blokkert > 0);
    settInfo(
      `<strong>Analysen fikk ingen data</strong><br>` +
      linjer.join("<br>") +
      (noenBlokkert
        ? `<br><br>«Blokkert» betyr at karttjenesten ikke tillater direkte oppslag fra nettleseren. ` +
          `Du kan prøve å hente dataene via en mellomtjeneste i stedet:` +
          `<br><button class="btn small" id="btnProxyPa" style="margin-top:6px;">Slå på mellomtjeneste og prøv igjen</button>`
        : "") +
      `<br><br><small>Selve kartet og de vanlige kartlagene virker som normalt.</small>` +
      lukkKnapp()
    );
    koblePanelKnapper();
  }

  // ---- UI-hjelpere --------------------------------------------------------
  function lukkKnapp() {
    return `<br><button class="btn small" id="btnLukkInfo" style="margin-top:8px;">Lukk</button>`;
  }

  function settInfo(html) {
    const el = document.getElementById("analyseInfo");
    if (!el) return;
    el.style.display = "block";
    el.innerHTML = html;
  }

  function koblePanelKnapper() {
    const lukk = document.getElementById("btnLukkInfo");
    if (lukk) lukk.addEventListener("click", () => {
      const el = document.getElementById("analyseInfo");
      if (el) { el.style.display = "none"; el.innerHTML = ""; }
    });
    const proxy = document.getElementById("btnProxyPa");
    if (proxy) proxy.addEventListener("click", async () => {
      proxyIndex = 0;
      toast("Prøver via mellomtjeneste (" + PROXIES[0].navn + ")...", 4000);
      await analyser();
    });
  }

  function visProgress(total) {
    const el = document.createElement("div");
    el.className = "toast";
    el.innerHTML =
      `<div>Analyserer område for september... <span id="anProgTxt">0 / ${total}</span></div>` +
      `<div class="progress-wrap"><div class="progress-bar" id="anProgBar"></div></div>`;
    document.body.appendChild(el);
    return {
      oppdater(n) {
        const t = document.getElementById("anProgTxt");
        const b = document.getElementById("anProgBar");
        if (t) t.textContent = `${n} / ${total}`;
        if (b) b.style.width = Math.round((n / total) * 100) + "%";
      },
      fjern() { el.remove(); },
    };
  }

  function fjernResultat() {
    const map = vt().map && vt().map();
    if (map) {
      if (resultLayer) { map.removeLayer(resultLayer); resultLayer = null; }
      if (testMarkor) { map.removeLayer(testMarkor); testMarkor = null; }
    }
    const el = document.getElementById("analyseInfo");
    if (el) { el.style.display = "none"; el.innerHTML = ""; }
  }

  // ---- Alltid synlig zoom- og rutestørrelsesvisning ----------------------
  //
  // Rutestørrelsen avhenger både av valgt oppløsning OG av hvor mye du har
  // zoomet. Den er derfor mest nyttig å se FØR analysen kjøres, ikke etterpå.
  // Terskelen på ~300 m kommer av at skogfigurene i kildedataene typisk er
  // 10–40 hektar; mindre ruter deler opp samme figur uten å tilføre noe.
  function ruteStorrelse() {
    const map = vt().map && vt().map();
    if (!map) return null;
    const valgt = document.getElementById("analyseOpplosning");
    const N = valgt ? parseInt(valgt.value, 10) : 11;
    const b = map.getBounds();
    const midtLat = (b.getNorth() + b.getSouth()) / 2;
    const mLat = ((b.getNorth() - b.getSouth()) / N) * 111320;
    const mLng = ((b.getEast() - b.getWest()) / N) * 111320 * Math.cos((midtLat * Math.PI) / 180);
    return { N, mLat: Math.round(mLat), mLng: Math.round(mLng), kort: Math.round(Math.min(mLat, mLng)), zoom: map.getZoom() };
  }

  function oppdaterBadge() {
    const el = document.getElementById("zoomBadge");
    if (!el) return;
    const r = ruteStorrelse();
    if (!r) return;

    // To feilkilder trekker i hver sin retning:
    //  - For FINE ruter deler opp samme skogfigur uten ny informasjon.
    //  - For GROVE ruter gjør kantsonesøket upresist: søket bruker nærmeste
    //    naborute, så med 1000-metersruter deles kantbonus ut til alt innenfor
    //    1000 m i stedet for de tiltenkte 250 m.
    // Beste område er derfor 300–600 m, ikke «så fint som mulig».
    let klasse, rad2;
    if (r.zoom < 10) {
      klasse = "for-fin";
      rad2 = "Zoom inn til minst 10 for å analysere";
    } else if (r.kort > 1200) {
      klasse = "for-fin";
      rad2 = "For grovt – kantsoner blir upresise";
    } else if (r.kort > 600) {
      klasse = "grense";
      rad2 = "Litt grovt – kantsoner overrapporteres";
    } else if (r.kort >= 300) {
      klasse = "god";
      rad2 = "Godt område (300–600 m)";
    } else if (r.kort >= 200) {
      klasse = "grense";
      rad2 = "Litt fint – finere enn kildedataene";
    } else {
      klasse = "for-fin";
      rad2 = "For fint – velg grovere eller zoom ut";
    }

    el.className = "zoom-badge " + klasse;
    el.innerHTML =
      `<span class="prikk"></span>Zoom ${r.zoom} · ${r.N}×${r.N} · rute ≈ ${r.kort} m<br>` +
      `<span class="rad2">${rad2}</span>`;
  }

  function init() {
    const b1 = document.getElementById("btnAnalyser");
    if (b1) b1.addEventListener("click", analyser);
    const b2 = document.getElementById("btnFjernAnalyse");
    if (b2) b2.addEventListener("click", fjernResultat);
    const b3 = document.getElementById("btnTestKilder");
    if (b3) b3.addEventListener("click", testKilder);

    const valgt = document.getElementById("analyseOpplosning");
    if (valgt) valgt.addEventListener("change", oppdaterBadge);

    const map = vt().map && vt().map();
    if (map) {
      map.on("zoomend moveend resize", oppdaterBadge);
      oppdaterBadge();
    }
  }

  window.VTAnalyse = { init, analyser, fjernResultat, testKilder };
})();
