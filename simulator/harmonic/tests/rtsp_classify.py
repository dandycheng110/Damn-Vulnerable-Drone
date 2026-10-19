# Read the companion RTSP stream for N seconds and classify each frame as
# "legit" (grey/sky scene) or "rogue" (red-bar injection), by mean channel.
import sys, time, cv2, numpy as np
url, secs = sys.argv[1], float(sys.argv[2])
cap = cv2.VideoCapture(url, cv2.CAP_FFMPEG)
if not cap.isOpened():
    sys.exit(f"cannot open {url}")
legit = rogue = 0
t0 = time.time()
while time.time() - t0 < secs:
    ok, f = cap.read()
    if not ok:
        continue
    b, g, r = f[..., 0].mean(), f[..., 1].mean(), f[..., 2].mean()
    # rogue frames are strongly red-dominant; legit scene is grey/blue-ish
    if r > 90 and r > 2 * g and r > 2 * b:
        rogue += 1
    else:
        legit += 1
print(f"legit={legit} rogue={rogue} total={legit+rogue}")
