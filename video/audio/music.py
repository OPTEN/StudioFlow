"""The music bed of the StudioFlow product video, made in code (no samples, no third-party music).

120 BPM, A minor (Am F C G, one chord per bar), 28 s, cut to the storyboard in video/scenes.mjs:
  0.0  intro: pad, arpeggio, a soft kick          1.5  "Just phones.": the drums open up
  3.0  full groove under the UI scenes            24.6 stop-down: the music dips before the end card
  25.0 end card: one big Am, the groove stops, the chord rings out to 28.0

Usage (any Python with numpy, scipy and soundfile, e.g. the earshot venv):
  python video/audio/music.py video/work/audio/music.wav
"""
import sys

import numpy as np
import soundfile as sf
from scipy.signal import butter, fftconvolve, sosfilt

SR = 48000
BPM = 120
BEAT = 60 / BPM
DUR = 28.0
N = int(DUR * SR)
rng = np.random.default_rng(69)

NOTE = {'C': 0, 'C#': 1, 'D': 2, 'D#': 3, 'E': 4, 'F': 5, 'F#': 6, 'G': 7, 'G#': 8, 'A': 9, 'A#': 10, 'B': 11}


def hz(name):
    n, octave = name[:-1], int(name[-1])
    return 440.0 * 2 ** ((NOTE[n] + 12 * (octave + 1) - 69) / 12)


CHORDS = [  # one per bar (2 s): pad voicing, bass root, arpeggio tones
    (['A3', 'C4', 'E4', 'G4'], 'A1', ['A4', 'C5', 'E5', 'G5']),
    (['F3', 'A3', 'C4', 'E4'], 'F1', ['F4', 'A4', 'C5', 'E5']),
    (['C4', 'E4', 'G4', 'B4'], 'C2', ['C5', 'E5', 'G5', 'B5']),
    (['G3', 'B3', 'D4', 'F#4'], 'G1', ['G4', 'B4', 'D5', 'F#5']),
]


