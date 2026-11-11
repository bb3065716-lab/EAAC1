/* EAAC — CROQUIS TACTIQUE sur vraie carte (Leaflet) : fond de carte positionné directement par les coordonnées,
   zoom tactile, symboles PT / PO / BUT / éclatements / alpha DP, pointage sur la carte, carte GeoTIFF personnelle. */
"use strict";
const MP = { map: null, lg: null, mode: "NAV", base: null, bases: {}, ov: null, ovOn: true, fitNext: true };

const mpCss = document.createElement("style");
mpCss.textContent = `
.mlab{position:absolute;transform:translate(-50%,-50%);white-space:nowrap;font:700 13px Consolas,monospace;color:#000;text-align:center;
 text-shadow:0 0 3px #fff,0 0 3px #fff,0 0 4px #fff,0 0 4px #fff;pointer-events:none;line-height:1.1}
.mlab.w{color:#fff;text-shadow:0 0 3px #000,0 0 3px #000,0 0 4px #000}
.mbar{display:flex;gap:4px;flex-wrap:wrap;padding:4px 6px;background:var(--GREEN_D);border-bottom:1px solid var(--AMBER_D)}
.mbar button{padding:7px 9px;font-size:12px}.mbar button.sel{background:var(--AMBER_D);border-color:var(--AMBER);color:var(--BRT)}
.leaflet-container{background:#1a221a;font-family:Consolas,monospace}
`;
document.head.appendChild(mpCss);

const dms2 = v => { const a = Math.abs(v), d = Math.floor(a), r = (a - d) * 60, m = Math.floor(r), s = (r - m) * 60; return (v < 0 ? "-" : "") + d + " " + String(m).padStart(2, "0") + " " + s.toFixed(2).padStart(5, "0"); };
const okc = c => c && isFinite(c[0]) && isFinite(c[1]);

/* ---------- lecture des données saisies (tolérant : aucune erreur si champ incomplet) ---------- */
function mpPeek() {
  if (!S.m) return null;
  const m = S.m, tr = f => { try { const v = f(); return okc(v) ? v : null; } catch (e) { return null; } };
  const adp = parseFloat(String(($("adp") || {}).value || "0").replace(",", ".")) || 0;
  let PO = null, PO2 = null, PT = null, TG = null;
  if (m == "DRONE") { PO = tr(() => gp("po")); PT = tr(() => gp("pt")); TG = tr(() => gp("tg")); }
  if (m == "TELEM") { PO = tr(() => gp2("po")); PT = tr(() => gp2("pt")); if (PO) TG = tr(() => polar(...PO, nm("but_dist"), nm("but_az"))); }
  if (m == "OC") { PO = tr(() => gp2("po1")); PO2 = tr(() => gp2("po2")); PT = tr(() => gp2("pt")); if (PO && PO2) TG = tr(() => inter(...PO, nm("az1"), ...PO2, nm("az2"))); }
  const ec = [];
  S.ex.forEach(i => {
    let c = null;
    if (m == "DRONE") c = tr(() => gp("e" + i));
    if (m == "TELEM" && PO) c = tr(() => polar(...PO, nm("e" + i + "_d"), nm("e" + i + "_a")));
    if (m == "OC" && PO && PO2) c = tr(() => inter(...PO, nm("e" + i + "_a1"), ...PO2, nm("e" + i + "_a2")));
    if (c) ec.push([i, c]);
  });
  return { PT, PO, PO2, TG, ec, adp, name: (($("tn") || {}).value || "BUT").toUpperCase() };
}

