from pyproj import Transformer, Geod
import tkinter as tk
from tkinter import ttk, messagebox
import math
import struct
import zlib
import os
from datetime import datetime

# ============================================
# CONSTANTS
# ============================================
geod = Geod(ellps="WGS84")
MIL_SYSTEM = 6000

# Déclinaison magnétique Algérie Nord 2025 (WMM2025)
# Valeur pour région Sétif/Batna lat~35°N lon~4°E : +0.565° Est
DECLINAISON_MAG = 0.565  # degrés Est positif, Ouest négatif

# ============================================
# GEO -> UTM
# ============================================
def latlon_to_utm(lat, lon):
    zone = int((lon + 180) / 6) + 1
    epsg = 32600 + zone if lat >= 0 else 32700 + zone
    transformer = Transformer.from_crs("EPSG:4326", f"EPSG:{epsg}", always_xy=True)
    easting, northing = transformer.transform(lon, lat)
    return easting, northing, zone

# ============================================
# UTM -> GEO
# ============================================
def utm_to_latlon(easting, northing, zone, north=True):
    epsg = 32600 + zone if north else 32700 + zone
    transformer = Transformer.from_crs(f"EPSG:{epsg}", "EPSG:4326", always_xy=True)
    lon, lat = transformer.transform(easting, northing)
    return lat, lon

# ============================================
# PARSE GEO STRING "DD MM SS.ss"
# ============================================
def parse_geo(value):
    parts = value.strip().replace(",", ".").split()
    if len(parts) < 3:
        raise ValueError("Format invalide — attendu: DD MM SS.ss")
    deg    = float(parts[0])
    minute = float(parts[1])
    sec    = float(parts[2])
    return deg + minute / 60 + sec / 3600

# ============================================
# DISTANCE + AZIMUT + MILS
# ============================================
def distance_azimut(lat1, lon1, lat2, lon2):
    az12, az21, dist = geod.inv(lon1, lat1, lon2, lat2)
    azimut_vrai = (az12 + 360) % 360
    azimut = (azimut_vrai + DECLINAISON_MAG) % 360
    azimut_mil = azimut * (MIL_SYSTEM / 360)
    return dist, azimut, azimut_mil

