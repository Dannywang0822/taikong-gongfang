#!/usr/bin/env python3
"""Original P0 part sprites for 太空工坊 v0.4.

v0.3 was judged too soft / hand-painted. This revision keeps the same
original silhouettes and tightens the metal: harder edges, less wrap
lighting, visible axial and circumferential brushed grain, sharper
seams and bevels, and a heat-tinted nozzle with a deeper cavity.

Visual language is still informed only by public official Spaceflight
Simulator store screenshots. Every pixel is generated here; no official
image, cutout, font, or extract is sampled, pasted, or traced.
"""
from __future__ import annotations

import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

OUT = Path(__file__).resolve().parent / "parts"
OUT.mkdir(parents=True, exist_ok=True)

# Light from upper-left, matching official store shots.
LX, LY, LZ = -0.42, -0.18, 0.89
_L = math.sqrt(LX * LX + LY * LY + LZ * LZ)
LX, LY, LZ = LX / _L, LY / _L, LZ / _L


def _norm(rgb):
    return tuple(int(max(0, min(255, v))) / 255.0 for v in rgb)


# Harder, higher-contrast metals than v0.3. Brush strengths are the
# visible pulled-grain, not random noise.
PAL = {
    "white": {
        "base": _norm((238, 241, 245)),
        "shadow": _norm((118, 126, 136)),
        "spec": _norm((255, 255, 255)),
        "spec_pow": 70.0,
        "spec_amt": 0.80,
        "ambient": 0.20,
        "grain": 0.005,
        "brush_axial": 0.048,
        "brush_ring": 0.0,
    },
    "white_soft": {
        "base": _norm((222, 226, 232)),
        "shadow": _norm((108, 116, 126)),
        "spec": _norm((255, 255, 255)),
        "spec_pow": 52.0,
        "spec_amt": 0.62,
        "ambient": 0.22,
        "grain": 0.006,
        "brush_axial": 0.050,
        "brush_ring": 0.0,
    },
    "silver": {
        "base": _norm((168, 174, 184)),
        "shadow": _norm((70, 76, 86)),
        "spec": _norm((250, 252, 255)),
        "spec_pow": 90.0,
        "spec_amt": 0.90,
        "ambient": 0.16,
        "grain": 0.006,
        "brush_axial": 0.085,
        "brush_ring": 0.030,
    },
    "steel": {
        "base": _norm((142, 148, 158)),
        "shadow": _norm((58, 64, 72)),
        "spec": _norm((232, 236, 242)),
        "spec_pow": 56.0,
        "spec_amt": 0.62,
        "ambient": 0.18,
        "grain": 0.007,
        "brush_axial": 0.070,
        "brush_ring": 0.045,
    },
    "bell": {
        "base": _norm((42, 44, 48)),
        "shadow": _norm((10, 11, 13)),
        "spec": _norm((168, 172, 178)),
        "spec_pow": 36.0,
        "spec_amt": 0.42,
        "ambient": 0.12,
        "grain": 0.006,
        "brush_axial": 0.018,
        "brush_ring": 0.10,
    },
    "charcoal": {
        "base": _norm((52, 54, 58)),
        "shadow": _norm((16, 17, 19)),
        "spec": _norm((176, 180, 186)),
        "spec_pow": 52.0,
        "spec_amt": 0.50,
        "ambient": 0.16,
        "grain": 0.006,
        "brush_axial": 0.04,
        "brush_ring": 0.04,
    },
    "gold_ring": {
        "base": _norm((168, 140, 86)),
        "shadow": _norm((84, 66, 34)),
        "spec": _norm((255, 232, 180)),
        "spec_pow": 70.0,
        "spec_amt": 0.75,
        "ambient": 0.18,
        "grain": 0.006,
        "brush_axial": 0.04,
        "brush_ring": 0.06,
    },
    "glass": {
        "base": _norm((24, 28, 34)),
        "shadow": _norm((8, 10, 14)),
        "spec": _norm((210, 230, 245)),
        "spec_pow": 110.0,
        "spec_amt": 0.98,
        "ambient": 0.14,
        "grain": 0.0,
        "brush_axial": 0.0,
        "brush_ring": 0.0,
    },
}


def canvas(w, h):
    return np.zeros((h, w, 4), dtype=np.float64)


def over(dst, src):
    a = src[..., 3:4]
    out = dst * (1.0 - a) + src * a
    out[..., 3] = dst[..., 3] + src[..., 3] * (1.0 - dst[..., 3])
    return out


def _axial_brush(u, r, y, strength):
    """Clear vertical (axial) brush marks, slightly wavy along y."""
    if strength <= 0:
        return np.zeros_like(u)
    phi = np.arcsin(np.clip(u, -1.0, 1.0))
    s = r * phi + 0.22 * np.sin(y * 0.11)
    marks = (
        0.50 * np.sin(s * 2.35)
        + 0.28 * np.sin(s * 6.4 + 1.3)
        + 0.14 * np.sin(s * 14.8 + 0.6)
        + 0.08 * np.sin(s * 29.0 + 2.2)
    )
    return marks * strength


def _ring_brush(y, u, strength):
    """Circumferential brush, used on hoops and bells."""
    if strength <= 0:
        return np.zeros_like(y)
    s = y + 0.18 * u
    marks = (
        0.50 * np.sin(s * 2.8)
        + 0.30 * np.sin(s * 7.1 + 0.9)
        + 0.20 * np.sin(s * 16.4 + 1.7)
    )
    return marks * strength