/* ---------- ouverture ---------- */
function openMap() {
  if (typeof L === "undefined") { alert("Bibliothèque de carte (Leaflet) absente."); return; }
  let o = document.getElementById("mp"); if (o) o.remove();
  o = document.createElement("div"); o.id = "mp"; o.className = "ov"; o.style.zIndex = 25;
  const modes = [["NAV", "NAVIGUER"], ["PT", "PT"], ["PO", "PO"], ...(S.m == "OC" ? [["PO2", "PO2"]] : []), ["BUT", "BUT"], ["EXP", "ÉCLAT"]];
  o.innerHTML = `<div class="top"><button onclick="mpClose()">◀ RETOUR</button><b>🗺 CROQUIS TACTIQUE</b><button onclick="mpFit()" style="padding:6px 8px;font-size:11px">AUTO-FIT</button></div>
  <div class="mbar" id="mpmodes">${modes.map(([k, l]) => `<button data-m="${k}" onclick="mpMode('${k}')">${l}</button>`).join("")}</div>
  <div class="mbar"><button data-b="SAT" onclick="mpBase('SAT')">SATELLITE</button><button data-b="PLAN" onclick="mpBase('PLAN')">PLAN</button><button data-b="TOPO" onclick="mpBase('TOPO')">RELIEF</button>
   <button onclick="document.getElementById('mapfile').click()" style="color:#88ccff;border-color:#336">CHARGER CARTE</button><button id="mpov" onclick="mpToggleOv()" style="display:none">CARTE: ON</button></div>
  <div class="stat" id="mpc">Touchez la carte pour lire les coordonnées. Mode de pointage : <b id="mpml">NAVIGUER</b></div>
  <div class="grow"><div id="mpm" style="position:absolute;inset:0"></div></div>`;
  document.body.appendChild(o);

  let view = { c: [28.0, 2.6], z: 5 };
  try { const v = JSON.parse(localStorage.eaac_mv || "null"); if (v && v.c) view = v; } catch (e) {}
  MP.map = L.map("mpm", { zoomControl: true, attributionControl: true, zoomSnap: 0.25, maxZoom: 19 }).setView(view.c, view.z);
  MP.bases = {
    SAT: L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 19, maxNativeZoom: 18, attribution: "Imagery © Esri" }),
    PLAN: L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }),
    TOPO: L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", { maxZoom: 19, maxNativeZoom: 17, subdomains: "abc", attribution: "© OpenTopoMap, OSM" })
  };
  let b = "SAT"; try { b = localStorage.eaac_mb || "SAT"; } catch (e) {}
  MP.base = null; mpBase(b in MP.bases ? b : "SAT");
  MP.lg = L.layerGroup().addTo(MP.map); MP.ov = null; MP.ovOn = true;
  MP.map.on("click", mpClick);
  MP.map.on("mousemove", e => mpCoord(e.latlng, false));
  MP.map.on("moveend", () => { try { const c = MP.map.getCenter(); localStorage.eaac_mv = JSON.stringify({ c: [c.lat, c.lng], z: MP.map.getZoom() }); } catch (e) {} });
  mpMode("NAV"); MP.fitNext = true; mpRefresh();
  setTimeout(() => { MP.map.invalidateSize(); mpRefresh(); }, 150);
}
function mpClose() { if (MP.map) { MP.map.remove(); MP.map = null; } closeOv("mp"); }

function mpMode(k) {
  MP.mode = k; document.querySelectorAll("#mpmodes button").forEach(b => b.classList.toggle("sel", b.dataset.m === k));
  const l = { NAV: "NAVIGUER", PT: "PLACER PT", PO: "PLACER PO", PO2: "PLACER PO2", BUT: "PLACER BUT", EXP: "PLACER ÉCLAT" }[k];
  const e = document.getElementById("mpml"); if (e) e.textContent = l;
  if (MP.map) MP.map.getContainer().style.cursor = k === "NAV" ? "" : "crosshair";
}
function mpBase(k) {
  if (MP.base) MP.map.removeLayer(MP.base);
  MP.base = MP.bases[k].addTo(MP.map); MP.base.bringToBack();
  document.querySelectorAll("[data-b]").forEach(b => b.classList.toggle("sel", b.dataset.b === k));
  try { localStorage.eaac_mb = k; } catch (e) {}
}
function mpCoord(ll, tap) {
  const [e, n, z] = l2u(ll.lat, ll.lng), el = document.getElementById("mpc"); if (!el) return;
  const h = demElev ? demElev(ll.lat, ll.lng) : null;
  el.innerHTML = `E ${e.toFixed(0)}  N ${n.toFixed(0)}  (${z})  ·  LAT ${dms2(ll.lat)}  LON ${dms2(ll.lng)}${h !== null ? "  ·  ALT " + h.toFixed(0) + " m" : ""}  · <b id="mpml">${{ NAV: "NAVIGUER", PT: "PLACER PT", PO: "PLACER PO", PO2: "PLACER PO2", BUT: "PLACER BUT", EXP: "PLACER ÉCLAT" }[MP.mode]}</b>`;
}

