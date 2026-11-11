/* EAAC — HAUTEURS & SITE, PROFIL, TRAJECTOIRE (port JS de HauteurWindow / ProfilSiteWindow / TrajectoireWindow) */
"use strict";
const MIL_BAL = Math.PI / 3200;   // identique à eaac.py (_ballistic_from_table)
const G = 9.81;

const hsCss = document.createElement("style");
hsCss.textContent = `
.ov{position:fixed;inset:0;z-index:20;background:var(--PANEL);overflow:auto;padding-top:env(safe-area-inset-top);display:flex;flex-direction:column}
.ov .body{padding:8px;max-width:900px;width:100%;margin:0 auto}
.ov .grow{flex:1;min-height:0;position:relative}
.ov canvas.pf{position:absolute;inset:0;width:100%;height:100%;border-radius:0;background:#060c06}
.arow{display:flex;align-items:center;gap:8px;margin:7px 0}.arow .l{width:84px;color:var(--DIM);font-weight:700}
.arow .v{width:84px;text-align:right;font-weight:700}.arow .bar{flex:1;height:14px;background:var(--DARK);border-radius:3px;overflow:hidden}
.arow .bar i{display:block;height:100%}.badge{display:inline-block;min-width:92px;text-align:center;border-radius:5px;padding:4px 6px;font-weight:700;color:#0a1008}
.stat{background:var(--BG);border-top:2px solid var(--AMBER_D);padding:6px 10px;font-weight:700;font-size:12px;line-height:1.5}
#toast{position:fixed;left:50%;bottom:calc(20px + env(safe-area-inset-bottom));transform:translateX(-50%);background:#000d;color:#fff;border:2px solid var(--AMBER);padding:9px 14px;border-radius:8px;z-index:60;font-weight:700;max-width:92vw;text-align:center}
`;
document.head.appendChild(hsCss);

function toast(msg, ms = 2600) {
  let t = document.getElementById("toast");
  if (!t) { t = document.createElement("div"); t.id = "toast"; document.body.appendChild(t); }
  t.textContent = msg; t.style.display = "block";
  clearTimeout(toast._t); toast._t = setTimeout(() => t.style.display = "none", ms);
}

/* ---------- sélecteur de fichier DEM ---------- */
const demInput = document.createElement("input");
demInput.type = "file"; demInput.multiple = true; demInput.style.display = "none";
document.body.appendChild(demInput);
demInput.addEventListener("change", async () => {
  const files = [...demInput.files]; demInput.value = "";
  if (!files.length) return;
  toast("Lecture du DEM…", 60000);
  const { ok, ko } = await demLoadFiles(files);
  if (ok.length) toast("DEM chargé : " + ok.map(t => t.name + " (" + t.res_m.toFixed(0) + " m/px)").join(", "), 4000);
  if (ko.length) alert("ERREUR DEM\n" + ko.join("\n"));
  if (window.onDemChange) window.onDemChange();
});
const pickDem = () => demInput.click();

window.onDemChange = () => { if (document.getElementById("hs")) hsRender(); };

/* ---------- fenêtre HAUTEURS & SITE ---------- */
function hsData() {
  const X = S.cur;
  return { pt: X.PT, po: X.PO || null, but: X.TG, ec: X.ec.map(([i, c]) => ({ i, c })), sys: S.sys, ch: X.f && X.f.c };
}
function openHS() {
  if (!S.cur) { alert("Calculer d'abord la cible (PT et BUT requis)."); return; }
  if (!S.cur.PT || !S.cur.TG) { alert("PT et BUT requis."); return; }
  let o = document.getElementById("hs");
  if (!o) { o = document.createElement("div"); o.id = "hs"; o.className = "ov"; document.body.appendChild(o); }
  hsRender();
}
function closeOv(id) { const o = document.getElementById(id); if (o) o.remove(); }