def _mat_color(mat, ndotl, nspec, rng, lum=None):
    amb = mat["ambient"]
    if lum is None:
        nd = np.clip(ndotl, 0, 1)
        # faster falloff than v0.3 — less wrapped, softer air
        shade = amb + (1.0 - amb) * (nd ** 1.45)
    else:
        if np.isscalar(lum) or (hasattr(lum, "ndim") and lum.ndim == 0):
            shade = float(lum)
        else:
            shade = lum
    col = np.array(mat["shadow"])[None, None, :] + (
        np.array(mat["base"]) - np.array(mat["shadow"])
    )[None, None, :] * np.clip(shade, 0, 1)[..., None]
    col = col + (np.array(mat["spec"]) - col) * (nspec * mat["spec_amt"])[..., None]
    if mat["grain"] > 0:
        g = (rng.random(col.shape[:2]) - 0.5) * mat["grain"]
        col = col + g[..., None]
    return np.clip(col, 0, 1)


def shade_disk(dst, cx, cy, r, mat, rng, z_scale=1.0, y_amp=0.0):
    h, w = dst.shape[:2]
    y = np.broadcast_to(np.arange(h, dtype=np.float64)[:, None], (h, w)).copy()
    x = np.broadcast_to(np.arange(w, dtype=np.float64)[None, :], (h, w)).copy()
    dx = (x - cx) / max(r, 1e-6)
    dy = (y - cy) / max(r, 1e-6)
    rr = dx * dx + dy * dy
    mask = rr <= 1.0
    z = np.sqrt(np.clip(1.0 - rr, 0, 1)) * z_scale
    ndotl = (-dx * LX - (dy * (1.0 - y_amp)) * LY + z * LZ)
    refl_z = 2 * z * ndotl - LZ
    nspec = np.clip(refl_z, 0, 1) ** mat["spec_pow"]
    col = _mat_color(mat, ndotl, nspec, rng)
    # radial brush on caps (machined face)
    if mat.get("brush_ring", 0) or mat.get("brush_axial", 0):
        rad = np.sqrt(rr)
        ang = np.arctan2(dy, dx)
        marks = 0.5 * np.sin(rad * r * 1.8) + 0.3 * np.sin(ang * 18)
        col = np.clip(col * (1.0 + marks[..., None] * 0.04), 0, 1)
    layer = np.zeros_like(dst)
    layer[mask, :3] = col[mask]
    # 1px AA
    layer[mask, 3] = np.clip((1.0 - np.sqrt(rr[mask])) * r + 0.5, 0, 1)
    return over(dst, layer)


def cylinder_field(h, w, cx, y0, y1, radius, mat, rng, flute_n=0, flute_amp=0.0,
                   hoop_ys=None, hoop_w=5, hoop_mat=None, hoop_inset=0.0):
    """Solid of revolution with brushed metal, hard bevels and optional hoops."""
    y = np.broadcast_to(np.arange(h, dtype=np.float64)[:, None], (h, w)).copy()
    x = np.broadcast_to(np.arange(w, dtype=np.float64)[None, :], (h, w)).copy()
    inside = (y >= y0) & (y <= y1)
    if np.isscalar(radius):
        r = np.full((h, w), float(radius))
    else:
        rr = np.asarray(radius, dtype=np.float64)
        if rr.ndim == 2:
            r = rr if rr.shape == (h, w) else np.broadcast_to(rr, (h, w)).copy()
        else:
            r = np.broadcast_to(rr.reshape(-1, 1), (h, w)).copy()
    dx = x - cx
    u = np.zeros((h, w))
    safe = r > 0.5
    u[safe] = dx[safe] / r[safe]
    phi = np.arcsin(np.clip(u, -1, 1))
    if flute_n and flute_amp:
        r = r + flute_amp * np.cos(flute_n * phi)
        u = np.zeros((h, w))
        safe = r > 0.5
        u[safe] = dx[safe] / r[safe]
        phi = np.arcsin(np.clip(u, -1, 1))
    mask = inside & (np.abs(u) <= 1.0)
    z = np.sqrt(np.clip(1.0 - u * u, 0, 1))
    nx, ny, nz = u, np.zeros_like(u), z
    if flute_n and flute_amp:
        d = -flute_n * flute_amp * np.sin(flute_n * phi)
        nz = nz + d * 0.16  # harder stringer edges than v0.3
        nlen = np.sqrt(nx * nx + nz * nz) + 1e-8
        nx, nz = nx / nlen, nz / nlen
    ndotl = -(nx * LX) - (ny * LY) + (nz * LZ)
    refl = 2 * nz * ndotl - LZ
    nspec = np.clip(refl, 0, 1) ** mat["spec_pow"]
    # tighter, harder highlight band
    band = np.exp(-((u + 0.20) ** 2) / 0.028)
    nspec = np.clip(nspec + band * 0.42, 0, 1)
    col = _mat_color(mat, ndotl, nspec, rng)

    # brushed grain — axial on tanks, plus any ring component
    ba = mat.get("brush_axial", 0.0)
    br = mat.get("brush_ring", 0.0)
    if ba:
        b = _axial_brush(u, r, y, ba)
        col = col * (1.0 + b[..., None] * 0.90)
        col = col + (b * band * 0.10)[..., None]
    if br:
        b2 = _ring_brush(y, u, br)
        col = col * (1.0 + b2[..., None])

    # hard edge bevel + crisp chamfer highlights
    edge_amt = np.clip((np.abs(u) - 0.84) / 0.16, 0, 1)
    col = col * (1.0 - 0.42 * edge_amt)[..., None]
    left_rim = np.exp(-((u + 0.97) ** 2) / 0.0009) * 0.24
    right_rim = np.exp(-((u - 0.97) ** 2) / 0.0009) * 0.07
    col = col + (left_rim + right_rim)[..., None]
    col = np.clip(col, 0, 1)

    layer = np.zeros((h, w, 4))
    layer[mask, :3] = col[mask]
    # 1px hard AA (not a soft airbrush halo)
    px = (1.0 - np.abs(u)) * r
    layer[mask, 3] = np.clip(px[mask] + 0.5, 0, 1)

    dst = layer
    if hoop_ys:
        hm = hoop_mat or PAL["silver"]
        for hy in hoop_ys:
            # recessed seam just above and below the bead
            dst = over(dst, _seam_groove(h, w, cx, hy, r, hoop_w, rng))
            hoop = _hoop_band(h, w, cx, hy, r, hoop_w, hm, rng, inset=hoop_inset)
            dst = over(dst, hoop)
    return dst


