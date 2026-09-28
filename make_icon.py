# -*- coding: utf-8 -*-
"""临时：手搓一个可爱简约的企鹅图标（无 PIL，纯 Python 画 + 编码 PNG/ICO）。"""
import io
import math
import os
import struct
import zlib

R = os.path.dirname(os.path.abspath(__file__))   # 脚本在哪个目录，就往哪写
MASTER = 256
SS = 3                      # 超采样倍数
N = MASTER * SS

# ---- 配色（跟着启动器的浅蓝走）----
TILE_TOP = (0xC9, 0xE4, 0xFA)
TILE_BOT = (0x74, 0xB6, 0xE8)
NAVY     = (0x1B, 0x3A, 0x5C)
FACE     = (0xFA, 0xFC, 0xFF)
EYE      = (0x14, 0x30, 0x4F)
BEAK     = (0xF2, 0xA0, 0x3D)
BLUSH    = (0xF0, 0xA0, 0xAE)


def mix(a, b, t):
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t)


def render():
    """在 N×N 上按覆盖画，画完逻辑上是抗锯齿过的（超采样）"""
    px = bytearray(N * N * 4)
    inv = 1.0 / N
    # 形状参数（按 0..1 的归一化坐标）
    K, OY = 1.12, -0.012                    # 整体放大并微微上移
    hx, hy, hr = 0.50, 0.50 * K + OY, 0.300 * K
    fx, fy, fr = 0.50, 0.545 * K + OY, 0.235 * K
    eyes = [(0.410, 0.500 * K + OY), (0.590, 0.500 * K + OY)]
    er = 0.043 * K
    beak = [(0.445, 0.590 * K + OY), (0.555, 0.590 * K + OY), (0.500, 0.660 * K + OY)]
    blushes = [(0.318, 0.600 * K + OY), (0.682, 0.600 * K + OY)]
    br = 0.048 * K

    for y in range(N):
        v = (y + 0.5) * inv
        row = y * N * 4
        for x in range(N):
            u = (x + 0.5) * inv
            # 1) 圆角方块底：外圈按圆角距离，做成全出血
            rr = 0.23
            dx = max(rr - u, u - (1 - rr), 0.0)
            dy = max(rr - v, v - (1 - rr), 0.0)
            outside = math.hypot(dx, dy)
            if outside > rr:
                continue                                   # 角上留透明
            col = mix(TILE_TOP, TILE_BOT, min(1.0, max(0.0, (v - 0.08) / 0.90)))

            # 2) 头（深蓝）
            if math.hypot(u - hx, v - hy) <= hr:
                col = NAVY
                # 3) 白脸
                if math.hypot(u - fx, v - fy) <= fr:
                    col = FACE
                    # 4) 腮红（半透明扑上去）
                    for bx, by in blushes:
                        d = math.hypot(u - bx, v - by)
                        if d <= br:
                            col = mix(col, BLUSH, 0.55 * (1 - (d / br) ** 2))
                    # 5) 嘴：三角形 + 圆角
                    inside = True
                    for i in range(3):
                        ax, ay = beak[i]
                        bx2, by2 = beak[(i + 1) % 3]
                        cross = (bx2 - ax) * (v - ay) - (by2 - ay) * (u - ax)
                        if cross < 0:
                            inside = False
                            break
                    if inside or math.hypot(u - beak[2][0], v - beak[2][1]) <= 0.024:
                        col = BEAK
                    # 6) 眼睛 + 高光
                    for ex, ey in eyes:
                        if math.hypot(u - ex, v - ey) <= er:
                            col = EYE
                        elif math.hypot(u - (ex - 0.014), v - (ey - 0.014)) <= 0.014:
                            col = FACE
            o = row + x * 4
            px[o] = int(col[0] + 0.5)
            px[o + 1] = int(col[1] + 0.5)
            px[o + 2] = int(col[2] + 0.5)
            px[o + 3] = 255
    return px


def downsample(px, src, dst):
    """box 滤波缩图，一步到位"""
    out = bytearray(dst * dst * 4)
    f = src // dst
    area = f * f
    for y in range(dst):
        for x in range(dst):
            r = g = b = a = 0
            for yy in range(y * f, y * f + f):
                base = yy * src * 4
                for xx in range(x * f, x * f + f):
                    o = base + xx * 4
                    r += px[o]; g += px[o + 1]; b += px[o + 2]; a += px[o + 3]
            o = (y * dst + x) * 4
            out[o] = r // area; out[o + 1] = g // area
            out[o + 2] = b // area; out[o + 3] = a // area
    return out


def png(w, h, rgba):
    raw = bytearray()
    stride = w * 4
    for y in range(h):
        raw.append(0)
        raw += rgba[y * stride:(y + 1) * stride]

    def chunk(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    return (b'\x89PNG\r\n\x1a\n'
            + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(bytes(raw), 9))
            + chunk(b'IEND', b''))


def ico(images):
    hdr = struct.pack('<HHH', 0, 1, len(images))
    ent, data, off = b'', b'', 6 + 16 * len(images)
    for size, blob in images:
        b = 0 if size >= 256 else size
        ent += struct.pack('<BBBBHHII', b, b, 0, 0, 1, 32, len(blob), off)
        off += len(blob)
        data += blob
    return hdr + ent + data


print('画 %dx%d（%d 倍超采样），耐心几秒…' % (N, N, SS))
master = render()
os.makedirs(os.path.join(R, 'assets'), exist_ok=True)

sizes = [256, 128, 64, 48, 32, 16]
blobs = []
for s in sizes:
    blobs.append((s, png(s, s, downsample(master, N, s))))
    print('  %dx%d 好了' % (s, s))

io.open(os.path.join(R, 'assets', 'icon.ico'), 'wb').write(ico(blobs))
io.open(os.path.join(R, 'assets', 'icon.png'), 'wb').write(dict(blobs)[256])
io.open(os.path.join(R, '_icon_preview.png'), 'wb').write(dict(blobs)[256])
print('assets/icon.ico  %d bytes' % os.path.getsize(os.path.join(R, 'assets', 'icon.ico')))
print('assets/icon.png  %d bytes' % os.path.getsize(os.path.join(R, 'assets', 'icon.png')))


# ---- 对比图：一列小尺寸，看小图糊不糊 ----
def sheet():
    W, H = 372, 300
    bg = (0xF2, 0xF6, 0xFA, 255)
    buf = bytearray()
    for _ in range(W * H):
        buf += bytes(bg)
    def blit(src_size, src_px, dx, dy):
        for y in range(src_size):
            for x in range(src_size):
                o = (y * src_size + x) * 4
                d = ((dy + y) * W + dx + x) * 4
                buf[d:d + 4] = src_px[o:o + 4]
    big = downsample(master, N, 256)
    blit(256, big, 18, 22)
    x0, y0 = 300, 22
    for sz in (64, 48, 32, 16):
        blit(sz, downsample(master, N, sz), x0 + (64 - sz) // 2, y0)
        y0 += 64 + 10
    return W, H, bytes(buf)

w, h, b = sheet()
io.open(os.path.join(R, '_icon_preview.png'), 'wb').write(png(w, h, b))
print('对比图 _icon_preview.png %dx%d' % (w, h))
