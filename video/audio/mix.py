"""Places the sound effects of the StudioFlow product video on the music bed and masters the mix.

The effects are takes of earshot's code-made bank, rendered from video/audio/kit.json (earshot's `launch` preset:
effects set 3-10 dB over the music, each role with its own sync point and offset). Every cue sits on a cut or on the
UI moment of the storyboard (video/scenes.mjs). The level of each take comes from earshot's mix model: the bed's
level in the second before the cue plus the role's bed_db (kit.bed_level, kit.gain_db), its start from kit.place.

Usage (with the earshot venv, after music.py and `earshot kit render`):
  python video/audio/mix.py <music.wav> <kit folder with kit.lock.json> <out mix.wav>
"""
import json
import sys
from pathlib import Path

import numpy as np
import pyloudnorm
import soundfile as sf
from earshot.forge import kit

SR = 48000
music_path, kit_dir, out_path = sys.argv[1], Path(sys.argv[2]), Path(sys.argv[3])

# (role, film time, take): the take is a file of the role (pitched roles by note name).
CUES = [
    ('text', 0.0, 'text_A4.wav'),  # "A multi-camera live show."
    ('hit', 1.5, 'hit_1.wav'),  # "Just phones."
    ('whoosh.short', 3.0, 'whoosh-short_1.wav'),  # cut to the pairing dock
    ('click.confirm', 6.0, 'click-confirm_1.wav'),  # the new station appears
    ('whoosh.short', 7.0, 'whoosh-short_2.wav'),  # cut to the phone
    ('land', 8.5, 'land_1.wav'),  # the red LIVE tally
    ('whoosh.short', 10.0, 'whoosh-short_3.wav'),  # cut to Studio Mode
    ('click', 12.5, 'click_1.wav'),  # Take is pressed
    ('whoosh.short', 15.0, 'whoosh-short_1.wav'),  # cut to the layouts
    ('click', 16.0, 'click_2.wav'),  # "Side by side"
    ('whoosh.short', 18.0, 'whoosh-short_2.wav'),  # cut to the output page
    ('whoosh.short', 20.5, 'whoosh-short_3.wav'),  # cut to the OBS steps
    ('text', 23.0, 'text_D4.wav'),  # the four facts, one per beat
    ('text', 23.5, 'text_E4.wav'),
    ('text', 24.0, 'text_G4.wav'),
    ('text', 24.5, 'text_A4.wav'),
    ('riser', 25.0, 'riser_1.wav'),  # into the end card
    ('hit', 25.0, 'hit_2.wav'),  # the end card
]

lock = json.loads((kit_dir / 'kit.lock.json').read_text())
roles = lock['roles']
music, sr = sf.read(music_path, always_2d=True)
assert sr == SR, sr
n = len(music)
fx = np.zeros_like(music)
report = []

for role_name, cue, file in CUES:
    role = roles[role_name]
    take = next(t for t in role['takes'] if t['file'] == file)
    y, tsr = sf.read(kit_dir / file, always_2d=True)
    assert tsr == SR, tsr
    if y.shape[1] == 1:
        y = np.repeat(y, 2, 1)
    # The bed under the cue, measured on the music without the stop-down's own dip (the dip is 0.4 s; bed_level
    # looks at the second before the cue).
    bed = kit.bed_level(music, cue, SR) if cue >= 0.05 else None
    gain = kit.gain_db(take, role, bed)
    start = kit.place(take, role, cue)
    if start < 0:
        y = y[int(-start * SR) :]
        start = 0.0
    i = int(round(start * SR))
    m = min(len(y), n - i)
    fx[i : i + m] += y[:m] * 10 ** (gain / 20)
    report.append(f'{cue:6.2f}s {role_name:13s} {file:22s} bed {bed if bed is None else round(bed, 1)} LUFS, gain {gain:+.1f} dB, starts {start:.3f}s')

mix = music + fx

# Master for the web: -14 LUFS integrated, sample peak under -1.5 dBFS through a soft-knee limiter (AAC adds a little).
meter = pyloudnorm.Meter(SR)
mix *= 10 ** ((-14.0 - meter.integrated_loudness(mix)) / 20)
ceiling = 10 ** (-1.5 / 20)
look = int(0.003 * SR)
peak = np.abs(mix).max(1)
env = np.maximum.reduce([np.roll(peak, -k) for k in range(look)])
gain = np.minimum(1.0, ceiling / np.maximum(env, 1e-9))
# Smooth the gain: instant attack (look-ahead), 80 ms release.
smooth = gain.copy()
release = np.exp(-1 / (0.08 * SR))
for k in range(1, len(smooth)):
    smooth[k] = min(gain[k], release * smooth[k - 1] + (1 - release) * gain[k])
mix *= smooth[:, None]

out_path.parent.mkdir(parents=True, exist_ok=True)
sf.write(out_path, mix.astype(np.float32), SR, subtype='PCM_24')
sf.write(out_path.with_name('fx.wav'), fx.astype(np.float32), SR, subtype='PCM_24')
print('\n'.join(report))
print(f'mix: {meter.integrated_loudness(mix):.1f} LUFS, peak {20 * np.log10(np.abs(mix).max()):.1f} dBFS -> {out_path}')