def _seam_groove(h, w, cx, hy, r_field, hoop_w, rng):
    """Dark recessed grooves that sit against a hoop, plus a thin lip highlight."""
    y = np.broadcast_to(np.arange(h, dtype=np.float64)[:, None], (h, w)).copy()
    x = np.broadcast_to(np.arange(w, dtype=np.float64)[None, :], (h, w)).copy()
    if np.isscalar(r_field):
        rmap = np.full((h, w), float(r_field))
    else:
        rmap = np.asarray(r_field, dtype=np.float64)
        if rmap.ndim == 1:
            rmap = np.broadcast_to(rmap.reshape(-1, 1), (h, w))
    u = np.zeros((h, w))
    safe = rmap > 0.5
    u[safe] = (x[safe] - cx) / rmap[safe]
    half = hoop_w / 2.0 + 1.2
    # two thin bands at the hoop lips
    d1 = np.abs(y - (hy - half))
    d2 = np.abs(y - (hy + half))
    d = np.minimum(d1, d2)
    mask = (d <= 1.15) & (np.abs(u) <= 1.0)
    layer = np.zeros((h, w, 4))
    # groove is almost black, lip slightly lighter on the upper edge
    shade = 0.10 + 0.08 * (y < hy)
    layer[mask, 0] = shade[mask]
    layer[mask, 1] = shade[mask] + 0.01
    layer[mask, 2] = shade[mask] + 0.02
    layer[mask, 3] = np.clip(1.0 - d[mask] / 1.15, 0, 1) * 0.85
    return layer


def _hoop_band(h, w, cx, hy, r_field, width, mat, rng, inset=0.0):
    y = np.broadcast_to(np.arange(h, dtype=np.float64)[:, None], (h, w)).copy()
    x = np.broadcast_to(np.arange(w, dtype=np.float64)[None, :], (h, w)).copy()
    if np.isscalar(r_field):
        rmap = np.full((h, w), float(r_field) - inset)
    else:
        rmap = np.asarray(r_field, dtype=np.float64)
        if rmap.ndim == 1:
            rmap = np.broadcast_to(rmap.reshape(-1, 1), (h, w))
        rmap = rmap - inset
    dx = x - cx
    safe = rmap > 0.5
    u = np.zeros((h, w))
    u[safe] = dx[safe] / rmap[safe]
    t = np.abs(y - hy)
    mask = (t <= width / 2.0 + 0.6) & (np.abs(u) <= 1.02)
    typ = np.clip(1.0 - (t / (width / 2.0 + 0.6)) ** 2, 0, 1)
    z = np.sqrt(np.clip(1.0 - np.clip(u, -1, 1) ** 2, 0, 1)) + typ * 0.32
    nlen = np.sqrt(np.clip(u, -1, 1) ** 2 + z * z) + 1e-8
    nx, nz = np.clip(u, -1, 1) / nlen, z / nlen
    ndotl = -(nx * LX) + (nz * LZ)
    nspec = np.clip(2 * nz * ndotl - LZ, 0, 1) ** mat["spec_pow"]
    # tight highlight along the bead's crown
    nspec = np.clip(nspec + typ * np.exp(-((u + 0.20) ** 2) / 0.03) * 0.35, 0, 1)
    col = _mat_color(mat, ndotl, nspec, rng)
    b = _ring_brush(y, u, mat.get("brush_ring", 0.05) or 0.05)
    b += _axial_brush(u, rmap, y, mat.get("brush_axial", 0.04) * 0.5)
    col = np.clip(col * (1.0 + b[..., None]), 0, 1)
    # hard bevel at hoop ends
    edge = np.clip((np.abs(u) - 0.88) / 0.12, 0, 1)
    col = np.clip(col * (1.0 - 0.35 * edge)[..., None], 0, 1)
    layer = np.zeros((h, w, 4))
    layer[mask, :3] = col[mask]
    layer[mask, 3] = np.clip(typ[mask] * 1.2, 0, 1)
    return layer


def cone_field(h, w, cx, y0, y1, r0, r1, mat, rng, cap=True):
    ys = np.arange(h)[:, None]
    t = (ys - y0) / max(y1 - y0, 1e-6)
    r = r0 + (r1 - r0) * np.clip(t, 0, 1)
    r = np.broadcast_to(r, (h, w))
    dst = cylinder_field(h, w, cx, y0, y1, r, mat, rng)
    if cap and r1 > 2:
        cy = y1 if r1 >= r0 else y0
        rr = max(r1, r0)
        dst = shade_disk(dst, cx, cy, rr * 0.98, mat, rng, z_scale=0.35, y_amp=0.4)
    return dst


def ogive_field(h, w, cx, y0, y1, r_max, mat, rng, tip_r=0.15):
    """Rounded nose / capsule dome."""
    ys = np.arange(h)[:, None]
    t = np.clip((ys - y0) / max(y1 - y0, 1e-6), 0, 1)
    r = r_max * np.sin(t * math.pi / 2)
    r = np.maximum(r, r_max * tip_r * (t < 0.08))
    r = np.broadcast_to(r, (h, w))
    return cylinder_field(h, w, cx, y0, y1, r, mat, rng)


