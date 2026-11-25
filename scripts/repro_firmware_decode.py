import re
import struct
import wave
import zlib
from collections import Counter
from pathlib import Path

SRC = Path('src/avrAudioBootloader.ts').read_text()
WAV_PATH = Path('src/assets/grids_1.0.wav')

sample_rate = int(re.search(r'sampleRate:\s*(\d+)', SRC).group(1))
pause_period = int(re.search(r'pausePeriod:\s*(\d+)', SRC).group(1))
one_period = int(re.search(r'onePeriod:\s*(\d+)', SRC).group(1))
zero_period = int(re.search(r'zeroPeriod:\s*(\d+)', SRC).group(1))
packet_size = int(re.search(r'packetSize:\s*(\d+)', SRC).group(1))
preamble_run_threshold = int(re.search(r'STOCK_WAV_PREAMBLE_RUNS\s*=\s*(\d+)', SRC).group(1))
separator_run_length = max(16, pause_period // 2)

with wave.open(str(WAV_PATH), 'rb') as w:
    assert w.getframerate() == sample_rate
    assert w.getnchannels() == 1
    assert w.getsampwidth() == 2
    frames = w.readframes(w.getnframes())
    samples = struct.unpack('<' + 'h' * (len(frames) // 2), frames)

threshold = 2048
start = 0
while start < len(samples) and abs(samples[start]) < threshold:
    start += 1
print('first_non_silent', start)

symbols = []
sign = 1 if samples[start] >= 0 else -1
run_length = 0
for sample in samples[start:]:
    if abs(sample) < threshold:
        continue
    current_sign = 1 if sample >= 0 else -1
    if current_sign == sign:
        run_length += 1
        continue
    if run_length > 0:
        durations = [(0, zero_period / 2), (1, one_period / 2), (2, pause_period / 2)]
        best = min(durations, key=lambda item: abs(run_length - item[1]))[0]
        symbols.append(best)
    sign = current_sign
    run_length = 1
if run_length > 0:
    durations = [(0, zero_period / 2), (1, one_period / 2), (2, pause_period / 2)]
    best = min(durations, key=lambda item: abs(run_length - item[1]))[0]
    symbols.append(best)

print('symbol_count', len(symbols))
print('symbol_histogram', Counter(symbols))

preamble_runs = 0
while preamble_runs < len(symbols) and symbols[preamble_runs] == 1:
    preamble_runs += 1
print('preamble_runs', preamble_runs)
if preamble_runs >= preamble_run_threshold:
    symbols = symbols[preamble_runs:]

expected_packet_bytes = 4 + packet_size + 4
packets = []
bit_symbols = []
segments = 0
segments_with_enough_bits = 0
crc_hits = 0
pause_run_length = 0

for symbol in symbols + [2]:
    if symbol == 2:
        pause_run_length += 1
        continue

    if pause_run_length >= separator_run_length:
        segments += 1
        if len(bit_symbols) >= expected_packet_bytes * 8:
            segments_with_enough_bits += 1
            usable = (len(bit_symbols) // 8) * 8
            byte_count = usable // 8
            bytes_ = bytearray(byte_count)
            for i in range(byte_count):
                value = 0
                for bit in range(8):
                    value = (value << 1) | (1 if bit_symbols[i * 8 + bit] else 0)
                bytes_[i] = value
            max_start = byte_count - expected_packet_bytes
            for idx in range(max_start + 1):
                if bytes_[idx : idx + 4] != b'UUUU':
                    continue
                data_start = idx + 4
                data_end = data_start + packet_size
                data = bytes_[data_start:data_end]
                expected_crc = int.from_bytes(bytes_[data_end : data_end + 4], 'big')
                actual_crc = zlib.crc32(data) & 0xFFFFFFFF
                if expected_crc == actual_crc:
                    crc_hits += 1
                    packets.append(bytes(data))
                    break
        bit_symbols = []
    pause_run_length = 0
    bit_symbols.append(symbol)

print('segments', segments)
print('segments_with_enough_bits', segments_with_enough_bits)
print('valid_packets', len(packets))
print('crc_hits', crc_hits)
if packets:
    print('first_packet_prefix', packets[0][:16].hex())