/* ---------- pointage sur la carte → remplit les champs du formulaire ---------- */
function mpClick(e) {
  mpCoord(e.latlng, true);
  if (MP.mode === "NAV") return;
  try { mpPlace(MP.mode, e.latlng.lat, e.latlng.lng); } catch (ex) { toast(String(ex.message || ex), 4000); }
  mpRefresh();
}
function mpSet(id, v) { const el = $(id); if (el) el.value = v; }
function mpPlace(mode, lat, lon) {
  const m = S.m, la = dms2(lat), lo = dms2(lon), [e, n, z] = l2u(lat, lon), sn = String(lat.toFixed(5)) + ", " + lon.toFixed(5);
  const fillGeo = id => { setMode(id, "geo"); mpSet(id + "_lat", la); mpSet(id + "_lon", lo); };
  const fillUtm = id => { mpSet(id + "_e", e.toFixed(1)); mpSet(id + "_n", n.toFixed(1)); mpSet(id + "_z", z); };
  const lbl = { PT: "PT", PO: "PO", PO2: "PO2", BUT: "BUT", EXP: "ÉCLAT" }[mode];
  if (m == "DRONE") {
    if (mode == "PT") fillGeo("pt"); else if (mode == "PO") fillGeo("po"); else if (mode == "BUT") fillGeo("tg");
    else if (mode == "EXP") { addEx(); fillGeo("e" + S.ex.length); }
  } else {
    const polarFrom = (po, dId, aId) => {
      if (!po) throw "Placez d'abord le PO.";
      const q = dap(...po, lat, lon); mpSet(dId, q.dist.toFixed(0)); mpSet(aId, q.mil.toFixed(0));
    };
    const poA = (m == "OC") ? mpPeek().PO : mpPeek().PO, pk = mpPeek();
    if (mode == "PT") fillUtm("pt");
    else if (mode == "PO") fillUtm(m == "OC" ? "po1" : "po");
    else if (mode == "PO2") fillUtm("po2");
    else if (mode == "BUT") {
      if (m == "TELEM") polarFrom(pk.PO, "but_dist", "but_az");
      else { if (!pk.PO || !pk.PO2) throw "Placez d'abord PO1 et PO2."; mpSet("az1", dap(...pk.PO, lat, lon).mil.toFixed(0)); mpSet("az2", dap(...pk.PO2, lat, lon).mil.toFixed(0)); }
    } else if (mode == "EXP") {
      if (m == "TELEM") { if (!pk.PO) throw "Placez d'abord le PO."; addEx(); const i = S.ex.length; polarFrom(pk.PO, "e" + i + "_d", "e" + i + "_a"); }
      else { if (!pk.PO || !pk.PO2) throw "Placez d'abord PO1 et PO2."; addEx(); const i = S.ex.length; mpSet("e" + i + "_a1", dap(...pk.PO, lat, lon).mil.toFixed(0)); mpSet("e" + i + "_a2", dap(...pk.PO2, lat, lon).mil.toFixed(0)); }
    }
  }
  toast(lbl + " placé : " + la + "  " + lo + "  — appuyez sur CALCULER pour les éléments de tir", 3800);
}

