"""Assemble the frames from scripts/record-demo.cjs into docs/public/demo.gif.

    python3 scripts/make-gif.py <frames-dir> [out.gif]

Each frame keeps the duration the recorder gave it (durs.json), so typing runs
at a human pace and the key moments are held. Needs Pillow (pip install pillow).
"""

import glob
import json
import os
import sys

from PIL import Image

frames_dir = sys.argv[1]
out = sys.argv[2] if len(sys.argv) > 2 else "docs/public/demo.gif"
durs = json.load(open(os.path.join(frames_dir, "durs.json")))
files = sorted(glob.glob(os.path.join(frames_dir, "f*.png")))
assert len(files) == len(durs), "frames and durations don't line up"
frames = [
    Image.open(f)
    .convert("RGB")
    .quantize(colors=128, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    for f in files
]
frames[0].save(
    out, save_all=True, append_images=frames[1:], duration=durs, loop=0, optimize=True, disposal=1
)
print(f"{out}: {len(frames)} frames, {sum(durs) / 1000:.1f}s, {os.path.getsize(out) // 1024} KB")