def bell_field(h, w, cx, y0, y1, r_throat, r_exit, mat, rng, ridges=14):
    """Dark ridged bell with heat tint near the throat and a deep exit cavity."""
    ys = np.arange(h)[:, None].astype(np.float64)
    t = np.clip((ys - y0) / max(y1 - y0, 1e-6), 0, 1)
    k = t * t * (3 - 2 * t)
    r = r_throat + (r_exit - r_throat) * (0.15 + 0.85 * k)
    r = np.broadcast_to(r, (h, w))
    dst = cylinder_field(h, w, cx, y0, y1, r, mat, rng)
    # heat-tint: straw + steel-blue iridescence near the throat
    straw = np.array(_norm((196, 142, 64)))
    blue = np.array(_norm((72, 96, 140)))
    heat_w = np.exp(-((t[:, 0] if t.shape[1] == 1 else t) / 0.32) ** 2)
    if heat_w.ndim == 1:
        heat_w = np.broadcast_to(heat_w[:, None], (h, w))
    # slight left/right variation so it reads as a surface, not a wash
    y = np.broadcast_to(np.arange(h, dtype=np.float64)[:, None], (h, w))
    x = np.broadcast_to(np.arange(w, dtype=np.float64)[None, :], (h, w))
    u = np.zeros((h, w))
    safe = r > 0.5
    u[safe] = (x[safe] - cx) / r[safe]
    mix = 0.45 + 0.35 * np.clip(u, -1, 1)  # straw more on the lit side
    tint = straw[None, None, :] * mix[..., None] + blue[None, None, :] * (1.0 - mix)[..., None]
    amt = (0.22 * heat_w * dst[..., 3])[..., None]
    dst[..., :3] = np.clip(dst[..., :3] * (1.0 - amt) + tint * amt, 0, 1)
    # soot toward the exit
    soot = np.clip((t - 0.55) / 0.45, 0, 1)
    if soot.ndim == 1 or soot.shape[1] == 1:
        soot = np.broadcast_to(np.asarray(soot).reshape(h, 1), (h, w))
    dst[..., :3] *= (1.0 - 0.18 * soot * dst[..., 3])[..., None]

    span = y1 - y0
    for i in range(ridges):
        hy = y0 + span * (0.08 + 0.84 * (i + 0.5) / ridges)
        tt = (hy - y0) / max(span, 1)
        kk = tt * tt * (3 - 2 * tt)
        rr = r_throat + (r_exit - r_throat) * (0.15 + 0.85 * kk)
        hoop = _hoop_band(h, w, cx, hy, rr, width=max(3.0, span / ridges * 0.55),
                          mat=mat, rng=rng, inset=-0.6)
        dst = over(dst, hoop)
    cavity = _nozzle_cavity(h, w, cx, y1 - 1, r_exit * 0.90, max(9.0, (y1 - y0) * 0.11), rng)
    dst = over(dst, cavity)
    return dst


def _nozzle_cavity(h, w, cx, cy, rx, ry, rng):
    y = np.broadcast_to(np.arange(h, dtype=np.float64)[:, None], (h, w)).copy()
    x = np.broadcast_to(np.arange(w, dtype=np.float64)[None, :], (h, w)).copy()
    dx = (x - cx) / max(rx, 1e-6)
    dy = (y - cy) / max(ry, 1e-6)
    rr = dx * dx + dy * dy
    mask = rr <= 1.0
    z = np.sqrt(np.clip(1.0 - rr, 0, 1))
    # cup interior: walls recede, throat is a deep well
    ndotl = dx * 0.55 + 0.10 + z * 0.15
    shade = 0.07 + 0.50 * np.clip(ndotl, 0, 1)
    shade = shade * (0.22 + 0.78 * np.clip(rr, 0, 1) ** 0.7)
    col = _mat_color(PAL["bell"], ndotl, np.zeros_like(ndotl), rng, lum=shade)
    # inner-wall heat (straw near the rim, darker blue in the well)
    straw = np.array(_norm((170, 120, 55)))
    heat = np.clip((rr - 0.35) / 0.5, 0, 1)
    col = col * (1.0 - 0.18 * heat[..., None]) + straw[None, None, :] * (0.18 * heat[..., None])
    # circumferential machining rings on the inner wall
    rings = 0.5 + 0.5 * np.sin(np.sqrt(rr) * 14.0)
    col = col * (0.92 + 0.12 * rings[..., None])
    # thick exit rim: bright chamfer
    rim = (rr > 0.70) & (rr <= 1.0)
    rim_w = np.clip((rr - 0.70) / 0.30, 0, 1)
    col[rim] = np.clip(col[rim] + 0.28 * rim_w[rim, None], 0, 1)
    # inner lip shadow just inside the rim
    lip = (rr > 0.58) & (rr < 0.72)
    col[lip] *= 0.72
    col = np.clip(col, 0, 1)
    layer = np.zeros((h, w, 4))
    layer[mask, :3] = col[mask]
    layer[mask, 3] = np.clip((1.0 - np.sqrt(rr[mask])) * max(rx, ry) + 0.5, 0, 1)
    # keep cavity opaque in the well
    layer[mask, 3] = np.maximum(layer[mask, 3], 0.92)
    return layer