# ============================================
# GENERATE ICO IN MEMORY (16x16 + 32x32)
# Crosshair / reticle tactical icon
# ============================================
def _make_png_bytes(size):
    """Generate a PNG of a tactical reticle at given size."""
    import struct, zlib
    w = h = size
    cx = w // 2
    r_outer = int(w * 0.40)
    r_inner = int(w * 0.18)
    gap     = int(w * 0.10)
    thick   = max(1, w // 16)

    # RGBA pixel grid
    img = [[(0, 0, 0, 0)] * w for _ in range(h)]

    def setpx(x, y, col):
        if 0 <= x < w and 0 <= y < h:
            img[y][x] = col

    def draw_circle(cx, cy, r, col, t=1):
        for angle in range(0, 3600):
            a = math.radians(angle / 10)
            for dr in range(t):
                xi = int(cx + (r - dr) * math.cos(a))
                yi = int(cy + (r - dr) * math.sin(a))
                setpx(xi, yi, col)

    AMBER  = (200, 168,  75, 255)
    GREEN  = ( 58, 200,  58, 255)
    WHITE  = (210, 232, 144, 255)

    # Outer circle
    draw_circle(cx, cx, r_outer, AMBER, thick)
    # Inner circle
    draw_circle(cx, cx, r_inner, AMBER, thick)

    # Cross arms (with gap around center)
    for i in range(thick):
        # Top arm
        for y in range(cx - r_outer, cx - gap):
            setpx(cx + i - thick // 2, y, WHITE)
        # Bottom arm
        for y in range(cx + gap, cx + r_outer + 1):
            setpx(cx + i - thick // 2, y, WHITE)
        # Left arm
        for x in range(cx - r_outer, cx - gap):
            setpx(x, cx + i - thick // 2, WHITE)
        # Right arm
        for x in range(cx + gap, cx + r_outer + 1):
            setpx(x, cx + i - thick // 2, WHITE)

    # Center dot
    for dy in range(-thick, thick + 1):
        for dx in range(-thick, thick + 1):
            if dx*dx + dy*dy <= thick*thick:
                setpx(cx + dx, cx + dy, GREEN)

    # Build PNG bytes
    def png_chunk(tag, data):
        c = zlib.crc32(tag + data) & 0xFFFFFFFF
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', c)

    sig = b'\x89PNG\r\n\x1a\n'
    ihdr_data = struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)
    ihdr = png_chunk(b'IHDR', ihdr_data)

    raw = b''
    for row in img:
        raw += b'\x00'
        for px in row:
            raw += bytes([px[0], px[1], px[2], px[3]])
    # RGBA -> use color type 6
    ihdr_data = struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)
    ihdr = png_chunk(b'IHDR', ihdr_data)
    idat = png_chunk(b'IDAT', zlib.compress(raw, 9))
    iend = png_chunk(b'IEND', b'')
    return sig + ihdr + idat + iend


def generate_ico_file(path):
    """Write a 16x16 + 32x32 .ico file to path."""
    png16 = _make_png_bytes(16)
    png32 = _make_png_bytes(32)

    # ICO header
    n = 2
    header = struct.pack('<HHH', 0, 1, n)  # reserved, type=1 (ICO), count

    # Each image entry: width, height, color_count, reserved, planes, bit_count, size, offset
    entry_size = 16
    data_offset = 6 + n * entry_size

    entry16 = struct.pack('<BBBBHHII', 16, 16, 0, 0, 1, 32, len(png16), data_offset)
    entry32 = struct.pack('<BBBBHHII', 32, 32, 0, 0, 1, 32, len(png32), data_offset + len(png16))

    with open(path, 'wb') as f:
        f.write(header + entry16 + entry32 + png16 + png32)


# ============================================
# COLORS
# ============================================
BG       = "#1a2412"
PANEL    = "#0f1a0a"
DARK     = "#060e04"
GREEN    = "#3a5a2a"
GREEN_L  = "#4e7a3a"
GREEN_D  = "#1e3016"
AMBER    = "#c8a84b"
AMBER_D  = "#7a6420"
RED      = "#8b2020"
TEXT     = "#a8c878"
TEXT_DIM = "#5a7a3a"
TEXT_BRT = "#d0e890"
ORANGE   = "#c86a3a"
CYAN     = "#3ad4d4"

# Tailles agrandies + tout en gras pour lisibilité au soleil
FONT_MONO  = ("Courier New", 12, "bold")
FONT_SMALL = ("Courier New", 11, "bold")
FONT_TITLE = ("Courier New", 13, "bold")
FONT_BIG   = ("Courier New", 15, "bold")
FONT_BRAND = ("Courier New", 18, "bold")

# ============================================
# MAIN APP
# ============================================
class EAACApp:
    def __init__(self, root):
        self.root = root
        self.root.title("EAAC — SYSTÈME DE CIBLAGE TACTIQUE")
        self.root.configure(bg=BG)
        self.root.resizable(True, True)
        self.root.minsize(1050, 720)

        # Icône générée dynamiquement
        try:
            ico_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_eaac_gen.ico")
            generate_ico_file(ico_path)
            self.root.iconbitmap(ico_path)
        except Exception:
            pass

        self.po_mode = tk.StringVar(value="geo")
        self.pt_mode = tk.StringVar(value="geo")
        self.tg_mode = tk.StringVar(value="geo")

        self.explosions = []
        self.exp_count  = 0

        self._build_header()
        self._build_main()
        self._build_footer()
        self._clock()

    # ------------------------------------------
    def _build_header(self):
        hdr = tk.Frame(self.root, bg=GREEN_D, bd=0)
        hdr.pack(fill="x", padx=2, pady=(2, 0))

        tk.Label(hdr, text="EAAC — SYSTÈME DE CIBLAGE TACTIQUE",
                 font=("Courier New", 14, "bold"), bg=GREEN_D, fg=AMBER,
                 pady=6).pack(side="left", padx=12)

        tk.Label(hdr, text="FIRE CONTROL SYSTEM v3.0 — WGS84 + DÉCL.MAG + ΔD/ΔP",
                 font=FONT_SMALL, bg=GREEN_D, fg=AMBER_D).pack(side="left")

        right = tk.Frame(hdr, bg=GREEN_D)
        right.pack(side="right", padx=12)

        self.status_dot = tk.Label(right, text="●", font=("Courier New", 16),
                                   bg=GREEN_D, fg="#3aff3a")
        self.status_dot.pack(side="left")

        self.status_lbl = tk.Label(right, text="SYS OPÉRATIONNEL",
                                   font=FONT_SMALL, bg=GREEN_D, fg=TEXT_DIM)
        self.status_lbl.pack(side="left", padx=4)

    # ------------------------------------------
    def _build_main(self):
        main = tk.Frame(self.root, bg=BG)
        main.pack(fill="both", expand=True, padx=2)

        # ── Left panel ────────────────────────
        left = tk.Frame(main, bg=BG, bd=1, relief="flat")
        left.pack(side="left", fill="both", expand=True, padx=(0, 1))

        tk.Label(left, text="  ◈ SAISIE DES COORDONNÉES",
                 font=FONT_TITLE, bg=GREEN_D, fg=AMBER, anchor="w", pady=4).pack(fill="x")

        canvas = tk.Canvas(left, bg=BG, highlightthickness=0)
        scroll = ttk.Scrollbar(left, orient="vertical", command=canvas.yview)
        self.scroll_frame = tk.Frame(canvas, bg=BG)
        self.scroll_frame.bind("<Configure>",
            lambda e: canvas.configure(scrollregion=canvas.bbox("all")))
        canvas.create_window((0, 0), window=self.scroll_frame, anchor="nw")
        canvas.configure(yscrollcommand=scroll.set)
        canvas.pack(side="left", fill="both", expand=True)
        scroll.pack(side="right", fill="y")

        self._build_point_block(self.scroll_frame, "PO", "POINT D'ORIGINE", self.po_mode, "po")
        self._build_point_block(self.scroll_frame, "PT", "POINT DE TIRS",   self.pt_mode, "pt")

        tk.Frame(self.scroll_frame, bg=GREEN, height=1).pack(fill="x", pady=6, padx=8)

        # Nom cible
        tgt_outer = tk.Frame(self.scroll_frame, bg=BG)
        tgt_outer.pack(fill="x", padx=8, pady=(0, 4))
        tk.Label(tgt_outer, text="NOM CIBLE", font=FONT_SMALL, bg=BG, fg=TEXT_DIM, anchor="w").pack(fill="x")
        self.target_name = tk.Entry(tgt_outer, font=FONT_MONO, bg=DARK, fg=TEXT_BRT,
                                    insertbackground=AMBER, relief="flat", bd=2)
        self.target_name.insert(0, "OBJ-ALPHA-01")
        self.target_name.pack(fill="x", ipady=4)

        self._build_point_block(self.scroll_frame, "TG", "CIBLE — COORDONNÉES", self.tg_mode, "tg")

        tk.Frame(self.scroll_frame, bg=AMBER_D, height=1).pack(fill="x", pady=6, padx=8)
        tk.Label(self.scroll_frame, text="  IMPACTS / EXPLOSIONS (DRONE)",
                 font=FONT_SMALL, bg=BG, fg=TEXT_DIM, anchor="w").pack(fill="x", padx=8)

        self.exp_container = tk.Frame(self.scroll_frame, bg=BG)
        self.exp_container.pack(fill="x", padx=8)

        tk.Button(self.scroll_frame, text="+ AJOUTER IMPACT",
                  font=FONT_SMALL, bg=GREEN_D, fg=AMBER,
                  activebackground=GREEN, activeforeground=TEXT_BRT,
                  relief="flat", bd=1, cursor="hand2",
                  command=self._add_explosion).pack(fill="x", padx=8, pady=4, ipady=5)

        tk.Button(self.scroll_frame, text="◉   CALCULER   ◉",
                  font=("Courier New", 13, "bold"), bg=GREEN_D, fg=AMBER,
                  activebackground=AMBER_D, activeforeground=TEXT_BRT,
                  relief="flat", bd=2, cursor="hand2",
                  command=self._calculate).pack(fill="x", padx=8, pady=8, ipady=10)

        # ── Right panel ───────────────────────
        right = tk.Frame(main, bg=PANEL, bd=1, relief="flat")
        right.pack(side="right", fill="both", expand=True)

        tk.Label(right, text="  ◉ RÉSULTATS TEMPS RÉEL",
                 font=FONT_TITLE, bg=GREEN_D, fg=AMBER, anchor="w", pady=4).pack(fill="x")

        res_canvas  = tk.Canvas(right, bg=PANEL, highlightthickness=0)
        res_scroll  = ttk.Scrollbar(right, orient="vertical", command=res_canvas.yview)
        self.res_frame = tk.Frame(res_canvas, bg=PANEL)
        self.res_frame.bind("<Configure>",
            lambda e: res_canvas.configure(scrollregion=res_canvas.bbox("all")))
        res_canvas.create_window((0, 0), window=self.res_frame, anchor="nw")
        res_canvas.configure(yscrollcommand=res_scroll.set)
        res_canvas.pack(side="left", fill="both", expand=True)
        res_scroll.pack(side="right", fill="y")

        tk.Label(self.res_frame,
                 text="\n\n     EN ATTENTE DE DONNÉES\n     SAISIR COORDONNÉES → CALCULER",
                 font=FONT_SMALL, bg=PANEL, fg=TEXT_DIM, justify="center").pack(pady=40)

    # ------------------------------------------
    def _build_point_block(self, parent, tag, title, mode_var, prefix):
        outer = tk.LabelFrame(parent, text=f"  ▶ {tag} — {title}  ",
                              font=FONT_SMALL, bg=BG, fg=AMBER,
                              bd=1, relief="solid", labelanchor="nw")
        outer.pack(fill="x", padx=8, pady=4)

        btn_row = tk.Frame(outer, bg=BG)
        btn_row.pack(fill="x", pady=(4, 4))

        btns = {}
        fields_frame = tk.Frame(outer, bg=BG)
        fields_frame.pack(fill="x", padx=4, pady=(0, 6))

        for m in ["geo", "utm", "skip"]:
            b = tk.Button(btn_row, text=m.upper(), font=FONT_SMALL,
                          bg=GREEN_D, fg=TEXT, activebackground=GREEN,
                          activeforeground=TEXT_BRT, relief="flat", bd=1,
                          cursor="hand2", width=6,
                          command=lambda m=m: self._set_mode(mode_var, m, btns, fields_frame, prefix))
            b.pack(side="left", padx=2, ipady=4)
            btns[m] = b

        btns["geo"].configure(bg=GREEN, fg=TEXT_BRT)
        self._build_geo_fields(fields_frame, prefix)

        setattr(self, f"{prefix}_btns",   btns)
        setattr(self, f"{prefix}_fields", fields_frame)

    # ------------------------------------------
    def _set_mode(self, mode_var, mode, btns, fields_frame, prefix):
        mode_var.set(mode)
        for m, b in btns.items():
            if m == mode:
                b.configure(bg=GREEN if m != "skip" else AMBER_D,
                            fg=TEXT_BRT if m != "skip" else AMBER)
            else:
                b.configure(bg=GREEN_D, fg=TEXT)

        for w in fields_frame.winfo_children():
            w.destroy()

        if mode == "geo":
            self._build_geo_fields(fields_frame, prefix)
        elif mode == "utm":
            self._build_utm_fields(fields_frame, prefix)
        else:
            tk.Label(fields_frame, text="POINT IGNORÉ", font=FONT_SMALL,
                     bg=BG, fg=TEXT_DIM).pack(anchor="w", padx=4, pady=4)

    # ------------------------------------------
    def _build_geo_fields(self, parent, prefix):
        row = tk.Frame(parent, bg=BG)
        row.pack(fill="x")
        for label, attr in [("LATITUDE", f"{prefix}_lat"), ("LONGITUDE", f"{prefix}_lon")]:
            col = tk.Frame(row, bg=BG)
            col.pack(side="left", fill="x", expand=True, padx=2)
            tk.Label(col, text=label, font=FONT_SMALL, bg=BG, fg=TEXT_DIM, anchor="w").pack(fill="x")
            e = tk.Entry(col, font=FONT_MONO, bg=DARK, fg=TEXT_BRT,
                         insertbackground=AMBER, relief="flat", bd=2)
            e.pack(fill="x", ipady=4)
            setattr(self, attr, e)

    # ------------------------------------------
    def _build_utm_fields(self, parent, prefix):
        row = tk.Frame(parent, bg=BG)
        row.pack(fill="x")
        for label, attr, w in [("EASTING", f"{prefix}_e", 8),
                                ("NORTHING", f"{prefix}_n", 8),
                                ("ZONE",     f"{prefix}_z", 4)]:
            col = tk.Frame(row, bg=BG)
            col.pack(side="left", fill="x", expand=True, padx=2)
            tk.Label(col, text=label, font=FONT_SMALL, bg=BG, fg=TEXT_DIM, anchor="w").pack(fill="x")
            e = tk.Entry(col, font=FONT_MONO, bg=DARK, fg=TEXT_BRT,
                         insertbackground=AMBER, relief="flat", bd=2, width=w)
            e.pack(fill="x", ipady=4)
            setattr(self, attr, e)

    # ------------------------------------------
    def _add_explosion(self):
        self.exp_count += 1
        idx = self.exp_count

        frame = tk.LabelFrame(self.exp_container, text=f"  ◈ IMPACT {idx}  ",
                              font=FONT_SMALL, bg=BG, fg=ORANGE,
                              bd=1, relief="solid", labelanchor="nw")
        frame.pack(fill="x", pady=3)

        mode_var = tk.StringVar(value="geo")
        btn_row  = tk.Frame(frame, bg=BG)
        btn_row.pack(fill="x", pady=(2, 2))

        btns    = {}
        fields_f = tk.Frame(frame, bg=BG)
        fields_f.pack(fill="x", padx=4, pady=(0, 4))

        for m in ["geo", "utm"]:
            b = tk.Button(btn_row, text=m.upper(), font=FONT_SMALL,
                          bg=GREEN_D, fg=TEXT, activebackground=GREEN,
                          activeforeground=TEXT_BRT, relief="flat", bd=1,
                          cursor="hand2", width=6,
                          command=lambda m=m, mv=mode_var, ff=fields_f, i=idx, bs=btns:
                              self._set_exp_mode(mv, m, bs, ff, i))
            b.pack(side="left", padx=2, ipady=3)
            btns[m] = b

        btns["geo"].configure(bg=GREEN, fg=TEXT_BRT)
        self._build_exp_geo(fields_f, idx)

        self.explosions.append({
            "mode": mode_var, "fields": fields_f, "btns": btns, "idx": idx
        })

    # ------------------------------------------
    def _build_exp_geo(self, parent, idx, lat_e=None, lon_e=None):
        for w in parent.winfo_children():
            w.destroy()
        row = tk.Frame(parent, bg=BG)
        row.pack(fill="x")
        for label, attr in [("LAT", f"exp{idx}_lat"), ("LON", f"exp{idx}_lon")]:
            col = tk.Frame(row, bg=BG)
            col.pack(side="left", fill="x", expand=True, padx=2)
            tk.Label(col, text=label, font=FONT_SMALL, bg=BG, fg=TEXT_DIM, anchor="w").pack(fill="x")
            e = tk.Entry(col, font=FONT_MONO, bg=DARK, fg=TEXT_BRT,
                         insertbackground=AMBER, relief="flat", bd=2)
            e.pack(fill="x", ipady=4)
            setattr(self, attr, e)

    # ------------------------------------------
    def _build_exp_utm(self, parent, idx):
        for w in parent.winfo_children():
            w.destroy()
        row = tk.Frame(parent, bg=BG)
        row.pack(fill="x")
        for label, attr in [("EASTING", f"exp{idx}_e"),
                             ("NORTHING", f"exp{idx}_n"),
                             ("ZONE",     f"exp{idx}_z")]:
            col = tk.Frame(row, bg=BG)
            col.pack(side="left", fill="x", expand=True, padx=2)
            tk.Label(col, text=label, font=FONT_SMALL, bg=BG, fg=TEXT_DIM, anchor="w").pack(fill="x")
            e = tk.Entry(col, font=FONT_MONO, bg=DARK, fg=TEXT_BRT,
                         insertbackground=AMBER, relief="flat", bd=2)
            e.pack(fill="x", ipady=4)
            setattr(self, attr, e)

    # ------------------------------------------
    def _set_exp_mode(self, mode_var, mode, btns, fields_f, idx):
        mode_var.set(mode)
        for m, b in btns.items():
            b.configure(bg=GREEN if m == mode else GREEN_D,
                        fg=TEXT_BRT if m == mode else TEXT)
        if mode == "geo":
            self._build_exp_geo(fields_f, idx)
        else:
            self._build_exp_utm(fields_f, idx)

    # ------------------------------------------
    def _get_point(self, prefix, mode_var):
        mode = mode_var.get()
        if mode == "skip":
            return None
        try:
            if mode == "geo":
                lat = parse_geo(getattr(self, f"{prefix}_lat").get())
                lon = parse_geo(getattr(self, f"{prefix}_lon").get())
                return lat, lon
            else:
                e = float(getattr(self, f"{prefix}_e").get())
                n = float(getattr(self, f"{prefix}_n").get())
                z = int(getattr(self, f"{prefix}_z").get())
                return utm_to_latlon(e, n, z)
        except Exception as ex:
            messagebox.showerror("ERREUR SAISIE", f"Point {prefix.upper()}: {ex}")
            return "error"

    # ------------------------------------------
    def _get_explosion(self, exp_info):
        idx  = exp_info["idx"]
        mode = exp_info["mode"].get()
        try:
            if mode == "geo":
                lat = parse_geo(getattr(self, f"exp{idx}_lat").get())
                lon = parse_geo(getattr(self, f"exp{idx}_lon").get())
                return lat, lon
            else:
                e = float(getattr(self, f"exp{idx}_e").get())
                n = float(getattr(self, f"exp{idx}_n").get())
                z = int(getattr(self, f"exp{idx}_z").get())
                return utm_to_latlon(e, n, z)
        except Exception:
            return None

    # ------------------------------------------
    def _calculate(self):
        PO = self._get_point("po", self.po_mode)
        PT = self._get_point("pt", self.pt_mode)
        TG = self._get_point("tg", self.tg_mode)

        if PO == "error" or PT == "error" or TG == "error":
            return
        if TG is None:
            messagebox.showwarning("CIBLE REQUISE", "Veuillez saisir les coordonnées de la cible.")
            return

        for w in self.res_frame.winfo_children():
            w.destroy()

        name = self.target_name.get() or "OBJECTIF"
        ts   = datetime.now().strftime("%H:%M:%S")

        tk.Label(self.res_frame,
                 text=f"  ◉ CIBLE: {name.upper()}  |  {ts} UTC",
                 font=FONT_TITLE, bg=DARK, fg=AMBER, anchor="w", pady=5
                 ).pack(fill="x", padx=6, pady=(6, 4))

        if PO:
            self._result_block("PO → CIBLE", PO[0], PO[1], TG[0], TG[1])
        if PT:
            self._result_block("PT → CIBLE", PT[0], PT[1], TG[0], TG[1])

        for exp_info in self.explosions:
            coords = self._get_explosion(exp_info)
            if coords:
                idx = exp_info["idx"]
                tk.Label(self.res_frame, text=f"  ◈ IMPACT {idx}",
                         font=FONT_TITLE, bg="#1a0a06", fg=ORANGE,
                         anchor="w", pady=4).pack(fill="x", padx=6, pady=(8, 2))

                if PO:
                    self._result_block(f"PO → IMPACT {idx}",
                                       PO[0], PO[1], coords[0], coords[1],
                                       color=ORANGE)
                if PT:
                    # Pour les impacts, on passe aussi les coords TG pour ΔD/ΔP
                    self._result_block(f"PT → IMPACT {idx}",
                                       PT[0], PT[1], coords[0], coords[1],
                                       color=ORANGE, tg_coords=TG)

    # ------------------------------------------
    def _result_block(self, title, lat1, lon1, lat2, lon2,
                      color=AMBER, tg_coords=None):
        """
        Affiche un bloc résultat Distance / Azimut / Mils.
        Si tg_coords est fourni (cas impact vu depuis PT),
        affiche aussi la correction ΔD (m) et ΔP (mils).
        """
        dist, az, mil = distance_azimut(lat1, lon1, lat2, lon2)

        block = tk.Frame(self.res_frame, bg=DARK, bd=1, relief="solid")
        block.pack(fill="x", padx=6, pady=3)

        # Titre du bloc
        tk.Label(block, text=f"  {title}",
                 font=FONT_TITLE, bg=DARK, fg=color,
                 anchor="w", pady=5).pack(fill="x")
        tk.Frame(block, bg=AMBER_D, height=1).pack(fill="x")

        # Lignes principales
        rows_data = [
            ("DISTANCE",       f"{dist:.1f} m",  "#3aff3a"),
            ("AZIMUT",         f"{az:.2f} °",    TEXT_BRT),
            (f"MIL ({MIL_SYSTEM})", f"{mil:.2f}", TEXT_BRT),
        ]
        for label, val, val_color in rows_data:
            row = tk.Frame(block, bg=DARK)
            row.pack(fill="x", padx=10, pady=2)
            tk.Label(row, text=label, font=FONT_MONO, bg=DARK, fg=TEXT_DIM,
                     anchor="w", width=16).pack(side="left")
            tk.Label(row, text=val, font=FONT_BIG, bg=DARK, fg=val_color,
                     anchor="e").pack(side="right")

        # ── CORRECTION D'ÉCLATEMENT ΔD / ΔP ─────────────────────────────
        # Calculé uniquement quand on a la cible (bloc PT → IMPACT)
        if tg_coords is not None:
            dist_tg, az_tg, mil_tg = distance_azimut(lat1, lon1, tg_coords[0], tg_coords[1])

            # ΔD = -(D_éclatement − D_but)
            #   > 0 → allonger le tir   (impact court)
            #   < 0 → raccourcir le tir (impact long)
            delta_d = -(dist - dist_tg)

            # ΔP = -(P_éclatement − P_but)  [en mils]
            #   > 0 → corriger à droite
            #   < 0 → corriger à gauche
            delta_p = -(mil - mil_tg)

            # Normaliser ΔP dans [-3000 ; +3000]
            if delta_p > MIL_SYSTEM / 2:
                delta_p -= MIL_SYSTEM
            elif delta_p < -MIL_SYSTEM / 2:
                delta_p += MIL_SYSTEM

            # Séparateur
            tk.Frame(block, bg=CYAN, height=1).pack(fill="x", pady=(6, 0))
            tk.Label(block, text="  ▶ CORRECTION D'ÉCLATEMENT",
                     font=FONT_SMALL, bg=DARK, fg=CYAN,
                     anchor="w", pady=3).pack(fill="x")

            # Sens en texte
            sens_d = ("▲ ALLONGER" if delta_d > 0 else "▼ RACCOURCIR") if abs(delta_d) > 0.5 else "— NUL"
            sens_p = ("► DROITE"   if delta_p > 0 else "◄ GAUCHE")    if abs(delta_p) > 0.5 else "— NUL"

            corr_data = [
                ("ΔD DISTANCE", f"{delta_d:+.1f} m",   sens_d),
                ("ΔP DIRECTION", f"{delta_p:+.2f} mil", sens_p),
            ]
            for label, val, sens in corr_data:
                row = tk.Frame(block, bg=DARK)
                row.pack(fill="x", padx=10, pady=2)
                tk.Label(row, text=label, font=FONT_MONO, bg=DARK, fg=TEXT_DIM,
                         anchor="w", width=16).pack(side="left")
                val_color = "#3aff3a" if delta_d > 0 else (ORANGE if delta_d < 0 else TEXT_DIM)
                if "ΔP" in label:
                    val_color = CYAN
                tk.Label(row, text=f"{val}  {sens}", font=FONT_BIG, bg=DARK,
                         fg=val_color, anchor="e").pack(side="right")

    # ------------------------------------------
    def _build_footer(self):
        ftr = tk.Frame(self.root, bg=GREEN_D, bd=0)
        ftr.pack(fill="x", padx=2, pady=(0, 2))

        brand_f = tk.Frame(ftr, bg=GREEN_D)
        brand_f.pack(side="left", padx=12, pady=6)
        tk.Label(brand_f, text="EAAC", font=FONT_BRAND, bg=GREEN_D, fg=AMBER).pack(anchor="w")
        tk.Label(brand_f, text="ENTERPRISE ASSISTANCE ARTILLERIE & CIBLAGE",
                 font=("Courier New", 9, "bold"), bg=GREEN_D, fg=TEXT_DIM).pack(anchor="w")

        tk.Button(ftr, text="■  TERMINER SESSION",
                  font=FONT_SMALL, bg=RED, fg="#ffaaaa",
                  activebackground="#aa2222", activeforeground="#ffcccc",
                  relief="flat", bd=1, cursor="hand2",
                  command=self._terminate
                  ).pack(side="right", padx=12, pady=8, ipady=5, ipadx=8)

        right_f = tk.Frame(ftr, bg=GREEN_D)
        right_f.pack(side="right", padx=12)
        self.clock_lbl = tk.Label(right_f, text="--:--:--", font=FONT_TITLE,
                                  bg=GREEN_D, fg=TEXT_DIM)
        self.clock_lbl.pack()
        tk.Label(right_f, text="UTC+01", font=("Courier New", 9, "bold"),
                 bg=GREEN_D, fg=TEXT_DIM).pack()

    # ------------------------------------------
    def _clock(self):
        self.clock_lbl.configure(text=datetime.now().strftime("%H:%M:%S"))
        self.root.after(1000, self._clock)

    # ------------------------------------------
    def _terminate(self):
        if messagebox.askyesno("TERMINER", "Confirmer la fin de session ?"):
            for w in self.res_frame.winfo_children():
                w.destroy()
            tk.Label(self.res_frame,
                     text="\n\n     SESSION TERMINÉE\n     SYSTÈME HORS LIGNE",
                     font=FONT_TITLE, bg=PANEL, fg=RED, justify="center").pack(pady=60)
            self.status_dot.configure(fg=RED)
            self.status_lbl.configure(text="SYSTÈME ARRÊTÉ")


# ============================================
# LAUNCH
# ============================================
if __name__ == "__main__":
    root = tk.Tk()
    app  = EAACApp(root)
    root.mainloop()
