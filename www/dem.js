/* EAAC — module DEM (port JS de eaac.py : dem_get_elevation, dem_extract_profile, calc_site)
   Formats : GeoTIFF (LZW/Deflate/non compressé, tuilé ou non) et SRTM .hgt (.hgt.gz accepté).
   Les fichiers chargés sont mémorisés dans IndexedDB : rechargés automatiquement au prochain lancement. */
"use strict";
const DEM = { tiles: [], ready: false };

/* ---------- stockage persistant (IndexedDB) ---------- */
const DemDB = {
  _open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open("eaac", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("dem");
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  },
  async put(k, v) {
    try {
      const d = await this._open();
      return await new Promise((res, rej) => {
        const t = d.transaction("dem", "readwrite");
        t.objectStore("dem").put(v, k);
        t.oncomplete = res; t.onerror = () => rej(t.error);
      });
    } catch (e) { console.warn("IDB put", e); }
  },
  async all() {
    try {
      const d = await this._open();
      return await new Promise((res, rej) => {
        const out = [], t = d.transaction("dem", "readonly"), c = t.objectStore("dem").openCursor();
        c.onsuccess = () => { const cur = c.result; if (cur) { out.push([cur.key, cur.value]); cur.continue(); } else res(out); };
        c.onerror = () => rej(c.error);
      });
    } catch (e) { return []; }
  },
  async clear() {
    try {
      const d = await this._open();
      return await new Promise((res, rej) => {
        const t = d.transaction("dem", "readwrite"); t.objectStore("dem").clear();
        t.oncomplete = res; t.onerror = () => rej(t.error);
      });
    } catch (e) {}
  }
};

/* ---------- décodage ---------- */
async function demGunzipIfNeeded(buf) {
  const u = new Uint8Array(buf);
  if (u.length > 2 && u[0] === 0x1f && u[1] === 0x8b) {
    if (typeof DecompressionStream === "undefined") throw new Error("Fichier .gz non supporté par ce navigateur : décompressez-le d'abord.");
    const ds = new DecompressionStream("gzip");
    const stream = new Blob([buf]).stream().pipeThrough(ds);
    return await new Response(stream).arrayBuffer();
  }
  return buf;
}

function demParseHGT(buf, name) {
  const n = Math.round(Math.sqrt(buf.byteLength / 2));
  if (n * n * 2 !== buf.byteLength || (n !== 1201 && n !== 3601 && n !== 601 && n !== 401 && n < 100))
    throw new Error("Fichier .hgt invalide (taille " + buf.byteLength + " octets).");
  const m = /([NS])(\d{1,2})([EW])(\d{1,3})/i.exec(name);
  if (!m) throw new Error("Nom .hgt inattendu (ex. N36E005.hgt) : impossible de localiser la dalle.");
  const lat0 = (m[1].toUpperCase() === "S" ? -1 : 1) * +m[2], lon0 = (m[3].toUpperCase() === "W" ? -1 : 1) * +m[4];
  const dv = new DataView(buf), data = new Int16Array(n * n);
  for (let i = 0; i < data.length; i++) data[i] = dv.getInt16(i * 2, false);
  return { name, w: n, h: n, data, geographic: true, point: true,
           x0: lon0, y0: lat0 + 1, px: 1 / (n - 1), py: -1 / (n - 1), nodata: -32768, zone: null,
           res_m: 111320 / (n - 1) };
}

async function demParseTiff(buf, name) {
  if (typeof GeoTIFF === "undefined") throw new Error("Bibliothèque GeoTIFF absente.");
  const tiff = await GeoTIFF.fromArrayBuffer(buf), img = await tiff.getImage();
  const w = img.getWidth(), h = img.getHeight();
  if (w * h > 1.0e8) throw new Error("DEM trop grand (" + w + "×" + h + " px). Découpez-le autour de la zone de tir.");
  const [ox, oy] = img.getOrigin(), [rx, ry] = img.getResolution();
  const keys = img.getGeoKeys() || {};
  let nodata = img.getGDALNoData();
  nodata = (nodata === null || nodata === undefined || isNaN(+nodata)) ? null : +nodata;
  let geographic;
  if (keys.GTModelTypeGeoKey === 2) geographic = true;
  else if (keys.GTModelTypeGeoKey === 1) geographic = false;
  else geographic = Math.abs(rx) < 1;
  let zone = null;
  const pcs = keys.ProjectedCSTypeGeoKey;
  if (pcs >= 32601 && pcs <= 32660) zone = pcs - 32600;
  const point = keys.GTRasterTypeGeoKey === 2;           // PixelIsPoint
  const rs = await img.readRasters({ samples: [0], interleave: false });
  const data = rs[0] || rs;
  return { name, w, h, data, geographic, point: false,
           x0: point ? ox - rx / 2 : ox, y0: point ? oy - ry / 2 : oy, px: rx, py: ry, nodata, zone,
           res_m: geographic ? Math.abs(rx) * 111320 : Math.abs(rx) };
}