function hsRender() {
  const o = document.getElementById("hs"); if (!o || !S.cur) return;
  const d = hsData();
  let h = `<div class="top"><button onclick="closeOv('hs')">◀ RETOUR</button><b>⛰ HAUTEURS & SITE — DEM</b></div><div class="body">`;
  const nm = DEM.tiles.map(t => t.name).join(", ");
  h += `<div class="box"><h3>MODÈLE NUMÉRIQUE DE TERRAIN</h3>
    <div class="sub" style="color:var(--${DEM.tiles.length ? "CYAN" : "ORANGE"})">${DEM.tiles.length ? "✔ " + nm + " — " + DEM.tiles.map(t => t.res_m.toFixed(0) + " m/px").join(", ") : (DEM.ready ? "Aucun DEM chargé" : "Chargement…")}</div>
    <div class="row" style="margin-top:6px"><button class="a" onclick="pickDem()">📂 ${DEM.tiles.length ? "AJOUTER" : "CHARGER"} DEM (.tif / .hgt)</button>
    <button onclick="hsAuto()">🌐 AUTO (internet)</button>${DEM.tiles.length ? `<button onclick="hsForget()">✖ OUBLIER</button>` : ""}</div>
    <div class="sub" style="color:var(--DIM)">Choisissez le fichier dans la mémoire du téléphone. Il est mémorisé : pas besoin de le recharger au prochain lancement.</div></div>`;
  if (!DEM.tiles.length) { o.innerHTML = h + "</div>"; return; }

  const hz = c => c ? demElev(c[0], c[1]) : null;
  const hpt = hz(d.pt), hpo = hz(d.po), hbut = hz(d.but), hec = d.ec.map(e => hz(e.c));
  const covers = demCovers(d.pt[0], d.pt[1]);
  const dist = (a, b) => { const [e1, n1] = l2u(...a), [e2, n2] = l2u(...b); return Math.hypot(e2 - e1, n2 - n1); };
  const all = [hpt, hpo, hbut, ...hec].filter(v => v !== null), hmin = all.length ? Math.min(...all) : 0, hr = Math.max((all.length ? Math.max(...all) : 1) - hmin, 1);
  const row = (l, v, col, bc) => `<div class="arow"><span class="l">${l}</span><span class="v" style="color:${col}">${v !== null ? (v >= 0 ? "+" : "") + v.toFixed(1) + " m" : "N/A"}</span><span class="bar">${v !== null ? `<i style="width:${Math.max(2, Math.min(100, (v - hmin) / hr * 100))}%;background:${bc}"></i>` : ""}</span></div>`;
  h += (covers ? "" : `<div class="warn">⚠ PT hors zone du DEM chargé — ajoutez la dalle correspondante.</div>`);
  h += `<div class="box"><h3>ALTITUDES (m/mer)</h3>${row("▶ PT", hpt, "var(--AMBER)", "#c87820")}${d.po ? row("▶ PO", hpo, "#ccc", "#666") : ""}${row("▶ BUT", hbut, "var(--BLUE)", "#2a5aa0")}${d.ec.map((e, k) => row("▶ ECLT " + e.i, hec[k], "var(--ORANGE)", "#a05a20")).join("")}</div>`;
  const site = (lbl, dh, ds, col) => {
    const s = dh !== null ? calcSite(dh, ds) : null;
    return `<div class="arow"><span class="l" style="width:110px">${lbl}</span><span style="flex:1">dH=${dh !== null ? (dh >= 0 ? "+" : "") + dh.toFixed(1) + " m" : "N/A"}</span><span class="badge" style="background:${s !== null ? col : "#555"}">${s !== null ? s.toFixed(2) + " mil" : "N/A"}</span></div>`;
  };
  h += `<div class="box"><h3>SITE (mil)</h3>${site("PT → BUT", hbut !== null && hpt !== null ? hbut - hpt : null, dist(d.pt, d.but), "var(--CYAN)")}` +
    d.ec.map((e, k) => site("PT → ECLT " + e.i, hec[k] !== null && hpt !== null ? hec[k] - hpt : null, dist(d.pt, e.c), "var(--ORANGE)")).join("") + `</div>`;
  h += `<div class="row"><button class="a" style="flex:1;padding:14px" onclick="openProfile('site')">📈 PROFIL & SITE →</button><button style="flex:1;padding:14px;color:#ff8888;border-color:#882222;background:#2a0808" onclick="openProfile('traj')">🚀 TRAJECTOIRE →</button></div></div>`;
  o.innerHTML = h;
}
async function hsAuto() {
  try {
    const d = hsData(), pts = [d.pt, d.but, ...d.ec.map(e => e.c)];
    if (d.po) pts.push(d.po);
    toast("Téléchargement des dalles SRTM…", 120000);
    const g = await demAutoDownload(pts, m => toast(m, 120000));
    toast(g.length ? "DEM téléchargé : " + g.map(t => t.name).join(", ") : "Dalles déjà présentes", 3500);
    if (window.onDemChange) window.onDemChange();
  } catch (e) {
    toast("Échec : " + (e.message || e) + " — chargez le fichier manuellement", 6000);
  }
}
async function hsForget() {
  if (!confirm("Oublier le DEM mémorisé ?")) return;
  DEM.tiles = []; await DemDB.clear(); if (window.onDemChange) window.onDemChange();
}