/* ---------- dessin ---------- */
function mpLab(ll, html, cls, dx = 0, dy = 0) {
  return L.marker(ll, { interactive: false, icon: L.divIcon({ className: "", iconSize: [0, 0], html: `<div class="mlab ${cls || ""}" style="margin:${dy}px 0 0 ${dx}px">${html}</div>` }) });
}
function mpSvg(ll, svg, size) {
  return L.marker(ll, { interactive: false, icon: L.divIcon({ className: "", iconSize: [size, size], iconAnchor: [size / 2, size / 2], html: svg }) });
}
function mpRefresh() {
  if (!MP.map) return;
  MP.lg.clearLayers();
  const k = mpPeek(); if (!k) return;
  const ref = k.PT || k.TG || k.PO; if (!ref) return;
  const z0 = l2u(...ref)[2], U = p => toUTM(p[0], p[1], z0), P = (p, dE, dN) => { const [e, n] = U(p); return u2l(e + dE, n + dN, z0); };
  const pts = [], add = l => l.addTo(MP.lg);
  const casedLine = (a, b, col, w) => { add(L.polyline([a, b], { color: "#fff", weight: w + 3, opacity: .85 })); add(L.polyline([a, b], { color: col, weight: w })); };
  const arrow = (a, b, col, w) => {   // flèche a→b
    const [e1, n1] = U(a), [e2, n2] = U(b), len = Math.hypot(e2 - e1, n2 - n1); if (len < 1) return;
    const ux = (e2 - e1) / len, uy = (n2 - n1) / len, hl = Math.max(15, Math.min(len * 0.07, 150));
    [2.6, -2.6].forEach(da => { const c = Math.cos(da), s = Math.sin(da), vx = ux * c - uy * s, vy = ux * s + uy * c; casedLine(b, P(b, -hl * vx, -hl * vy), col, w); });
  };
  const PT = k.PT, az = k.adp * 2 * Math.PI / MIL;

  if (PT) {
    pts.push(PT);
    // alpha DP
    let len = 1500; if (k.TG) len = dap(...PT, ...k.TG).dist + 1000;
    const end = P(PT, Math.sin(az) * len, Math.cos(az) * len);
    add(L.polyline([PT, end], { color: "#fff", weight: 8, opacity: .85 })); add(L.polyline([PT, end], { color: "#000", weight: 5 }));
    arrow(PT, end, "#000", 3);
    add(mpLab(P(PT, Math.sin(az) * len * 0.55, Math.cos(az) * len * 0.55), `α DP = ${k.adp.toFixed(0)} mil`, "", 14, -14));
    // symbole PT : cercle 150 m + canon orienté alpha DP
    const r = 150, d = [Math.sin(az), Math.cos(az)], q = [Math.cos(az), -Math.sin(az)], at = (a, b) => P(PT, a * d[0] + b * q[0], a * d[1] + b * q[1]);
    add(L.circle(PT, { radius: r, color: "#fff", weight: 5, fill: false, opacity: .85 })); add(L.circle(PT, { radius: r, color: "#000", weight: 2, fill: false }));
    const br = r * 0.22, bl = r * 0.72, bc = at(-br * 1.1, 0);
    add(L.circle(bc, { radius: br, color: "#000", weight: 1, fillColor: "#000", fillOpacity: 1 }));
    casedLine(at(-br * 1.1 + br, 0), at(bl, 0), "#000", 4);
    [0.15, 0.32].forEach(f => casedLine(at(bl * f, -r * .28), at(bl * f, r * .28), "#000", 3));
    casedLine(at(bl - r * .08, -r * .2), at(bl - r * .08, r * .2), "#000", 3);
    add(mpSvg(PT, `<svg width="18" height="18" viewBox="-9 -9 18 18"><circle r="7" fill="#c8a85a" stroke="#000" stroke-width="2"/><circle r="2" fill="#000"/></svg>`, 18));
    add(mpLab(PT, "PT", "", 0, 20));
  }
  [[k.PO, "PO"], [k.PO2, "PO2"]].forEach(([p, l]) => {
    if (!p) return; pts.push(p);
    add(mpSvg(p, `<svg width="26" height="26" viewBox="0 0 26 26"><polygon points="13,3 24,23 2,23" fill="#101010" stroke="#fff" stroke-width="2.5"/></svg>`, 26));
    add(mpLab(p, l, "", 0, -22));
    if (k.TG) add(L.polyline([p, k.TG], { color: "#4fc3f7", weight: 2, dashArray: "6 5" }));
  });
  if (k.TG) {
    pts.push(k.TG);
    if (PT) {
      casedLine(PT, k.TG, "#ff0000", 3); arrow(PT, k.TG, "#ff0000", 3);
      const a = dap(...PT, ...k.TG), ar = a.az * R, hl = 100, hs = 45, A = [Math.sin(ar), Math.cos(ar)], Q = [Math.cos(ar), -Math.sin(ar)];
      const cr = (sa, sq) => P(k.TG, sa * hs * A[0] + sq * hl * Q[0], sa * hs * A[1] + sq * hl * Q[1]);
      add(L.polygon([cr(1, 1), cr(1, -1), cr(-1, -1), cr(-1, 1)], { color: "#4488cc", weight: 3, fillColor: "#4488cc", fillOpacity: .35 }));
      add(mpLab(k.TG, `<b style="font-size:15px">${k.name}</b>`, "", 0, 0));
      add(mpLab(k.TG, `${a.dist.toFixed(0)}m`, "", 0, 26));
    } else {
      add(mpSvg(k.TG, `<svg width="22" height="22" viewBox="0 0 22 22"><rect x="3" y="3" width="16" height="16" fill="#4488cc" fill-opacity=".5" stroke="#4488cc" stroke-width="2.5"/></svg>`, 22));
      add(mpLab(k.TG, k.name, "", 0, 20));
    }
  }
  k.ec.forEach(([i, c]) => {
    pts.push(c);
    let s = ""; for (let j = 0; j < 12; j++) { const a = (j * 30 - 90) * R, ri = j % 2 ? 4.5 : 12; s += (12 + ri * Math.cos(a)).toFixed(1) + "," + (12 + ri * Math.sin(a)).toFixed(1) + " "; }
    add(mpSvg(c, `<svg width="24" height="24" viewBox="0 0 24 24"><polygon points="${s}" fill="#d4b040" stroke="#664400" stroke-width="1.5"/></svg>`, 24));
    add(mpLab(c, "E" + i, "", 0, -20));
    if (PT && k.TG) { /* correction : trait PT→éclat */ add(L.polyline([PT, c], { color: "#ff6b5e", weight: 1.5, dashArray: "3 4", opacity: .9 })); }
  });
  MP.pts = pts;
  if (MP.fitNext && pts.length) { MP.fitNext = false; mpFit(); }
}
function mpFit() {
  const pts = (MP.pts || []).filter(okc); if (!MP.map || !pts.length) return;
  if (pts.length === 1) MP.map.setView(pts[0], 16);
  else MP.map.fitBounds(L.latLngBounds(pts).pad(0.35), { maxZoom: 17 });
}