async function demAddBuffer(buf, name, persist = true) {
  buf = await demGunzipIfNeeded(buf);
  const base = name.replace(/\.gz$/i, "");
  const isHgt = /\.hgt$/i.test(base);
  const tile = isHgt ? demParseHGT(buf, base) : await demParseTiff(buf, base);
  DEM.tiles = DEM.tiles.filter(t => t.name !== tile.name);
  DEM.tiles.push(tile);
  if (persist) await DemDB.put(tile.name, { name, buf });
  return tile;
}

async function demLoadFiles(fileList) {
  const ok = [], ko = [];
  for (const f of fileList) {
    try { ok.push(await demAddBuffer(await f.arrayBuffer(), f.name)); }
    catch (e) { ko.push(f.name + " : " + (e.message || e)); }
  }
  return { ok, ko };
}

async function demRestore() {
  try {
    for (const [, v] of await DemDB.all()) { try { await demAddBuffer(v.buf, v.name, false); } catch (e) { console.warn(e); } }
  } finally { DEM.ready = true; if (window.onDemChange) window.onDemChange(); }
}

/* ---------- accès altitude ---------- */
function demRC(t, lat, lon) {
  let x, y;
  if (t.geographic) { x = lon; y = lat; }
  else { const z = t.zone || (Math.floor((lon + 180) / 6) + 1); const [e, n] = toUTM(lat, lon, z); x = e; y = n; }
  if (t.point && t.geographic) return [Math.round((y - t.y0) / t.py), Math.round((x - t.x0) / t.px)];
  return [Math.floor((y - t.y0) / t.py), Math.floor((x - t.x0) / t.px)];
}
function demCovers(lat, lon) {
  return DEM.tiles.some(t => { const [r, c] = demRC(t, lat, lon); return r >= 0 && r < t.h && c >= 0 && c < t.w; });
}
function demElev(lat, lon) {
  for (const t of DEM.tiles) {
    const [r, c] = demRC(t, lat, lon);
    if (r < 0 || r >= t.h || c < 0 || c >= t.w) continue;
    const v = t.data[r * t.w + c];
    if (!isFinite(v) || (t.nodata !== null && Math.abs(v - t.nodata) < 1)) continue;
    return +v;
  }
  return null;
}
function demProfile(lat1, lon1, lat2, lon2, n = 200) {
  const alts = [];
  for (let i = 0; i < n; i++) {
    const f = i / (n - 1);
    alts.push(demElev(lat1 + (lat2 - lat1) * f, lon1 + (lon2 - lon1) * f));
  }
  const dlat = (lat2 - lat1) * 111320, dlon = (lon2 - lon1) * 111320 * Math.cos((lat1 + lat2) / 2 * Math.PI / 180);
  const total = Math.hypot(dlat, dlon);
  return { dists: alts.map((_, i) => total * i / (n - 1)), alts };
}
const calcSite = (dh, dist) => dist < 1 ? 3000 : dh / (0.001 * dist) + 3000;

/* ---------- téléchargement automatique SRTM (optionnel, nécessite internet) ---------- */
async function demAutoDownload(points, onProgress) {
  const cells = new Set();
  for (const [la, lo] of points) {
    for (const dla of [-0.03, 0, 0.03]) for (const dlo of [-0.03, 0, 0.03]) cells.add(Math.floor(la + dla) + "," + Math.floor(lo + dlo));
  }
  const got = [];
  for (const k of cells) {
    const [la, lo] = k.split(",").map(Number);
    const nm = (la < 0 ? "S" : "N") + String(Math.abs(la)).padStart(2, "0") + (lo < 0 ? "W" : "E") + String(Math.abs(lo)).padStart(3, "0");
    if (DEM.tiles.some(t => t.name.toUpperCase().startsWith(nm))) continue;
    if (onProgress) onProgress("Téléchargement " + nm + "…");
    const url = "https://s3.amazonaws.com/elevation-tiles-prod/skadi/" + nm.slice(0, 3) + "/" + nm + ".hgt.gz";
    const r = await fetch(url);
    if (!r.ok) throw new Error("Dalle " + nm + " indisponible (HTTP " + r.status + ")");
    got.push(await demAddBuffer(await r.arrayBuffer(), nm + ".hgt.gz"));
  }
  return got;
}
