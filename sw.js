// Viltterreng service worker
// Ansvar: 1) gjøre selve appen tilgjengelig offline (app-skallet)
//         2) mellomlagre karttiles slik at et nedlastet område kan brukes uten nett i felt

// Bump denne når app-filene endres. Med nettverk-først-strategien under er
// dette mest en opprydningsmekanisme — nye versjoner vises uansett straks.
const SHELL_CACHE = "viltterreng-shell-v14";
const TILE_CACHE = "viltterreng-tiles-v1"; // kartruter: skal IKKE tømmes ved appoppdatering

const SHELL_FILES = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./analyse.js",
  "./habitat-data.js",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./libs/leaflet/leaflet.js",
  "./libs/leaflet/leaflet.css",
  "./libs/leaflet/images/marker-icon.png",
  "./libs/leaflet/images/marker-icon-2x.png",
  "./libs/leaflet/images/marker-shadow.png",
  "./libs/leaflet/images/layers.png",
  "./libs/leaflet/images/layers-2x.png",
];

// Vertskap for karttiles vi vet om. Kartverkets cache-tjeneste er primær kilde
// (norsk topografisk kart, gratis/åpne data), OpenStreetMap er reserveløsning
// hvis Kartverket-tjenesten skulle være utilgjengelig.
const TILE_HOST_PATTERNS = [
  /cache\.kartverket\.no/,
  /opencache\.statkart\.no/,
  /tile\.openstreetmap\.org/,
  /[a-z]\.tile\.openstreetmap\.org/,
  /tile\.opentopomap\.org/,
  /[a-z]\.tile\.opentopomap\.org/,
  /server\.arcgisonline\.com\/ArcGIS\/rest\/services\/World_Imagery/,
];

function isTileRequest(url) {
  return TILE_HOST_PATTERNS.some((re) => re.test(url));
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_FILES)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== SHELL_CACHE && k !== TILE_CACHE)
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = req.url;

  if (isTileRequest(url)) {
    event.respondWith(
      caches.open(TILE_CACHE).then(async (cache) => {
        const cached = await cache.match(req);
        if (cached) return cached;
        try {
          const resp = await fetch(req);
          if (resp && resp.status === 200) {
            cache.put(req, resp.clone());
          }
          return resp;
        } catch (err) {
          // Ingen nett og ingen cache for denne ruta i kartet
          return new Response("", { status: 504, statusText: "Offline og ikke nedlastet" });
        }
      })
    );
    return;
  }

  // App-skall: NETTVERK FØRST, med cache som reserve.
  //
  // Hvorfor ikke cache-først: da ville en ny versjon av appen aldri vises før
  // etter flere besøk, og en gammel utgave kunne "sitte fast" i nettleseren i
  // det uendelige. Med nettverk-først får du alltid nyeste versjon når du har
  // dekning, samtidig som cachen brukes umiddelbart når nettet er borte eller
  // svært tregt (typisk i fjellet).
  if (url.startsWith(self.location.origin)) {
    event.respondWith(networkFirst(req, 2500));
  }
});

// Henter fra nettet, men faller tilbake til cache hvis nettet feiler ELLER
// bruker mer enn timeoutMs. Cachen oppdateres alltid når nettsvaret kommer,
// også hvis vi rakk å svare fra cache først.
function networkFirst(req, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (resp) => {
      if (!settled) { settled = true; resolve(resp); }
    };

    const timer = setTimeout(() => {
      caches.match(req).then((cached) => {
        if (cached) done(cached); // treg forbindelse: vis lagret versjon nå
      });
    }, timeoutMs);

    fetch(req)
      .then((resp) => {
        clearTimeout(timer);
        if (resp && resp.status === 200) {
          const copy = resp.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put(req, copy));
        }
        done(resp);
      })
      .catch(() => {
        clearTimeout(timer);
        caches.match(req).then((cached) => {
          done(cached || new Response("Offline og ikke lagret", { status: 503 }));
        });
      });
  });
}

// Meldinger fra siden: last ned et sett med tile-URLer for offline bruk,
// og rapporter fremdrift tilbake.
self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "DOWNLOAD_TILES") {
    const { urls, jobId } = data;
    event.waitUntil(downloadTiles(urls, jobId, event.source));
  } else if (data.type === "CLEAR_TILES") {
    event.waitUntil(caches.delete(TILE_CACHE).then(() => {
      if (event.source) event.source.postMessage({ type: "TILES_CLEARED" });
    }));
  } else if (data.type === "TILE_CACHE_SIZE") {
    event.waitUntil(
      caches.open(TILE_CACHE).then(async (cache) => {
        const keys = await cache.keys();
        if (event.source) event.source.postMessage({ type: "TILE_CACHE_SIZE_RESULT", count: keys.length });
      })
    );
  }
});

async function downloadTiles(urls, jobId, client) {
  const cache = await caches.open(TILE_CACHE);
  let done = 0;
  let failed = 0;
  const total = urls.length;
  const CONCURRENCY = 6;
  let idx = 0;

  async function worker() {
    while (idx < urls.length) {
      const myIdx = idx++;
      const u = urls[myIdx];
      try {
        const existing = await cache.match(u);
        if (!existing) {
          const resp = await fetch(u);
          if (resp && resp.status === 200) {
            await cache.put(u, resp.clone());
          } else {
            failed++;
          }
        }
      } catch (e) {
        failed++;
      }
      done++;
      if (client && (done % 5 === 0 || done === total)) {
        client.postMessage({ type: "DOWNLOAD_PROGRESS", jobId, done, total, failed });
      }
    }
  }

  const workers = [];
  for (let i = 0; i < CONCURRENCY; i++) workers.push(worker());
  await Promise.all(workers);

  if (client) {
    client.postMessage({ type: "DOWNLOAD_COMPLETE", jobId, done, total, failed });
  }
}