def strut(dst, x0, y0, x1, y1, width, mat, rng):
    h, w = dst.shape[:2]
    ys, xs = np.ogrid[:h, :w]
    # distance to segment
    vx, vy = x1 - x0, y1 - y0
    L2 = vx * vx + vy * vy + 1e-8
    t = np.clip(((xs - x0) * vx + (ys - y0) * vy) / L2, 0, 1)
    px, py = x0 + t * vx, y0 + t * vy
    d = np.sqrt((xs - px) ** 2 + (ys - py) ** 2)
    mask = d <= width
    u = (d / max(width, 1e-6))  # 0 center, 1 edge
    z = np.sqrt(np.clip(1.0 - u * u, 0, 1))
    ndotl = z * LZ - ((xs - px) / max(width, 1)) * LX
    nspec = np.clip(z, 0, 1) ** mat["spec_pow"]
    col = _mat_color(mat, ndotl, nspec, rng)
    layer = np.zeros_like(dst)
    layer[mask, :3] = col[mask]
    layer[mask, 3] = 1.0
    return over(dst, layer)


def to_img(arr):
    a = np.clip(arr, 0, 1)
    u8 = (a * 255).astype(np.uint8)
    return Image.fromarray(u8, "RGBA")


def trim_pad(img, pad=8):
    a = np.array(img)
    if a[..., 3].max() == 0:
        return img
    ys, xs = np.where(a[..., 3] > 8)
    x0, x1 = max(0, xs.min() - pad), min(a.shape[1], xs.max() + 1 + pad)
    y0, y1 = max(0, ys.min() - pad), min(a.shape[0], ys.max() + 1 + pad)
    return img.crop((x0, y0, x1, y1))


# ---------------------------------------------------------------------------
# Parts — original silhouettes, official-adjacent material language
# ---------------------------------------------------------------------------

def part_cmd_pod():
    """White rounded capsule + dark window band + short collar. Original shape."""
    rng = np.random.default_rng(11)
    w, h, cx = 220, 280, 110
    dst = canvas(w, h)
    # collar / docking ring at bottom
    dst = over(dst, cylinder_field(h, w, cx, 210, 248, 58, PAL["silver"], rng,
                                   hoop_ys=[218, 240], hoop_w=4, hoop_mat=PAL["steel"]))
    # short cylindrical body
    dst = over(dst, cylinder_field(h, w, cx, 132, 214, 64, PAL["white"], rng,
                                   hoop_ys=[138, 208], hoop_w=4, hoop_mat=PAL["white_soft"]))
    # dome
    dst = over(dst, ogive_field(h, w, cx, 36, 150, 64, PAL["white"], rng, tip_r=0.22))
    # dark window band wrapping mid-body
    dst = over(dst, cylinder_field(h, w, cx, 150, 186, 65.5, PAL["glass"], rng))
    # soft elongated glass glint on the left of the band (not a porthole sticker)
    h0, w0 = dst.shape[:2]
    ys = np.broadcast_to(np.arange(h0)[:, None], (h0, w0))
    xs = np.broadcast_to(np.arange(w0)[None, :], (h0, w0))
    gx = (xs - (cx - 18)) / 22.0
    gy = (ys - 168) / 9.0
    gmask = gx * gx + gy * gy <= 1.0
    glint = np.zeros_like(dst)
    glint[gmask, 0] = 0.78
    glint[gmask, 1] = 0.86
    glint[gmask, 2] = 0.95
    glint[gmask, 3] = np.clip(0.55 * (1.0 - (gx[gmask] * gx[gmask] + gy[gmask] * gy[gmask])), 0, 0.7)
    dst = over(dst, glint)
    # tiny antenna
    dst = strut(dst, cx, 40, cx, 22, 2.2, PAL["steel"], rng)
    dst = shade_disk(dst, cx, 20, 4.5, PAL["silver"], rng)
    return trim_pad(to_img(dst), 6)


def part_tank(kind="short"):
    rng = np.random.default_rng(21 if kind == "short" else 22)
    w, cx = 200, 100
    if kind == "short":
        h, y0, y1, rad = 220, 28, 192, 64
        hoops = [40, 110, 180]
    else:
        h, y0, y1, rad = 420, 24, 396, 64
        hoops = [40, 128, 216, 304, 380]
    dst = canvas(w, h)
    dst = over(dst, cylinder_field(h, w, cx, y0, y1, rad, PAL["white"], rng,
                                   hoop_ys=hoops, hoop_w=7, hoop_mat=PAL["steel"], hoop_inset=0.2))
    # end rims
    dst = over(dst, _hoop_band(h, w, cx, y0 + 2, rad, 5, PAL["steel"], rng, inset=0.2))
    dst = over(dst, _hoop_band(h, w, cx, y1 - 2, rad, 5, PAL["steel"], rng, inset=0.2))
    return trim_pad(to_img(dst), 6)


def part_engine_liquid():
    """Single original engine: silver gimbal + dark ring-ridged bell + pipes."""
    rng = np.random.default_rng(31)
    w, h, cx = 220, 260, 110
    dst = canvas(w, h)
    # white mount stub (connects to tank)
    dst = over(dst, cylinder_field(h, w, cx, 16, 52, 40, PAL["white_soft"], rng,
                                   hoop_ys=[24, 46], hoop_w=4, hoop_mat=PAL["silver"]))
    # compact silver turbopump / gimbal housing — ends cleanly above the bell
    dst = over(dst, cylinder_field(h, w, cx, 48, 102, 26, PAL["silver"], rng,
                                   hoop_ys=[62, 88], hoop_w=4))
    dst = over(dst, _hoop_band(h, w, cx, 100, 26, 5, PAL["steel"], rng, inset=0))
    # actuator arms stop at the throat ring
    dst = strut(dst, cx - 26, 68, cx - 32, 108, 3.0, PAL["steel"], rng)
    dst = strut(dst, cx + 26, 68, cx + 32, 108, 3.0, PAL["steel"], rng)
    # feed pipe on the right
    dst = strut(dst, cx + 24, 74, cx + 44, 118, 3.6, PAL["steel"], rng)
    dst = shade_disk(dst, cx + 44, 120, 5.5, PAL["steel"], rng)
    # dark ridged bell — no overlapping cap, opening only at the exit
    dst = over(dst, bell_field(h, w, cx, 106, 232, 14, 52, PAL["bell"], rng, ridges=12))
    dst = over(dst, _hoop_band(h, w, cx, 230, 52, 5, PAL["charcoal"], rng, inset=-0.4))
    return trim_pad(to_img(dst), 4)