/* ---------- carte GeoTIFF personnelle (équivalent de « CHARGER CARTE » du programme Python) ---------- */
const mapInput = document.createElement("input");
mapInput.type = "file"; mapInput.id = "mapfile"; mapInput.style.display = "none"; document.body.appendChild(mapInput);
mapInput.addEventListener("change", async () => {
  const f = mapInput.files[0]; mapInput.value = ""; if (!f || !MP.map) return;
  try {
    toast("Lecture de la carte…", 60000);
    const tiff = await GeoTIFF.fromArrayBuffer(await f.arrayBuffer()), img = await tiff.getImage();
    const w = img.getWidth(), h = img.getHeight(), sc = Math.min(1, 3000 / Math.max(w, h)), rw = Math.max(1, Math.round(w * sc)), rh = Math.max(1, Math.round(h * sc));
    const rs = await img.readRasters({ width: rw, height: rh, resampleMethod: "bilinear" });
    const nb = rs.length, cv = document.createElement("canvas"); cv.width = rw; cv.height = rh;
    const cx = cv.getContext("2d"), id = cx.createImageData(rw, rh), o = id.data, N = rw * rh;
    const bandMax = b => { let m = 0; for (let i = 0; i < N; i += 7) if (rs[b][i] > m) m = rs[b][i]; return m || 1; };
    if (nb >= 3) {
      const mx = Math.max(bandMax(0), bandMax(1), bandMax(2)), k = mx <= 1 ? 255 : mx > 255 ? 255 / mx : 1;
      for (let i = 0; i < N; i++) { o[i * 4] = rs[0][i] * k; o[i * 4 + 1] = rs[1][i] * k; o[i * 4 + 2] = rs[2][i] * k; o[i * 4 + 3] = 255; }
    } else {
      let mn = Infinity, mx = -Infinity; for (let i = 0; i < N; i += 3) { const v = rs[0][i]; if (v < mn) mn = v; if (v > mx) mx = v; }
      for (let i = 0; i < N; i++) { const v = mx > mn ? (rs[0][i] - mn) / (mx - mn) * 255 : 0; o[i * 4] = o[i * 4 + 1] = o[i * 4 + 2] = v; o[i * 4 + 3] = 255; }
    }
    cx.putImageData(id, 0, 0);
    const [ox, oy] = img.getOrigin(), [rx, ry] = img.getResolution(), keys = img.getGeoKeys() || {};
    const geo = keys.GTModelTypeGeoKey === 2 || (keys.GTModelTypeGeoKey === undefined && Math.abs(rx) < 1);
    let x0 = ox, y0 = oy, x1 = ox + rx * w, y1 = oy + ry * h, b;
    if (geo) b = [[Math.min(y0, y1), Math.min(x0, x1)], [Math.max(y0, y1), Math.max(x0, x1)]];
    else {
      const pcs = keys.ProjectedCSTypeGeoKey, z = pcs >= 32601 && pcs <= 32660 ? pcs - 32600 : l2u(MP.map.getCenter().lat, MP.map.getCenter().lng)[2];
      const a = u2l(Math.min(x0, x1), Math.min(y0, y1), z), c = u2l(Math.max(x0, x1), Math.max(y0, y1), z); b = [a, c];
    }
    if (MP.ov) MP.map.removeLayer(MP.ov);
    MP.ov = L.imageOverlay(cv.toDataURL("image/jpeg", 0.9), b, { opacity: 1, zIndex: 5 }).addTo(MP.map); MP.ovOn = true;
    MP.map.fitBounds(b);
    const btn = document.getElementById("mpov"); btn.style.display = ""; btn.textContent = "CARTE: ON";
    toast("Carte chargée : " + f.name + "  " + w + "×" + h + " px", 3500);
  } catch (e) { alert("ERREUR CARTE\n" + (e.message || e)); }
});
function mpToggleOv() {
  if (!MP.ov) return; MP.ovOn = !MP.ovOn;
  if (MP.ovOn) MP.ov.addTo(MP.map); else MP.map.removeLayer(MP.ov);
  document.getElementById("mpov").textContent = "CARTE: " + (MP.ovOn ? "ON" : "OFF");
}
