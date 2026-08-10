// Viltterreng – hovedlogikk
(function () {
  "use strict";

  const LOG_KEY = "viltterreng_log_v1";

  // Vises under "Mer" i appen, slik at du raskt kan se hvilken versjon som
  // faktisk kjører på en gitt lenke/enhet (nyttig ved testing av ny deploy).
  const APP_VERSION = "2.2 – egen score for storfugl og orrfugl";

  // ---------- Service worker ----------
  // Hoppes over når appen åpnes som lokal fil (file://), der service workers
  // ikke er tillatt. Da fungerer alt unntatt offline-lagring av kart.
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    window.addEventListener("load", () => {
      // updateViaCache: "none" hindrer at nettleseren serverer en gammel
      // mellomlagret sw.js, som ellers kan forsinke oppdateringer i opptil ett døgn.
      // Fantes det allerede en aktiv service worker da siden lastet? Hvis ikke,
      // er dette første besøk, og den påfølgende "controllerchange" er bare
      // førstegangsinstallasjonen — da skal vi IKKE laste siden på nytt.
      const hadController = !!navigator.serviceWorker.controller;

      navigator.serviceWorker
        .register("./sw.js", { updateViaCache: "none" })
        .then((reg) => {
          reg.update().catch(() => {});
          // Når en NY versjon har tatt over på et besøk som allerede kjørte en
          // eldre versjon, last siden på nytt én gang så du ser nyeste kode med
          // en gang i stedet for ved neste oppstart.
          let refreshing = false;
          navigator.serviceWorker.addEventListener("controllerchange", () => {
            if (!hadController || refreshing) return;
            refreshing = true;
            window.location.reload();
          });
        })
        .catch((e) => {
          console.warn("Kunne ikke registrere service worker", e);
        });
    });
  }

  // ---------- Online/offline status ----------
  function updateStatus() {
    const dot = document.getElementById("statusDot");
    const text = document.getElementById("statusText");
    if (navigator.onLine) {
      dot.classList.remove("offline");
      text.textContent = "online";
    } else {
      dot.classList.add("offline");
      text.textContent = "offline (bruker lagrede kart)";
    }
  }
  window.addEventListener("online", updateStatus);
  window.addEventListener("offline", updateStatus);
  updateStatus();

  // ---------- Tab-navigasjon ----------
  const views = {
    kart: document.getElementById("view-kart"),
    guide: document.getElementById("view-guide"),
    sjekk: document.getElementById("view-sjekk"),
    logg: document.getElementById("view-logg"),
    innstillinger: document.getElementById("view-innstillinger"),
  };
  const tabButtons = document.querySelectorAll("nav.tabbar button");
  tabButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      tabButtons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      Object.values(views).forEach((v) => v.classList.remove("active"));
      views[btn.dataset.view].classList.add("active");
      if (btn.dataset.view === "kart" && map) {
        setTimeout(() => map.invalidateSize(), 50);
      }
      if (btn.dataset.view === "innstillinger") refreshTileCount();
      if (btn.dataset.view === "logg") renderLog();
    });
  });

  function toast(msg, ms) {
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), ms || 3000);
  }

  // ---------- Kart ----------
  let map, addPointMode = false, userMarker = null;
  const pointsLayer = L.layerGroup();

  // Flere kartkilder, i rekkefølge appen prøver dem. Om én kilde ikke gir
  // noen kartfliser innen kort tid (blokkert nettverk, tjeneste nede o.l.),
  // bytter appen automatisk til neste — du kan også bytte manuelt når som
  // helst via kartlagvelgeren øverst til høyre.
  const TILE_SOURCES = [
    {
      name: "OpenTopoMap (terreng)",
      template: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
      options: { maxZoom: 17, subdomains: "abc", attribution: "© OpenTopoMap, © OpenStreetMap-bidragsytere" },
    },
    {
      name: "OpenStreetMap",
      template: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
      options: { maxZoom: 19, subdomains: "abc", attribution: "© OpenStreetMap-bidragsytere" },
    },
    {
      name: "Topo (Kartverket)",
      template: "https://cache.kartverket.no/v1/wmts/1.0.0/topo/default/webmercator/{z}/{y}/{x}.png",
      options: { maxZoom: 18, attribution: "Kartverket" },
    },
    {
      // Flyfoto er den viktigste kontrollen mot skogdataene: her ser du om
      // en teig er flatehogd etter at satellittdataene ble laget.
      // Merk: Norge i bilder stengte sine åpne tjenester i mars 2026 og krever
      // nå token forbeholdt Norge digitalt-parter. Esri sitt verdensdekkende
      // flyfoto er derfor brukt i stedet – bildealderen varierer, men store
      // hogstflater er godt synlige.
      name: "Flyfoto (sjekk hogst)",
      template: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      options: { maxZoom: 18, attribution: "Flyfoto: Esri, Maxar, Earthstar Geographics" },
    },
  ];

  // URL-mal for gjeldende aktive kartlag, brukt av "last ned område"-funksjonen.
  let activeTileTemplate = TILE_SOURCES[0].template;

  // Analyse-kartlag fra offentlige kilder som viser hvor sannsynligheten er
  // størst for gammel/lite påvirket skog — svært relevant for storfugl og
  // orrfugl. Disse er WMS-lag (analysekart), ikke bakgrunnskart, og vises
  // oppå det valgte bakgrunnskartet. Krever internett (caches ikke offline).
  const OVERLAY_SOURCES = [
    {
      name: "Naturskog – sannsynlighet",
      wmsUrl: "https://image001.miljodirektoratet.no/arcgis/services/naturskog/naturskog_v1/MapServer/WMSServer",
      layerName: "naturskogssannsynlighet",
      attribution: "Miljødirektoratet/Landbruksdirektoratet – Kart over naturskog",
      forklaring: "Viser sannsynlighet for naturskog (gammel, lite menneskepåvirket skog). Sterkere farge = høyere sannsynlighet. Naturskog er svært viktig habitat for storfugl og orrfugl.",
      wmsOptions: {},
    },
    {
      name: "Skogalder (SAT-SKOG)",
      wmsUrl: "https://wms.nibio.no/cgi-bin/satskog",
      layerName: "Alder",
      attribution: "NIBIO – SAT-SKOG",
      forklaring: "Viser skogens aldersklasse. Se etter de eldste klassene (gammel skog, gjerne over 80 år) — spesielt viktig for storfugl vinterstid, og relevant for orrfugl i mosaikk med yngre skog.",
      wmsOptions: { crs: (typeof L !== "undefined" && L.CRS && L.CRS.EPSG4326) || undefined },
    },
  ];

  function initMap() {
    map = L.map("map", { zoomControl: false }).setView([60.5, 9.0], 6); // Sør-Norge default
    L.control.zoom({ position: "bottomright" }).addTo(map);

    const layers = TILE_SOURCES.map((src) => L.tileLayer(src.template, src.options));
    const layersControlConfig = {};
    TILE_SOURCES.forEach((src, i) => { layersControlConfig[src.name] = layers[i]; });

    const overlayLayers = OVERLAY_SOURCES.map((src) =>
      L.tileLayer.wms(src.wmsUrl, Object.assign({
        layers: src.layerName,
        format: "image/png",
        transparent: true,
        opacity: 0.65,
        attribution: src.attribution,
      }, src.wmsOptions))
    );
    const overlaysControlConfig = {};
    OVERLAY_SOURCES.forEach((src, i) => { overlaysControlConfig[src.name] = overlayLayers[i]; });

    L.control.layers(layersControlConfig, overlaysControlConfig, { position: "topright" }).addTo(map);

    map.on("overlayadd", (e) => {
      const src = OVERLAY_SOURCES.find((s) => s.name === e.name);
      if (src) toast(src.forklaring, 6000);
    });

    let currentIndex = 0;
    let switchedAutomatically = false;
    let loadedAnyTile = false;
    let fallbackTimer = null;

    function activateLayer(index) {
      layers.forEach((l) => { if (map.hasLayer(l)) map.removeLayer(l); });
      currentIndex = index;
      loadedAnyTile = false;
      activeTileTemplate = TILE_SOURCES[index].template;
      layers[index].addTo(map);
      clearTimeout(fallbackTimer);
      // Automatisk bytte gjelder bare de tre bakgrunnskartene. Flyfoto er et
      // bevisst valg for å sjekke hogst, ikke noe appen skal falle tilbake til.
      const AUTO_FALLBACK_MAKS = 2;
      if (index < AUTO_FALLBACK_MAKS) {
        fallbackTimer = setTimeout(() => {
          if (!loadedAnyTile && navigator.onLine) {
            switchedAutomatically = true;
            toast(`Fikk ikke kontakt med ${TILE_SOURCES[index].name}. Prøver ${TILE_SOURCES[index + 1].name} i stedet...`);
            activateLayer(index + 1);
          }
        }, 5000);
      }
    }

    layers.forEach((layer) => {
      layer.on("tileload", () => { loadedAnyTile = true; });
    });

    activateLayer(0);

    map.on("baselayerchange", (e) => {
      const idx = TILE_SOURCES.findIndex((src) => src.name === e.name);
      if (idx !== -1) {
        clearTimeout(fallbackTimer);
        currentIndex = idx;
        loadedAnyTile = false;
        activeTileTemplate = TILE_SOURCES[idx].template;
      }
    });

    pointsLayer.addTo(map);
    loadPointsOnMap();

    map.on("click", (e) => {
      if (addPointMode) {
        addPointMode = false;
        document.getElementById("btnAddPoint").classList.remove("primary");
        promptNewPoint(e.latlng.lat, e.latlng.lng);
      }
    });
  }

  document.getElementById("btnAddPoint").addEventListener("click", (e) => {
    addPointMode = !addPointMode;
    e.target.classList.toggle("primary", addPointMode);
    toast(addPointMode ? "Trykk på et sted i kartet for å markere punkt" : "Avbrutt");
  });

  function promptNewPoint(lat, lng) {
    const tag = window.prompt(
      "Merk punktet, f.eks: myrkant, sørhelling, spillplass, sett spor osv.\n(Trykk avbryt for å ikke lagre)"
    );
    if (tag === null) return;
    const entry = {
      id: Date.now() + "-" + Math.random().toString(36).slice(2, 7),
      type: "punkt",
      art: "",
      antall: "",
      dato: new Date().toISOString().slice(0, 10),
      notat: tag,
      lat, lng,
      createdAt: Date.now(),
    };
    saveLogEntry(entry);
    loadPointsOnMap();
    toast("Punkt lagret");
  }

  function loadPointsOnMap() {
    pointsLayer.clearLayers();
    getLog().forEach((entry) => {
      if (typeof entry.lat !== "number") return;
      const emoji = entry.type === "observasjon" ? artEmoji(entry.art) : "📍";
      const icon = L.divIcon({
        html: `<div class="marker-obs" style="font-size:22px;">${emoji}</div>`,
        className: "",
        iconSize: [24, 24],
        iconAnchor: [12, 12],
      });
      const m = L.marker([entry.lat, entry.lng], { icon }).addTo(pointsLayer);
      const label = entry.type === "observasjon"
        ? `${artNavn(entry.art)} (${entry.antall || "?"}) – ${entry.dato}`
        : `Punkt – ${entry.dato}`;
      m.bindPopup(`<strong>${label}</strong><br>${entry.notat || ""}`);
    });
  }

  function artEmoji(art) {
    return { lirype: "🐦", fjellrype: "🏔️", storfugl: "🦃", orrfugl: "🦢" }[art] || "❓";
  }
  function artNavn(art) {
    return { lirype: "Lirype", fjellrype: "Fjellrype", storfugl: "Storfugl", orrfugl: "Orrfugl", annet: "Ukjent art" }[art] || art;
  }

  // ---------- Min posisjon ----------
  let lastKnownAltitude = null;
  document.getElementById("btnLocate").addEventListener("click", () => {
    if (!navigator.geolocation) {
      toast("GPS er ikke tilgjengelig på denne enheten");
      return;
    }
    toast("Henter posisjon...");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude, altitude } = pos.coords;
        lastKnownAltitude = altitude;
        map.setView([latitude, longitude], Math.max(map.getZoom(), 13));
        if (userMarker) map.removeLayer(userMarker);
        userMarker = L.circleMarker([latitude, longitude], {
          radius: 8, color: "#e6be5a", fillColor: "#e6be5a", fillOpacity: 0.9,
        }).addTo(map).bindPopup("Din posisjon").openPopup();
      },
      (err) => {
        toast("Fant ikke posisjon: " + err.message);
      },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  });

  document.getElementById("btnBrukGpsHoyde").addEventListener("click", () => {
    if (!navigator.geolocation) { toast("GPS ikke tilgjengelig"); return; }
    toast("Henter GPS-høyde...");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (pos.coords.altitude != null) {
          document.getElementById("fHoyde").value = Math.round(pos.coords.altitude);
          toast("Høyde hentet fra GPS");
        } else {
          toast("Denne enheten oppgir ikke høyde over havet via GPS");
        }
      },
      (err) => toast("Feil: " + err.message),
      { enableHighAccuracy: true, timeout: 15000 }
    );
  });

  // ---------- Last ned kartområde for offline bruk ----------
  document.getElementById("btnDownloadArea").addEventListener("click", () => {
    if (!navigator.onLine) {
      toast("Du må ha nett for å laste ned kart for offline bruk.");
      return;
    }
    const bounds = map.getBounds();
    const centerZoom = map.getZoom();
    const minZoom = Math.max(centerZoom - 1, 8);
    const maxZoom = Math.min(centerZoom + 2, 15);

    const urls = tileUrlsForBounds(bounds, minZoom, maxZoom);
    if (urls.length > 1500) {
      toast(`Området er stort (${urls.length} kartruter). Zoom inn til et mindre område og prøv igjen.`);
      return;
    }
    const ok = window.confirm(
      `Laste ned ca. ${urls.length} kartruter for offline bruk (zoom ${minZoom}–${maxZoom}) for synlig kartutsnitt?`
    );
    if (!ok) return;

    startDownload(urls);
  });

  function tileUrlsForBounds(bounds, minZ, maxZ) {
    const template = activeTileTemplate;
    const urls = [];
    for (let z = minZ; z <= maxZ; z++) {
      const nw = latLngToTile(bounds.getNorth(), bounds.getWest(), z);
      const se = latLngToTile(bounds.getSouth(), bounds.getEast(), z);
      const minX = Math.min(nw.x, se.x), maxX = Math.max(nw.x, se.x);
      const minY = Math.min(nw.y, se.y), maxY = Math.max(nw.y, se.y);
      for (let x = minX; x <= maxX; x++) {
        for (let y = minY; y <= maxY; y++) {
          urls.push(template.replace("{z}", z).replace("{y}", y).replace("{x}", x));
        }
      }
    }
    return urls;
  }

  function latLngToTile(lat, lng, z) {
    const n = Math.pow(2, z);
    const x = Math.floor(((lng + 180) / 360) * n);
    const latRad = (lat * Math.PI) / 180;
    const y = Math.floor(
      ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
    );
    return { x, y };
  }

  let currentJobId = null;
  function startDownload(urls) {
    if (!navigator.serviceWorker.controller) {
      toast("Appen laster fortsatt inn service worker – prøv igjen om noen sekunder.");
      return;
    }
    currentJobId = "job-" + Date.now();
    const bar = document.createElement("div");
    bar.className = "toast";
    bar.style.bottom = "calc(76px + var(--safe-bottom))";
    bar.innerHTML = `<div>Laster ned kart... <span id="dlProgressText">0%</span></div><div class="progress-wrap"><div class="progress-bar" id="dlProgressBar"></div></div>`;
    document.body.appendChild(bar);

    navigator.serviceWorker.controller.postMessage({
      type: "DOWNLOAD_TILES",
      urls,
      jobId: currentJobId,
    });

    function onMsg(event) {
      const data = event.data || {};
      if (data.jobId !== currentJobId) return;
      if (data.type === "DOWNLOAD_PROGRESS") {
        const pct = Math.round((data.done / data.total) * 100);
        const pctEl = document.getElementById("dlProgressText");
        const barEl = document.getElementById("dlProgressBar");
        if (pctEl) pctEl.textContent = pct + "%";
        if (barEl) barEl.style.width = pct + "%";
      } else if (data.type === "DOWNLOAD_COMPLETE") {
        bar.remove();
        toast(`Ferdig! ${data.done - data.failed} av ${data.total} kartruter lagret offline.`);
        navigator.serviceWorker.removeEventListener("message", onMsg);
        refreshTileCount();
      }
    }
    navigator.serviceWorker.addEventListener("message", onMsg);
  }

  function refreshTileCount() {
    if (!navigator.serviceWorker.controller) return;
    function onMsg(event) {
      if (event.data && event.data.type === "TILE_CACHE_SIZE_RESULT") {
        document.getElementById("tileCount").textContent = event.data.count;
        navigator.serviceWorker.removeEventListener("message", onMsg);
      }
    }
    navigator.serviceWorker.addEventListener("message", onMsg);
    navigator.serviceWorker.controller.postMessage({ type: "TILE_CACHE_SIZE" });
  }

  document.getElementById("btnClearTiles").addEventListener("click", () => {
    if (!navigator.serviceWorker.controller) return;
    if (!confirm("Slette alle nedlastede kartruter?")) return;
    function onMsg(event) {
      if (event.data && event.data.type === "TILES_CLEARED") {
        toast("Nedlastede kart slettet");
        refreshTileCount();
        navigator.serviceWorker.removeEventListener("message", onMsg);
      }
    }
    navigator.serviceWorker.addEventListener("message", onMsg);
    navigator.serviceWorker.controller.postMessage({ type: "CLEAR_TILES" });
  });

  // ---------- Habitatguide ----------
  function renderGuide() {
    const speciesList = document.getElementById("speciesList");
    speciesList.innerHTML = HABITAT_DATA.arter.map((a) => `
      <div class="species-card">
        <div class="head"><span class="emoji">${a.ikon}</span><h4>${a.navn}</h4></div>
        <p>${a.beskrivelse}</p>
        <h3 style="margin-top:8px;">Habitat</h3>
        <ul>${a.habitat.map((h) => `<li>${h}</li>`).join("")}</ul>
        <h3>Terreng å se etter</h3>
        <ul>${a.terreng.map((t) => `<li>${t}</li>`).join("")}</ul>
      </div>
    `).join("");

    document.getElementById("seasonList").innerHTML = HABITAT_DATA.sesong.map((s) => `
      <h3>${s.periode}</h3><p>${s.tips}</p>
    `).join("");

    document.getElementById("dognList").innerHTML = HABITAT_DATA.dognrytme.map((d) => `<li>${d}</li>`).join("");
    document.getElementById("vaerList").innerHTML = HABITAT_DATA.vaer.map((v) => `<li>${v}</li>`).join("");

    document.getElementById("analysekartList").innerHTML = (HABITAT_DATA.analysekart || []).map((k) => `
      <div class="species-card">
        <div class="head"><h4>${k.navn}</h4></div>
        <p>${k.forklaring}</p>
        <p style="font-size:12px;">Kilde: ${k.kilde}${k.lansert ? " · " + k.lansert : ""} — <a href="${k.lenke}" target="_blank" rel="noopener" style="color:var(--accent-2);">mer info</a></p>
      </div>
    `).join("");
  }

  // ---------- Terrengsjekkliste / score ----------
  const RULES = {
    lirype: {
      elevIdeal: [400, 900], elevOk: [250, 1100],
      goodVeg: ["vierkratt", "myr"], okVeg: ["snaufjell", "lauvskog"],
      goodTerrain: ["kant", "sorhelling", "rygg"], okTerrain: ["dalbunn"],
      vannBonus: true,
    },
    fjellrype: {
      elevIdeal: [700, 1300], elevOk: [550, 1600],
      goodVeg: ["snaufjell"], okVeg: ["vierkratt"],
      goodTerrain: ["rygg"], okTerrain: ["sorhelling"],
      vannBonus: false,
    },
    storfugl: {
      elevIdeal: [200, 700], elevOk: [100, 900],
      goodVeg: ["barskog_gammel"], okVeg: ["myr", "lauvskog"],
      goodTerrain: ["kant", "sorhelling"], okTerrain: ["dalbunn"],
      vannBonus: true,
    },
    orrfugl: {
      elevIdeal: [150, 600], elevOk: [50, 800],
      goodVeg: ["barskog_ung", "myr", "lauvskog"], okVeg: ["barskog_gammel"],
      goodTerrain: ["kant", "dalbunn"], okTerrain: ["sorhelling"],
      vannBonus: true,
    },
  };

  function inRange(v, range) { return v >= range[0] && v <= range[1]; }

  function computeScore(art, hoyde, veg, terrengform, vann, le, tegn) {
    const rules = RULES[art];
    let points = 0;
    const reasons = [];

    if (hoyde !== null && !isNaN(hoyde)) {
      if (inRange(hoyde, rules.elevIdeal)) {
        points += 2; reasons.push(`Høyden (${hoyde} moh) er midt i typisk sone for ${artNavn(art).toLowerCase()}.`);
      } else if (inRange(hoyde, rules.elevOk)) {
        points += 1; reasons.push(`Høyden (${hoyde} moh) er innenfor akseptabel sone, men ikke midt i kjerneområdet.`);
      } else {
        reasons.push(`Høyden (${hoyde} moh) er utenfor typisk sone for ${artNavn(art).toLowerCase()} – vurder å lete høyere/lavere.`);
      }
    }

    if (rules.goodVeg.includes(veg)) {
      points += 2; reasons.push("Vegetasjonstypen er svært typisk habitat for denne arten.");
    } else if (rules.okVeg.includes(veg)) {
      points += 1; reasons.push("Vegetasjonstypen kan fungere, men er ikke det aller mest typiske.");
    } else {
      reasons.push("Vegetasjonstypen er lite typisk for denne arten.");
    }

    if (rules.goodTerrain.includes(terrengform)) {
      points += 2; reasons.push("Terrengformen matcher godt med artens preferanser.");
    } else if (rules.okTerrain.includes(terrengform)) {
      points += 1;
    }

    if (vann === "ja" && rules.vannBonus) {
      points += 1; reasons.push("Nærhet til vann/myr er positivt for denne arten.");
    }

    if (le === "ja") {
      points += 1; reasons.push("Le for vær kan konsentrere fugl her i dårlig vær.");
    }

    if (tegn === "ja") {
      points += 3; reasons.push("Direkte tegn til vilt observert – dette teller mye uansett andre faktorer.");
    }

    let level, label;
    if (points >= 7) { level = "high"; label = "Høy sannsynlighet"; }
    else if (points >= 4) { level = "mid"; label = "Middels sannsynlighet"; }
    else { level = "low"; label = "Lav sannsynlighet"; }

    return { points, level, label, reasons };
  }

  let lastScoreContext = null;

  document.getElementById("btnBeregnScore").addEventListener("click", () => {
    const art = document.getElementById("fArt").value;
    const hoydeRaw = document.getElementById("fHoyde").value;
    const hoyde = hoydeRaw === "" ? null : parseFloat(hoydeRaw);
    const veg = document.getElementById("fVeg").value;
    const terrengform = document.getElementById("fTerrengform").value;
    const vann = document.querySelector('input[name="fVann"]:checked').value;
    const le = document.querySelector('input[name="fLe"]:checked').value;
    const tegn = document.querySelector('input[name="fTegn"]:checked').value;

    const result = computeScore(art, hoyde, veg, terrengform, vann, le, tegn);
    lastScoreContext = { art, hoyde, veg, terrengform, vann, le, tegn, result };

    const el = document.getElementById("scoreResult");
    el.innerHTML = `
      <div class="score-result ${result.level}">
        <div class="label">${result.label}</div>
        <div class="reasons"><ul>${result.reasons.map((r) => `<li>${r}</li>`).join("")}</ul></div>
      </div>
    `;
    document.getElementById("btnLagrePunkt").style.display = "block";
  });

  document.getElementById("btnLagrePunkt").addEventListener("click", () => {
    if (!lastScoreContext) return;
    if (!navigator.geolocation) {
      saveScoredPoint(null, null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => saveScoredPoint(pos.coords.latitude, pos.coords.longitude),
      () => saveScoredPoint(null, null),
      { enableHighAccuracy: true, timeout: 15000 }
    );
  });

  function saveScoredPoint(lat, lng) {
    const c = lastScoreContext;
    const entry = {
      id: Date.now() + "-" + Math.random().toString(36).slice(2, 7),
      type: "punkt",
      art: c.art,
      antall: "",
      dato: new Date().toISOString().slice(0, 10),
      notat: `Sjekkliste: ${c.result.label} (${c.result.points}p). Vegetasjon: ${c.veg}, terreng: ${c.terrengform}.`,
      lat, lng,
      score: c.result.points,
      createdAt: Date.now(),
    };
    saveLogEntry(entry);
    loadPointsOnMap();
    toast("Punkt lagret i loggen");
  }

  // ---------- Loggbok ----------
  function getLog() {
    try { return JSON.parse(localStorage.getItem(LOG_KEY)) || []; }
    catch (e) { return []; }
  }
  function setLog(arr) { localStorage.setItem(LOG_KEY, JSON.stringify(arr)); }
  function saveLogEntry(entry) {
    const arr = getLog();
    arr.unshift(entry);
    setLog(arr);
  }
  function deleteLogEntry(id) {
    setLog(getLog().filter((e) => e.id !== id));
    renderLog();
    loadPointsOnMap();
  }
  window.deleteLogEntry = deleteLogEntry;

  function renderLog() {
    const list = document.getElementById("loggListe");
    const arr = getLog();
    if (arr.length === 0) {
      list.innerHTML = `<div class="empty-hint">Ingen oppføringer ennå. Legg til en observasjon, eller marker et punkt i kartet / sjekklisten.</div>`;
      return;
    }
    list.innerHTML = arr.map((e) => `
      <div class="log-item">
        <div class="row1">
          <span>${e.type === "observasjon" ? artEmoji(e.art) + " " + artNavn(e.art) : "📍 Punkt"}</span>
          <span>${e.dato || ""}</span>
        </div>
        <div class="meta">${e.type === "observasjon" ? "Antall: " + (e.antall || "?") : ""} ${typeof e.lat === "number" ? " · " + e.lat.toFixed(4) + ", " + e.lng.toFixed(4) : " · ingen posisjon"}</div>
        ${e.notat ? `<div class="note">${e.notat}</div>` : ""}
        <div class="actions">
          <button class="btn small danger" onclick="deleteLogEntry('${e.id}')">Slett</button>
        </div>
      </div>
    `).join("");
  }

  document.getElementById("btnNyObservasjon").addEventListener("click", () => {
    const p = document.getElementById("nyObsPanel");
    p.style.display = p.style.display === "none" ? "block" : "none";
    document.getElementById("oDato").value = new Date().toISOString().slice(0, 10);
  });

  document.getElementById("btnLagreObs").addEventListener("click", () => {
    const art = document.getElementById("oArt").value;
    const antall = document.getElementById("oAntall").value;
    const dato = document.getElementById("oDato").value || new Date().toISOString().slice(0, 10);
    const notat = document.getElementById("oNotat").value;

    function finish(lat, lng) {
      saveLogEntry({
        id: Date.now() + "-" + Math.random().toString(36).slice(2, 7),
        type: "observasjon", art, antall, dato, notat, lat, lng, createdAt: Date.now(),
      });
      document.getElementById("nyObsPanel").style.display = "none";
      document.getElementById("oNotat").value = "";
      renderLog();
      loadPointsOnMap();
      toast("Observasjon lagret");
    }

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => finish(pos.coords.latitude, pos.coords.longitude),
        () => finish(null, null),
        { enableHighAccuracy: true, timeout: 15000 }
      );
    } else {
      finish(null, null);
    }
  });

  document.getElementById("btnEksporter").addEventListener("click", () => {
    const arr = getLog();
    if (arr.length === 0) { toast("Ingen data å eksportere"); return; }
    const header = "type,art,antall,dato,notat,lat,lng\n";
    const rows = arr.map((e) => [
      e.type, e.art || "", e.antall || "", e.dato || "",
      `"${(e.notat || "").replace(/"/g, '""')}"`,
      typeof e.lat === "number" ? e.lat : "", typeof e.lng === "number" ? e.lng : "",
    ].join(",")).join("\n");
    const blob = new Blob([header + rows], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "viltterreng-logg.csv";
    a.click();
  });

  // ---------- Versjon / oppdatering ----------
  function initVersionPanel() {
    const el = document.getElementById("appVersion");
    if (el) el.textContent = APP_VERSION;

    const btn = document.getElementById("btnTvingOppdater");
    if (btn) {
      btn.addEventListener("click", async () => {
        if (!("serviceWorker" in navigator)) {
          window.location.reload();
          return;
        }
        toast("Ser etter ny versjon...");
        try {
          const regs = await navigator.serviceWorker.getRegistrations();
          await Promise.all(regs.map((r) => r.update()));
        } catch (e) { /* ignorer */ }
        // Tving en hard omlasting fra nett, forbi eventuelle mellomlagrede filer.
        setTimeout(() => {
          window.location.replace(
            window.location.pathname + "?v=" + Date.now()
          );
        }, 800);
      });
    }
  }

  // Bro til analysemodulen (analyse.js), som trenger tilgang til kartet.
  window.VT = {
    map: () => map,
    toast: toast,
  };

  // ---------- Init ----------
  document.addEventListener("DOMContentLoaded", () => {
    initMap();
    renderGuide();
    renderLog();
    initVersionPanel();
    if (window.VTAnalyse && window.VTAnalyse.init) window.VTAnalyse.init();
  });
})();