def part_engine_plume(engine_img: Image.Image):
    """Soft original plume under the liquid engine, not copied from official exhaust."""
    rng = np.random.default_rng(32)
    ew, eh = engine_img.size
    extra = 220
    canvas_img = Image.new("RGBA", (ew, eh + extra), (0, 0, 0, 0))
    canvas_img.paste(engine_img, (0, 0), engine_img)
    arr = canvas(ew, eh + extra)
    # find engine bottom roughly
    a = np.array(engine_img)
    ys, xs = np.where(a[..., 3] > 40)
    cx = (xs.min() + xs.max()) / 2
    y0 = ys.max() - 4
    # tapered flame
    h, w = arr.shape[:2]
    ys, xs = np.ogrid[:h, :w]
    t = (ys - y0) / extra
    half = 34 + 8 * np.clip(t, 0, 1) * (1 - 0.35 * np.clip(t, 0, 1))
    mask = (ys >= y0) & (np.abs(xs - cx) < half) & (t <= 0.92)
    nx = (xs - cx) / np.maximum(half, 1)
    core = np.exp(-(nx ** 2) / 0.14) * np.exp(-((t - 0.08).clip(-1, 1) ** 2) / 0.42)
    env = np.exp(-(nx ** 2) / 0.42) * np.clip(1.0 - t * 0.95, 0, 1)
    col = np.zeros((h, w, 4))
    # white-hot core, opaque orange envelope so it holds against a blue sky
    col[..., 0] = np.clip(1.00 * env + 0.05 * core, 0, 1)
    col[..., 1] = np.clip(0.48 * env + 0.55 * core, 0, 1)
    col[..., 2] = np.clip(0.08 * env + 0.35 * core, 0, 1)
    col[..., 3] = np.clip(env * 0.98 + core * 0.20, 0, 1)
    col[~mask] = 0
    flame = to_img(col).filter(ImageFilter.GaussianBlur(1.6))
    out = Image.alpha_composite(canvas_img, flame)
    return trim_pad(out, 4)


def part_booster_solid():
    """White slim side booster, original proportions, official-adjacent paint."""
    rng = np.random.default_rng(41)
    w, h, cx = 160, 520, 80
    dst = canvas(w, h)
    # pointed nose
    ys = np.arange(h)[:, None]
    # nose 24..110, body 110..430, nozzle 430..500
    t = np.clip((ys - 24) / 86, 0, 1)
    r_nose = 6 + 36 * (t ** 0.85)
    r_nose = np.broadcast_to(r_nose, (h, w))
    dst = over(dst, cylinder_field(h, w, cx, 24, 110, r_nose, PAL["white"], rng))
    dst = over(dst, cylinder_field(h, w, cx, 104, 430, 38, PAL["white"], rng,
                                   hoop_ys=[118, 210, 302, 416], hoop_w=5,
                                   hoop_mat=PAL["silver"], hoop_inset=0.3))
    # attach trunnions (left side faces the core)
    dst = strut(dst, cx - 38, 200, cx - 58, 200, 5, PAL["steel"], rng)
    dst = strut(dst, cx - 38, 340, cx - 58, 340, 5, PAL["steel"], rng)
    dst = shade_disk(dst, cx - 58, 200, 7, PAL["steel"], rng)
    dst = shade_disk(dst, cx - 58, 340, 7, PAL["steel"], rng)
    # small dark nozzle
    dst = over(dst, bell_field(h, w, cx, 428, 498, 10, 30, PAL["bell"], rng, ridges=7))
    return trim_pad(to_img(dst), 6)


def part_decoupler():
    """Short structural ring with a visible separation groove. Original."""
    rng = np.random.default_rng(51)
    w, h, cx = 200, 90, 100
    dst = canvas(w, h)
    dst = over(dst, cylinder_field(h, w, cx, 16, 74, 64, PAL["white_soft"], rng,
                                   hoop_ys=[24, 66], hoop_w=5, hoop_mat=PAL["silver"]))
    # gold/bronze separation band
    dst = over(dst, cylinder_field(h, w, cx, 38, 52, 65.5, PAL["gold_ring"], rng))
    # groove shadow
    dst = over(dst, _hoop_band(h, w, cx, 45, 65.5, 3, PAL["charcoal"], rng, inset=1.2))
    return trim_pad(to_img(dst), 4)


def part_adapter():
    """Fluted white interstage / adapter — vertical stringers, official language, original counts."""
    rng = np.random.default_rng(61)
    w, h, cx = 200, 180, 100
    dst = canvas(w, h)
    # slight taper 62 -> 64 so it meets tanks
    ys = np.arange(h)[:, None]
    t = np.clip((ys - 16) / 148, 0, 1)
    r = 62 + 2 * t
    r = np.broadcast_to(r, (h, w))
    # unfluted end rings
    dst = over(dst, cylinder_field(h, w, cx, 16, 34, 62, PAL["white"], rng,
                                   hoop_ys=[24], hoop_w=5, hoop_mat=PAL["silver"]))
    dst = over(dst, cylinder_field(h, w, cx, 16 + 18, 16 + 130, r, PAL["white"], rng,
                                   flute_n=26, flute_amp=1.05))
    dst = over(dst, cylinder_field(h, w, cx, 146, 164, 64, PAL["white"], rng,
                                   hoop_ys=[156], hoop_w=5, hoop_mat=PAL["silver"]))
    return trim_pad(to_img(dst), 6)