/* ---------- calculs profil ---------- */
const pfInterp = (de, vd, va) => {
  if (!vd.length) return null;
  if (de <= vd[0]) return va[0];
  if (de >= vd[vd.length - 1] - 1e-6) return va[va.length - 1];
  for (let k = 0; k < vd.length - 1; k++) if (vd[k] <= de && de <= vd[k + 1]) {
    const t = vd[k + 1] > vd[k] ? (de - vd[k]) / (vd[k + 1] - vd[k]) : 0; return va[k] + t * (va[k + 1] - va[k]);
  }
  let b = 0; vd.forEach((v, i) => { if (Math.abs(v - de) < Math.abs(vd[b] - de)) b = i; }); return va[b];
};

function pfCompute(d, hpt0, hbut0) {
  const [e1, n1] = l2u(...d.pt), [e2, n2] = l2u(...d.but), dTot = Math.hypot(e2 - e1, n2 - n1);
  let lat2, lon2;
  if (dTot > 0) {                       // prolongement de 2 km dans l'axe PT→BUT (colinéaire)
    const k = 2000 / dTot; lat2 = d.but[0] + (d.but[0] - d.pt[0]) * k; lon2 = d.but[1] + (d.but[1] - d.pt[1]) * k;
  } else { lat2 = d.but[0]; lon2 = d.but[1]; }
  const { dists, alts } = demProfile(d.pt[0], d.pt[1], lat2, lon2, 300);
  const vd = [], va = [];
  dists.forEach((x, i) => { if (alts[i] !== null) { vd.push(x); va.push(alts[i]); } });
  if (vd.length < 2) return null;
  const hpt = hpt0 !== null ? hpt0 : va[0];
  let hbut = hbut0;
  if (hbut === null) hbut = pfInterp(dTot, vd, va);
  return { vd, va, total: vd[vd.length - 1], dTot, hpt, hbut, e1, n1 };
}

function pfBallistic(d, dist, hpt, hbut) {
  if (!d.sys || !d.ch || dist < 1) return null;
  const r = ik(d.sys, d.ch, dist); if (!r || r[1] == null) return null;
  const theta = r[1] * MIL_BAL, dh = (hbut != null && hpt != null) ? hbut - hpt : 0;
  const te = theta - Math.atan2(dh, dist), s2 = Math.sin(2 * te);
  const V0 = Math.abs(s2) < 1e-6 ? Math.sqrt(G * dist / Math.max(0.01, Math.abs(s2) + 0.01)) : Math.sqrt(G * dist / Math.abs(s2));
  const Vz = V0 * Math.sin(te);
  return { theta: te, V0, apex: Math.max(Vz * Vz / (2 * G), dist * 0.05), hausse: r[1] };
}

function pfMasque(vd, va, dTot, hpt, hbut) {
  let md = null, mh = null, ms = -Infinity;
  if (dTot <= 0) return { md, mh, ms, smin: null };
  const tol = dTot * 0.02;
  vd.forEach((d, i) => {
    if (d < tol || d > dTot - tol) return;
    const sp = va[i] - (hpt + (hbut - hpt) * (d / dTot));
    if (sp > ms) { ms = sp; md = d; mh = va[i]; }
  });
  if (md === null && vd.length > 2) for (let i = 1; i < vd.length - 1; i++) {
    const d = vd[i]; if (d <= 0 || d >= dTot) continue;
    const sp = va[i] - (hpt + (hbut - hpt) * (d / dTot));
    if (sp > ms) { ms = sp; md = d; mh = va[i]; }
  }
  return { md, mh, ms, smin: md !== null ? calcSite(mh - hpt, md) : null };
}