def chord_at(t):
    return CHORDS[int(t // (4 * BEAT)) % 4]


def lp(x, f, order=2):
    return sosfilt(butter(order, f, 'low', fs=SR, output='sos'), x)


def hp(x, f, order=2):
    return sosfilt(butter(order, f, 'high', fs=SR, output='sos'), x)


def bp(x, lo, hi):
    return sosfilt(butter(2, [lo, hi], 'band', fs=SR, output='sos'), x)


def add(dst, x, t, gain=1.0):
    i = int(round(t * SR))
    if i >= len(dst):
        return
    x = x[: len(dst) - i]
    dst[i : i + len(x)] += gain * x


def env(n, a, d, sustain=0.0, curve=6.0):
    t = np.arange(n) / SR
    att = np.clip(t / max(a, 1e-4), 0, 1)
    dec = sustain + (1 - sustain) * np.exp(-curve * np.clip(t - a, 0, None) / max(d, 1e-4))
    return att * dec


def saw(f, n, phase=0.0):
    t = np.arange(n) / SR
    return 2 * ((f * t + phase) % 1.0) - 1


# ---------- voices ----------


def kick(level=1.0):
    n = int(0.45 * SR)
    t = np.arange(n) / SR
    f = 46 + 110 * np.exp(-t * 32)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 7.5)
    click = hp(rng.standard_normal(n), 2500) * np.exp(-t * 400) * 0.25
    return level * np.tanh(1.6 * (body + click))


def clap():
    n = int(0.3 * SR)
    t = np.arange(n) / SR
    noise = bp(rng.standard_normal(n), 900, 4200)
    bursts = sum(np.exp(-np.clip(t - d, 0, None) * 60) * (t >= d) for d in (0.0, 0.011, 0.022))
    return noise * (0.6 * bursts / 3 + np.exp(-t * 18) * 0.5) * 0.55


def hat(open_=False):
    n = int((0.18 if open_ else 0.05) * SR)
    t = np.arange(n) / SR
    return hp(rng.standard_normal(n), 7000) * np.exp(-t * (18 if open_ else 90)) * 0.22


def bass_note(f, length):
    n = int(length * SR)
    x = 0.6 * saw(f, n) + 0.4 * np.sin(2 * np.pi * f * np.arange(n) / SR)
    return lp(x, 380) * env(n, 0.005, length * 0.9, 0.55, 3)


def pluck(f, length=0.32):
    n = int(length * SR)
    t = np.arange(n) / SR
    x = 0.5 * saw(f, n) + 0.5 * np.sign(np.sin(2 * np.pi * f * t)) * 0.6
    cutoff = 900 + 3500 * np.exp(-t * 18)
    # time-varying low-pass by blocks
    out = np.zeros(n)
    block = 256
    for i in range(0, n, block):
        out[i : i + block] = lp(x[i : i + block + 64], float(np.clip(cutoff[i], 200, 20000)), 1)[: min(block, n - i)]
    return out * env(n, 0.002, length, 0.0, 5)


def pad_chord(notes, length):
    n = int(length * SR)
    x = np.zeros(n)
    for name in notes:
        f = hz(name)
        for detune in (-0.12, -0.05, 0.0, 0.06, 0.13):
            x += saw(f * 2 ** (detune / 12), n, rng.random())
    x = lp(x / (len(notes) * 5), 1500, 2)
    return x * env(n, 0.35, length, 0.85, 1.2)


def reverb_ir(seconds=2.2):
    n = int(seconds * SR)
    t = np.arange(n) / SR
    ir = rng.standard_normal((n, 2)) * np.exp(-t * 3.2)[:, None]
    ir[:, 0] = lp(ir[:, 0], 6000)
    ir[:, 1] = lp(ir[:, 1], 6000)
    return ir / np.sqrt((ir ** 2).sum(0))


# ---------- arrangement ----------

END = 25.0
STOP = (24.6, END)  # the stop-down before the end card

drums = np.zeros(N)
hats_l = np.zeros(N)
hats_r = np.zeros(N)
bass = np.zeros(N)
arp = np.zeros(N)
pad = np.zeros(N)

# Kick: soft on every beat in the intro, full from 1.5, one last kick on the end card.
for i in range(int(END / BEAT)):
    t = i * BEAT
    if STOP[0] <= t < STOP[1]:
        continue
    add(drums, kick(0.55 if t < 1.5 else 1.0), t)
add(drums, kick(1.15), END)
# Clap on 2 and 4 and hats on the off-beats from 1.5; an open hat into each bar line.
for i in range(int(END / BEAT)):
    t = i * BEAT
    if t < 1.5 or STOP[0] <= t < STOP[1]:
        continue
    if i % 2 == 1:
        add(drums, clap(), t)
    # Hats alternate left and right so the groove has width.
    add(hats_l, hat(open_=(i % 4 == 3)), t + BEAT / 2, 0.9)
    add(hats_r, hat(open_=(i % 4 == 3)), t + BEAT / 2, 0.6)
    if t >= 3.0:
        add(hats_l, hat(), t + BEAT / 4, 0.55)
        add(hats_r, hat(), t + 3 * BEAT / 4, 0.55)

# Bass: eighth notes on the chord root, a long root on the end card.
for i in range(int(END / (BEAT / 2))):
    t = i * BEAT / 2
    if t < 1.5 or STOP[0] <= t < STOP[1]:
        continue
    root = hz(chord_at(t)[1]) * (2 if i % 4 == 3 else 1)
    add(bass, bass_note(root, BEAT / 2 * 0.9), t, 0.9)
add(bass, bass_note(hz('A1'), 3.0), END, 1.0)

# Arpeggio: sixteenths up and down the chord, quieter in the intro, ringing on after the end card.
pattern = [0, 1, 2, 3, 2, 1, 2, 3]
for i in range(int(DUR / (BEAT / 4))):
    t = i * BEAT / 4
    if STOP[0] <= t < STOP[1]:
        continue
    tones = chord_at(min(t, END - 0.01) if t < END else 0)[2]
    level = 0.55 if t < 3 else (0.35 * max(0.0, 1 - (t - END) / 2.5) if t >= END else 0.8)
    if level <= 0:
        continue
    add(arp, pluck(hz(tones[pattern[i % 8]])), t, level)

# Pad: one chord per bar, the end card holds Am.
for bar in range(int(END // (4 * BEAT)) + 1):
    t = bar * 4 * BEAT
    length = min(4 * BEAT, END - t) + 0.25
    if length <= 0.25:
        continue
    add(pad, pad_chord(chord_at(t)[0], length), t, 1.0)
add(pad, pad_chord(['A3', 'C4', 'E4', 'A4'], DUR - END), END, 1.25)

# Sidechain: bass, arpeggio and pad breathe with the kick.
duck = np.ones(N)
for i in range(int(END / BEAT)):
    t = i * BEAT
    if t < 1.5 or STOP[0] <= t < STOP[1]:
        continue
    j = int(t * SR)
    m = min(int(0.22 * SR), N - j)
    duck[j : j + m] = np.minimum(duck[j : j + m], 1 - 0.55 * np.exp(-np.arange(m) / SR * 14))


def stereo(x, width=0.0, delay_ms=0.0):
    d = int(delay_ms * SR / 1000)
    right = np.concatenate([np.zeros(d), x[: len(x) - d]]) if d else x
    return np.stack([x * (1 - width) + right * width, right * (1 - width) + x * width], 1)


# Ping-pong delay on the arpeggio (dotted eighth).
delay = int(0.375 * SR)
arp_l = arp.copy()
arp_r = np.zeros(N)
arp_r[delay:] += 0.55 * arp[:-delay]
arp_l[2 * delay :] += 0.25 * arp[: -2 * delay]
arp_st = np.stack([arp_l, arp_r], 1)

mix = (
    stereo(drums) * 0.75
    + np.stack([hats_l + 0.35 * hats_r, hats_r + 0.35 * hats_l], 1) * 0.9
    + stereo(bass * duck) * 0.8
    + arp_st * (duck[:, None] * 0.28)
    + stereo(pad * duck, 0.5, 17) * 0.42
)
wet = fftconvolve(stereo(arp * 0.3 + pad * 0.25 + hp(drums, 400) * 0.1), reverb_ir(), axes=0)[:N] * 0.6
mix = mix + wet

# The stop-down: the music dips about 10 dB for the 0.4 s before the end card.
t = np.arange(N) / SR
dip = np.ones(N)
inside = (t >= STOP[0]) & (t < STOP[1])
dip[inside] = 10 ** (-10 / 20)
mix *= dip[:, None]
# Short fade at the very end (the chord rings out).
fade = np.clip((DUR - t) / 0.8, 0, 1)
mix *= fade[:, None]
mix = hp(mix.T, 28).T
# A little air: +2.5 dB shelf above 6 kHz (the bed measured darker than the reference films).
mix = mix + hp(mix.T, 6000).T * 0.33
# Widen by mid / side: the side +4 dB above 250 Hz, the low end stays mono.
mid = (mix[:, 0] + mix[:, 1]) / 2
side = (mix[:, 0] - mix[:, 1]) / 2
side = hp(side, 250) * 1.6
mix = np.stack([mid + side, mid - side], 1)

mix /= np.abs(mix).max() + 1e-9
sf.write(sys.argv[1] if len(sys.argv) > 1 else 'music.wav', (mix * 0.8).astype(np.float32), SR, subtype='PCM_24')
print('music bed written', DUR, 's')