def part_parachute(state="stow"):
    rng = np.random.default_rng(71)
    if state == "stow":
        w, h, cx = 140, 160, 70
        dst = canvas(w, h)
        # white canister + dark pack cap
        dst = over(dst, cylinder_field(h, w, cx, 48, 130, 28, PAL["white_soft"], rng,
                                       hoop_ys=[58, 120], hoop_w=4, hoop_mat=PAL["silver"]))
        dst = over(dst, ogive_field(h, w, cx, 16, 60, 28, PAL["white"], rng, tip_r=0.3))
        # small red identifier band (original, not official logo)
        dst = over(dst, cylinder_field(h, w, cx, 86, 98, 29, {
            "base": _norm((190, 70, 62)),
            "shadow": _norm((110, 36, 32)),
            "spec": _norm((255, 200, 190)),
            "spec_pow": 40.0, "spec_amt": 0.45, "ambient": 0.35, "grain": 0.01,
        }, rng))
        return trim_pad(to_img(dst), 4)

    # mid / open: red-white striped canopy (official language, original gore count/layout)
    w, h = (320, 280) if state == "mid" else (420, 460)
    cx = w / 2
    dst = canvas(w, h)
    if state == "mid":
        canopy_cy, rx, ry = 90, 118, 70
        cap_y1 = 118
        pod_y = 230
    else:
        canopy_cy, rx, ry = 110, 168, 78
        cap_y1 = 175
        pod_y = 390

    # canopy ellipse with gores
    ys, xs = np.ogrid[:h, :w]
    dx = (xs - cx) / rx
    dy = (ys - canopy_cy) / ry
    rr = dx * dx + dy * dy
    # only upper + slight lower hemisphere of the chute
    mask = (rr <= 1.0) & (ys <= canopy_cy + ry * 0.55)
    phi = np.arctan2(xs - cx, -(ys - canopy_cy + 0.001))
    gores = 8
    stripe = (np.floor((phi + math.pi) / (2 * math.pi) * gores) % 2)
    red = np.array(_norm((204, 64, 54)))
    white = np.array(_norm((242, 236, 228)))
    col = np.where(stripe[..., None] == 0, red, white)
    # dome lighting: brighter upper-left, softer falloff, more volume
    z = np.sqrt(np.clip(1.0 - rr, 0, 1))
    ndotl = 0.28 + 0.85 * np.clip(-dx * 0.55 + z * 0.85 - dy * 0.2, 0, 1)
    # tight specular on the upper-left gore
    spec = np.clip(-dx * 0.4 + z * 0.9 - dy * 0.35, 0, 1) ** 8
    col = col * ndotl[..., None] + spec[..., None] * 0.35
    # soft gore seams, not hard pie cuts
    frac = ((phi + math.pi) / (2 * math.pi) * gores) % 1.0
    seam = np.abs(frac - 0.0) < 0.035
    col[seam] *= 0.82
    layer = np.zeros((h, w, 4))
    layer[mask, :3] = np.clip(col[mask], 0, 1)
    layer[mask, 3] = 1.0
    dst = over(dst, layer)
    # underside rim
    dst = over(dst, _hoop_band(h, w, cx, canopy_cy + ry * 0.15 if state == "mid" else canopy_cy + ry * 0.22,
                               rx * 0.98, 4, PAL["white_soft"], rng, inset=0))

    # shroud lines to a small capsule
    img = to_img(dst)
    draw = ImageDraw.Draw(img)
    nlines = 8
    for i in range(nlines):
        ang = -math.pi + (i + 0.5) * (2 * math.pi / nlines)
        x0 = cx + math.cos(ang) * rx * 0.82
        y0 = canopy_cy + math.sin(ang) * ry * 0.15 + (18 if state == "open" else 10)
        # only front/side lines
        if math.sin(ang) > 0.55:
            continue
        draw.line([(x0, y0), (cx, pod_y - 18)], fill=(210, 214, 220, 200), width=1)
    # tiny dark lander/capsule
    arr = np.array(img).astype(np.float64) / 255.0
    arr = over(arr, cone_field(h, w, cx, pod_y - 36, pod_y + 8, 14, 8, PAL["charcoal"], rng, cap=True))
    arr = over(arr, cylinder_field(h, w, cx, pod_y - 52, pod_y - 32, 14, PAL["white"], rng))
    return trim_pad(to_img(arr), 6)


def opaque_bbox(img):
    a = np.array(img)
    ys, xs = np.where(a[..., 3] > 12)
    if len(xs) == 0:
        return 0, 0, img.size[0], img.size[1]
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def stack_vertical(parts_and_overlap, overlap=3):
    """Stack by opaque bounding boxes so trim padding does not open gaps."""
    infos = []
    for item in parts_and_overlap:
        im = item[0] if isinstance(item, (tuple, list)) else item
        x0, y0, x1, y1 = opaque_bbox(im)
        infos.append((im, x0, y0, x1, y1, x1 - x0, y1 - y0))
    max_w = max(w for *_, w, h in infos) + 80
    total_h = sum(h for *_, w, h in infos) - overlap * (len(infos) - 1) + 40
    canvas_img = Image.new("RGBA", (max_w, total_h + 20), (0, 0, 0, 0))
    cx = max_w // 2
    y_cursor = 10
    for im, x0, y0, x1, y1, bw, bh in infos:
        # paste so the opaque box is centered and starts at y_cursor
        px = cx - bw // 2 - x0
        py = y_cursor - y0
        tmp = Image.new("RGBA", canvas_img.size, (0, 0, 0, 0))
        tmp.paste(im, (px, py), im)
        canvas_img = Image.alpha_composite(canvas_img, tmp)
        y_cursor += bh - overlap
    return trim_pad(canvas_img, 8)