/* ---------- fenêtre profil / trajectoire ---------- */
let PF = { kind: "site" };
function openProfile(kind) {
  PF.kind = kind;
  let o = document.getElementById("pf");
  if (o) o.remove();
  o = document.createElement("div"); o.id = "pf"; o.className = "ov"; o.style.zIndex = 30;
  o.innerHTML = `<div class="top"><button onclick="closeOv('pf')">◀ RETOUR</button><b>${kind === "site" ? "📈 PROFIL PT → BUT | SITE" : "🚀 TRAJECTOIRE BALISTIQUE"}</b>
    <button onclick="openProfile('${kind === "site" ? "traj" : "site"}')" style="padding:6px 8px;font-size:11px">${kind === "site" ? "🚀 TRAJ." : "📈 PROFIL"}</button></div>
    <div class="grow"><canvas class="pf" id="pfc"></canvas></div><div class="stat" id="pfs1"></div><div class="stat" id="pfs2" style="border-top:0"></div>`;
  document.body.appendChild(o);
  pfDraw();
}
addEventListener("resize", () => { if (document.getElementById("pf")) pfDraw(); });

function pfDraw() {
  const cv = document.getElementById("pfc"); if (!cv) return;
  const dpr = window.devicePixelRatio || 1, W = cv.clientWidth || 360, H = cv.clientHeight || 400;
  cv.width = W * dpr; cv.height = H * dpr;
  const g = cv.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const s1 = document.getElementById("pfs1"), s2 = document.getElementById("pfs2");
  const fs = Math.max(10, Math.min(13, W / 60)), F = (px, b = true) => (b ? "bold " : "") + px + "px Consolas,'Courier New',monospace";
  const mg = W < 520 ? 52 : 70, mgr = 16, mgt = 34, mgb = 40;
  g.fillStyle = "#060c06"; g.fillRect(0, 0, W, H);
  g.strokeStyle = "#0e180e"; g.lineWidth = 1;
  for (let x = 0; x < W; x += 80) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
  for (let y = 0; y < H; y += 50) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
  const msg = t => { g.fillStyle = "#99aa77"; g.font = F(14); g.textAlign = "center"; g.fillText(t, W / 2, H / 2); };
  if (!DEM.tiles.length || !S.cur) { msg("DEM ou coordonnées manquants"); return; }

  const d = hsData(), hz = c => c ? demElev(c[0], c[1]) : null;
  const p = pfCompute(d, hz(d.pt), hz(d.but));
  if (!p) { msg("Profil hors zone DEM"); s1.textContent = "Le profil PT → BUT sort de la zone couverte par le DEM chargé."; s2.textContent = ""; return; }
  const { vd, va, total, dTot, hpt, hbut, e1, n1 } = p;

  let apexAbove = 0, bal = null;
  if (PF.kind === "traj" && dTot >= 1) {
    bal = pfBallistic(d, dTot, hpt, hbut);
    apexAbove = bal ? bal.apex : Math.max(dTot * 0.18, Math.abs(hbut - hpt) * 0.6 + 60);
  }
  const minA = Math.min(Math.min(...va), hpt, hbut) - 20;
  const dispMax = Math.max(Math.max(...va), hpt + apexAbove) + 40, rng = Math.max(dispMax - minA, 50);
  const dw = W - mg - mgr, dh = H - mgt - mgb;
  const X = dd => total > 0 ? mg + dd / total * dw : mg, Y = a => (H - mgb) - (a - minA) / rng * dh;

  // terrain
  [["#2a1c08", 0], ["#3a2810", .08], ["#4a3818", .2], ["#5a4828", .4], ["#6a5835", .65]].reverse().forEach(([col, off]) => {
    g.fillStyle = col; g.beginPath();
    vd.forEach((dd, i) => { const x = X(dd), y = Y(va[i]) + off * dh; i ? g.lineTo(x, y) : g.moveTo(x, y); });
    g.lineTo(X(vd[vd.length - 1]), H - mgb); g.lineTo(X(vd[0]), H - mgb); g.closePath(); g.fill();
  });
  g.strokeStyle = "#c8a050"; g.lineWidth = 2; g.beginPath();
  vd.forEach((dd, i) => i ? g.lineTo(X(dd), Y(va[i])) : g.moveTo(X(dd), Y(va[i]))); g.stroke();
  // axes
  g.strokeStyle = "#445533"; g.lineWidth = 1; g.fillStyle = "#778855"; g.font = F(fs);
  g.beginPath(); g.moveTo(mg, H - mgb); g.lineTo(W - mgr, H - mgb); g.moveTo(mg, mgt); g.lineTo(mg, H - mgb); g.stroke();
  g.textBaseline = "top";
  for (let i = 0; i <= 8; i++) { g.textAlign = i === 8 ? "right" : "center"; const dd = total * i / 8, x = X(dd); g.beginPath(); g.moveTo(x, H - mgb); g.lineTo(x, H - mgb + 5); g.stroke(); if (i % (W < 520 ? 2 : 1) === 0) g.fillText(Math.round(dd) + "m", x, H - mgb + 8); }
  g.textAlign = "right"; g.textBaseline = "middle";
  for (let i = 0; i <= 6; i++) { const a = minA + rng * i / 6, y = Y(a); if (y < mgt || y > H - mgb) continue; g.beginPath(); g.moveTo(mg - 5, y); g.lineTo(mg, y); g.stroke(); g.fillText(Math.round(a) + "m", mg - 8, y); }
  g.textBaseline = "alphabetic";
  if (dTot < total) { g.fillStyle = "#445533"; g.textAlign = "center"; g.textBaseline = "top"; g.fillText("+2 km", (X(dTot) + X(total)) / 2, mgt + 26); g.textBaseline = "alphabetic"; }
  // ligne de visée
  if (dTot >= 1) {
    g.strokeStyle = PF.kind === "site" ? "#4488cc" : "#224466"; g.lineWidth = PF.kind === "site" ? 2 : 1; g.setLineDash([10, 5]);
    g.beginPath(); g.moveTo(X(0), Y(hpt)); g.lineTo(Math.min(X(dTot), mg + dw), Y(hbut)); g.stroke(); g.setLineDash([]);
  }
  // trajectoire
  if (PF.kind === "traj" && dTot >= 1) {
    let pts, Htop;
    if (bal) {
      const Vx = bal.V0 * Math.cos(bal.theta), Vz = bal.V0 * Math.sin(bal.theta), tf = dTot / Vx; pts = [];
      for (let k = 0; k <= 400; k++) { const t = tf * k / 400; pts.push([Vx * t, hpt + Vz * t - .5 * G * t * t]); }
      Htop = hpt + bal.apex;
    } else {
      Htop = hpt + apexAbove; const c = hpt, D = dTot, b = -((hbut - c) - 4 * (Htop - c)) / D, a = ((hbut - c) - b * D) / (D * D); pts = [];
      for (let k = 0; k <= 400; k++) { const x = D * k / 400; pts.push([x, a * x * x + b * x + c]); }
    }
    const path = () => { g.beginPath(); pts.forEach(([dd, a], i) => i ? g.lineTo(X(dd), Y(a)) : g.moveTo(X(dd), Y(a))); };
    g.lineJoin = g.lineCap = "round";
    g.strokeStyle = "#3a0000"; g.lineWidth = 9; path(); g.stroke();
    g.strokeStyle = "#ff2222"; g.lineWidth = 3; path(); g.stroke();
    g.strokeStyle = "#ff9999"; g.lineWidth = 1; path(); g.stroke();
    const xa = X(dTot / 2), ya = Y(Htop), r = 8;
    g.fillStyle = "#ff2222"; g.strokeStyle = "#ffaaaa"; g.lineWidth = 2; g.beginPath(); g.moveTo(xa, ya - r); g.lineTo(xa + r, ya); g.lineTo(xa, ya + r); g.lineTo(xa - r, ya); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = "#ff9999"; g.font = F(fs); g.textAlign = "center";
    g.fillText(bal ? `▲ APEX ${Htop.toFixed(0)}m (θ=${(bal.theta * 180 / Math.PI).toFixed(1)}° V₀≈${bal.V0.toFixed(0)}m/s)` : `▲ APEX ${Htop.toFixed(0)}m (approx.)`, Math.max(100, Math.min(xa, W - 100)), ya - r - 6);
    const xi = Math.min(X(dTot), W - mgr - 5), yi = Y(hbut);
    g.strokeStyle = "#ff2222"; g.lineWidth = 3; g.beginPath(); g.moveTo(xi, yi - 22); g.lineTo(xi, yi - 4); g.stroke();
    g.fillStyle = "#ff2222"; g.beginPath(); g.moveTo(xi, yi - 2); g.lineTo(xi - 5, yi - 11); g.lineTo(xi + 5, yi - 11); g.closePath(); g.fill();
  }
  // masque
  const m = pfMasque(vd, va, dTot, hpt, hbut);
  if (PF.kind === "traj" && m.md !== null) {
    const xm = X(m.md), ym = Y(m.mh), vis = hpt + (hbut - hpt) * (m.md / dTot), yv = Y(vis);
    if (m.ms > 0) {
      g.strokeStyle = "#ff8800"; g.lineWidth = 3; g.setLineDash([6, 3]); g.beginPath(); g.moveTo(xm, ym); g.lineTo(xm, H - mgb); g.stroke(); g.setLineDash([]);
      g.fillStyle = "rgba(255,136,0,.25)"; g.beginPath(); g.moveTo(X(0), Y(hpt)); g.lineTo(xm, ym); g.lineTo(xm, yv); g.closePath(); g.fill();
      g.strokeStyle = "#ff8800"; g.lineWidth = 2; g.beginPath(); g.moveTo(xm + 12, yv); g.lineTo(xm + 12, ym); g.stroke();
      g.fillStyle = "#ff8800"; g.font = F(fs); g.textAlign = "left"; g.fillText("+" + m.ms.toFixed(0) + "m", xm + 18, (yv + ym) / 2);
      g.beginPath(); g.moveTo(xm, ym - 9); g.lineTo(xm + 9, ym); g.lineTo(xm, ym + 9); g.lineTo(xm - 9, ym); g.closePath(); g.fill(); g.strokeStyle = "#fff"; g.lineWidth = 1; g.stroke();
      g.fillStyle = "#ffcc44"; g.textAlign = "center"; g.fillText(`MASQUE ${m.mh.toFixed(0)}m @ ${m.md.toFixed(0)}m`, Math.max(90, Math.min(xm, W - 90)), ym - 16);
      const sl = (m.mh - hpt) / m.md; g.strokeStyle = "#ff8800"; g.lineWidth = 1; g.setLineDash([4, 6]);
      g.beginPath(); g.moveTo(X(0), Y(hpt)); g.lineTo(X(total), Y(hpt + sl * total)); g.stroke(); g.setLineDash([]);
    } else {
      g.fillStyle = "#226622"; g.strokeStyle = "#44ff44"; g.lineWidth = 1; g.beginPath(); g.arc(xm, ym, 6, 0, 7); g.fill(); g.stroke();
      g.fillStyle = "#44ff44"; g.font = F(fs - 2); g.textAlign = "center"; g.fillText(m.mh.toFixed(0) + "m", xm, ym - 11);
    }
  }
  // PT
  { const x = X(0), y = Y(hpt); g.fillStyle = "#402010"; g.strokeStyle = "#c8a84b"; g.lineWidth = 2; g.beginPath(); g.arc(x, y, 10, 0, 7); g.fill(); g.stroke();
    g.beginPath(); g.moveTo(x - 6, y); g.lineTo(x + 6, y); g.moveTo(x, y - 6); g.lineTo(x, y + 6); g.stroke();
    g.fillStyle = "#c8a84b"; g.font = F(fs + 1); g.textAlign = "left"; g.textBaseline = "middle"; g.fillText("PT " + hpt.toFixed(0) + "m", x + 14, y); g.textBaseline = "alphabetic"; }
  // BUT
  if (dTot > 0) {
    const db = Math.min(dTot, total); let xb = Math.max(mg + 30, Math.min(X(db), mg + dw - 4));
    let hb = pfInterp(db, vd, va); if (hb === null) hb = hbut;
    const yb = Math.max(mgt + 30, Math.min(Y(hb), H - mgb - 30));
    g.strokeStyle = "#88ccff"; g.lineWidth = 2; g.setLineDash([6, 3]); g.beginPath(); g.moveTo(xb, mgt); g.lineTo(xb, H - mgb); g.stroke(); g.setLineDash([]);
    g.fillStyle = "#88ccff"; g.font = F(fs + 1); g.textAlign = "center"; g.fillText(hb.toFixed(0) + "m", xb, yb - 24);
    g.fillStyle = "#001840"; g.fillRect(xb - 28, yb - 15, 56, 30); g.strokeRect(xb - 28, yb - 15, 56, 30);
    g.fillStyle = "#88ccff"; g.font = F(fs + 2); g.textBaseline = "middle"; g.fillText("BUT", xb, yb); g.textBaseline = "alphabetic";
    g.font = F(fs); g.textBaseline = "top"; g.fillText("▼ BUT", xb, mgt + 4); g.textBaseline = "alphabetic";
  }
  // éclatements
  d.ec.forEach((e, k) => {
    const [ee, ne] = l2u(...e.c), de = Math.hypot(ee - e1, ne - n1);
    if (total === 0 || de > total + 500) return;
    const dd = Math.min(de, total); let he = hz(e.c); if (he === null) he = pfInterp(dd, vd, va); if (he === null) he = minA;
    const x = X(dd), y = Y(he);
    g.strokeStyle = "#ffcc00"; g.lineWidth = 1; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(x, H - mgb); g.lineTo(x, y); g.stroke(); g.setLineDash([]);
    g.beginPath(); for (let j = 0; j < 12; j++) { const a = (j * 30 - 90) * R, ri = j % 2 ? 7 : 16; g[j ? "lineTo" : "moveTo"](x + ri * Math.cos(a), y + ri * Math.sin(a)); } g.closePath();
    g.fillStyle = "#ffcc00"; g.strokeStyle = "#ff8800"; g.lineWidth = 2; g.fill(); g.stroke();
    g.fillStyle = "#ff6600"; g.beginPath(); g.arc(x, y, 5, 0, 7); g.fill();
    g.fillStyle = "#ffcc00"; g.font = F(fs); g.textAlign = "center"; g.fillText("E" + e.i + " " + he.toFixed(0) + "m", x, y - 22);
  });

  // barres d'état
  if (PF.kind === "site") {
    s1.innerHTML = `📈 Profil DEM PT → BUT (+2 km) — PT ${hpt.toFixed(0)} m · BUT ${hbut.toFixed(0)} m · Δh ${(hbut - hpt >= 0 ? "+" : "") + (hbut - hpt).toFixed(0)} m · dist ${dTot.toFixed(0)} m`;
    s1.style.color = "var(--CYAN)";
    s2.innerHTML = `Site PT→BUT : <span style="color:var(--AMBER)">${calcSite(hbut - hpt, dTot).toFixed(2)} mil</span>` +
      (m.md !== null ? ` · ${m.ms > 0 ? `<span style="color:#ff8800">⚠ MASQUE ${m.mh.toFixed(0)} m @ ${m.md.toFixed(0)} m (+${m.ms.toFixed(0)} m) — site min ${m.smin.toFixed(2)} mil</span>` : `<span style="color:var(--CYAN)">✔ ligne dégagée (crête ${m.mh.toFixed(0)} m, ${(-m.ms).toFixed(0)} m sous la LdT)</span>`}` : "");
  } else {
    if (bal) { s1.textContent = `🚀 ${d.sys} Ch.${d.ch} ‖ Hausse ${bal.hausse.toFixed(0)} mil ‖ Dist ${dTot.toFixed(0)} m ‖ Apex ${(hpt + bal.apex).toFixed(0)} m ‖ Δh ${(hbut - hpt >= 0 ? "+" : "") + (hbut - hpt).toFixed(0)} m ‖ V₀≈${bal.V0.toFixed(0)} m/s`; }
    else s1.textContent = `🚀 Arc approx. ‖ Dist ${dTot.toFixed(0)} m ‖ Apex ${(hpt + apexAbove).toFixed(0)} m ‖ Δh ${(hbut - hpt >= 0 ? "+" : "") + (hbut - hpt).toFixed(0)} m [table indisponible]`;
    s1.style.color = "#ff9999";
    s2.innerHTML = m.md === null ? "✔ Pas de masque" : m.ms > 0 ? `<span style="color:#ff8800">⚠ MASQUE — dist ${m.md.toFixed(0)} m | alt ${m.mh.toFixed(0)} m | surplus +${m.ms.toFixed(0)} m | site min ${m.smin.toFixed(2)} mil</span>` : `<span style="color:var(--CYAN)">✔ Ligne dégagée — crête max ${m.mh.toFixed(0)} m @ ${m.md.toFixed(0)} m (sous LdT de ${(-m.ms).toFixed(0)} m)</span>`;
  }
}
