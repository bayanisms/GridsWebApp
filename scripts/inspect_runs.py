import wave
import struct
import pathlib
import zlib

SAMPLE_RATE = 40000
PAUSE = 64
ONE = 16
ZERO = 8
PACKET = 256

p = pathlib.Path('src/assets/grids_1.0.wav')
with wave.open(str(p), 'rb') as w:
    w.setpos(40000)
    frames = w.readframes(5000)
    samples = struct.unpack('<' + 'h' * (len(frames)//2), frames)

# derive raw run lengths from sign flips
threshold = 2048
runs = []
sign = 1 if samples[0] >= 0 else -1
run = 0
for s in samples:
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

print('first 40 runs', runs[:40])
print('unique first 200', sorted(set(runs[:200]))[:20], '... total unique', len(set(runs[:200])))
