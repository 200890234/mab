from PIL import Image, ImageDraw, ImageFont
import struct, os, io

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'assets', 'icon.ico')

def make_icon(size):
    """Render a crisp MAB-style icon at the given size."""
    s = size
    img = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # rounded-square background with vertical gradient (blue->purple)
    pad = max(1, s // 64)
    r = s // 6
    def lerp(a, b, t):
        return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))
    top = (56, 78, 220)
    bot = (130, 60, 200)
    for y in range(s):
        t = y / (s - 1)
        col = lerp(top, bot, t) + (255,)
        d.line([(0, y), (s - 1, y)], fill=col)
    # round corners (cut alpha)
    mask = Image.new('L', (s, s), 0)
    md = ImageDraw.Draw(mask)
    md.rounded_rectangle([pad, pad, s - 1 - pad, s - 1 - pad], radius=r, fill=255)
    img.putalpha(mask)

    cx, cy = s // 2, s // 2
    # shield
    sw = s * 0.46
    sh = s * 0.54
    x0, y0 = cx - sw / 2, cy - sh / 2 - s * 0.02
    x1, y1 = cx + sw / 2, cy + sh / 2 - s * 0.02
    shield = [
        (x0, y0),
        (x1, y0),
        (x1, y0 + sh * 0.42),
        (cx, y1),
        (x0, y0 + sh * 0.42),
    ]
    d.polygon(shield, fill=(255, 255, 255, 235))

    # "MAB" letters
    fs = int(s * 0.30)
    try:
        fnt = ImageFont.truetype('arial.ttf', fs)
    except Exception:
        fnt = ImageFont.load_default()
    txt = 'MAB'
    tb = d.textbbox((0, 0), txt, font=fnt)
    tw, th = tb[2] - tb[0], tb[3] - tb[1]
    tx = cx - tw / 2 - tb[0]
    ty = cy - th / 2 - tb[1] - s * 0.01
    d.text((tx, ty), txt, font=fnt, fill=(40, 30, 120, 255))

    # gradient accent line under letters
    line_y = y0 + sh * 0.78
    lw = sw * 0.6
    lx0 = cx - lw / 2
    lx1 = cx + lw / 2
    steps = max(2, int(lw))
    for i in range(steps):
        t = i / (steps - 1)
        col = lerp((90, 130, 255), (200, 90, 230), t) + (255,)
        x = lx0 + (lx1 - lx0) * t
        d.line([(x, line_y), (x, line_y + max(1, s // 64))], fill=col)

    # subtle inner highlight
    d.rounded_rectangle([pad + s*0.04, pad + s*0.04, s - 1 - pad - s*0.04, s - 1 - pad - s*0.04],
                        radius=r * 0.8, outline=(255, 255, 255, 60), width=max(1, s // 128))
    return img

sizes = [16, 32, 48, 64, 128, 256]
frames = []
for sz in sizes:
    im = make_icon(sz)
    buf = io.BytesIO()
    im.save(buf, format='PNG')
    frames.append((sz, buf.getvalue()))

# build ICO container
header = struct.pack('<HHH', 0, 1, len(frames))
entries = b''
data_blob = b''
for sz, png in frames:
    w = sz % 256
    h = sz % 256
    entry = struct.pack('<BBBBHHII', w, h, 0, 0, 32, 1, len(png), 0)
    entries += entry
    data_blob += png

# patch offsets into entries
offset = 6 + 16 * len(frames)
entries2 = b''
for sz, png in frames:
    w = sz % 256
    h = sz % 256
    entries2 += struct.pack('<BBBBHHII', w, h, 0, 0, 32, 1, len(png), offset)
    offset += len(png)

with open(OUT, 'wb') as f:
    f.write(header + entries2 + data_blob)

print('written', OUT, os.path.getsize(OUT), 'bytes,', len(frames), 'frames', sizes)