def assemble_build(parts):
    """Build-canvas sample rocket: chute, pod, adapter, short, decoupler, long, engine. + 2 boosters."""
    chute = parts["parachute-stow"]
    pod = parts["cmd-pod"]
    adapter = parts["adapter"]
    short = parts["tank-short"]
    dec = parts["decoupler"]
    longt = parts["tank-long"]
    eng = parts["engine-liquid"]
    core = stack_vertical([chute, pod, adapter, short, dec, longt, eng])
    booster = parts["booster-solid"]
    # place two boosters beside the long tank region
    cw, ch = core.size
    extra_w = booster.size[0] * 2 - 20
    out = Image.new("RGBA", (cw + extra_w, ch + 10), (0, 0, 0, 0))
    out.paste(core, (extra_w // 2, 0), core)
    # boosters sit against mid-lower tank, bottoms near engine gimbal
    # estimate: long tank + engine occupy the lower ~ (long+eng+dec) of the stack
    by = ch - booster.size[1] - 70
    if by < 40:
        by = 80
    left = booster.transpose(Image.FLIP_LEFT_RIGHT)  # trunnions originally on the left
    right = booster  # trunnions face the core
    # tuck slightly under the tank edge
    lx = extra_w // 2 - left.size[0] + 22
    rx = extra_w // 2 + cw - 22
    tmp = Image.new("RGBA", out.size, (0, 0, 0, 0))
    tmp.paste(left, (lx, by), left)
    out = Image.alpha_composite(out, tmp)
    tmp = Image.new("RGBA", out.size, (0, 0, 0, 0))
    tmp.paste(right, (rx, by), right)
    out = Image.alpha_composite(out, tmp)
    return trim_pad(out, 8)


def assemble_flight(parts):
    """In-flight: core only (boosters already staged), liquid engine with plume."""
    pod = parts["cmd-pod"]
    adapter = parts["adapter"]
    short = parts["tank-short"]
    dec = parts["decoupler"]
    longt = parts["tank-long"]
    eng = parts["engine-liquid-plume"]
    return stack_vertical([pod, adapter, short, dec, longt, eng])


def assemble_home(parts):
    return assemble_build(parts)


def sheet(parts):
    items = [
        ("指令舱", "cmd-pod"),
        ("短储箱", "tank-short"),
        ("长储箱", "tank-long"),
        ("液体发动机", "engine-liquid"),
        ("固体助推", "booster-solid"),
        ("分离器", "decoupler"),
        ("结构转接件", "adapter"),
        ("降落伞·收起", "parachute-stow"),
        ("降落伞·展开", "parachute-mid"),
        ("降落伞·打开", "parachute-open"),
    ]
    cols, pad, cell_w, cell_h = 5, 24, 280, 420
    rows = math.ceil(len(items) / cols)
    W, H = cols * cell_w + pad * 2, rows * cell_h + pad * 2 + 20
    img = Image.new("RGBA", (W, H), (42, 78, 122, 255))
    # grid-ish backdrop
    draw = ImageDraw.Draw(img)
    for x in range(0, W, 24):
        draw.line([(x, 0), (x, H)], fill=(62, 102, 148, 255), width=1)
    for y in range(0, H, 24):
        draw.line([(0, y), (W, y)], fill=(62, 102, 148, 255), width=1)
    try:
        font = ImageFont.truetype("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc", 18)
    except Exception:
        try:
            font = ImageFont.truetype("/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc", 18)
        except Exception:
            font = ImageFont.load_default()
    for i, (label, key) in enumerate(items):
        r, c = divmod(i, cols)
        x0 = pad + c * cell_w
        y0 = pad + r * cell_h
        spr = parts[key].copy()
        # fit
        max_h, max_w = cell_h - 60, cell_w - 20
        sc = min(max_w / spr.size[0], max_h / spr.size[1], 1.0)
        if sc < 1:
            spr = spr.resize((max(1, int(spr.size[0] * sc)), max(1, int(spr.size[1] * sc))), Image.Resampling.LANCZOS)
        px = x0 + (cell_w - spr.size[0]) // 2
        py = y0 + 12
        img.alpha_composite(spr, (px, py))
        tw = draw.textlength(label, font=font)
        draw.text((x0 + (cell_w - tw) / 2, y0 + cell_h - 36), label, fill=(235, 240, 246, 255), font=font)
    return img


def main():
    parts = {}
    print("render cmd-pod")
    parts["cmd-pod"] = part_cmd_pod()
    print("render tanks")
    parts["tank-short"] = part_tank("short")
    parts["tank-long"] = part_tank("long")
    print("render engine")
    parts["engine-liquid"] = part_engine_liquid()
    parts["engine-liquid-plume"] = part_engine_plume(parts["engine-liquid"])
    print("render booster")
    parts["booster-solid"] = part_booster_solid()
    print("render decoupler/adapter/chute")
    parts["decoupler"] = part_decoupler()
    parts["adapter"] = part_adapter()
    parts["parachute-stow"] = part_parachute("stow")
    parts["parachute-mid"] = part_parachute("mid")
    parts["parachute-open"] = part_parachute("open")
    print("assemble")
    parts["rocket-build"] = assemble_build(parts)
    parts["rocket-home"] = assemble_home(parts)
    parts["rocket-flight"] = assemble_flight(parts)
    parts["00-parts-sheet"] = sheet(parts)
    for k, im in parts.items():
        path = OUT / f"{k}.png"
        im.save(path)
        print(f"  wrote {path.name} {im.size}")
    print("done")


if __name__ == "__main__":
    main()
