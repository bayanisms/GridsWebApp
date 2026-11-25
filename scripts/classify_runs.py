import wave
import struct
import pathlib
from collections import Counter

ZERO = 8
ONE = 16
PAUSE = 64
threshold = 2048
p = pathlib.Path('src/assets/grids_1.0.wav')
with wave.open(str(p), 'rb') as w:
    frames = w.readframes(w.getnframes())
    samples = struct.unpack('<'+'h'*(len(frames)//2), frames)

start = 0
while start < len(samples) and abs(samples[start]) < threshold:
    start += 1
runs=[]
sign = 1 if samples[start] >= 0 else -1
run=0
for s in samples[start:]:
    if abs(s) < threshold:
        continue
    cur = 1 if s >= 0 else -1
    if cur == sign:
        run += 1
    else:
        runs.append(run)
        sign = cur
        run = 1
if run:
    runs.append(run)

map_counts = Counter()
for r in runs:
    choices = [(abs(r - ZERO/2), 'zero/2'), (abs(r - ONE/2), 'one/2'), (abs(r - PAUSE/2), 'pause/2'), (abs(r - ZERO), 'zero'), (abs(r - ONE), 'one'), (abs(r - PAUSE), 'pause')]
    map_counts[min(choices)[1]] += 1
print('run histogram', Counter(runs))
print('nearest categories', map_counts)
