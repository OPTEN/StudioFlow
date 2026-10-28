# StudioFlow product video (issue 69)

A 28 s product video for social media in three formats: 16:9 (1920 × 1080, the master), 9:16 (1080 × 1920) and 1:1
(1080 × 1080). It shows only the real StudioFlow UI: every picture is a frame of a screen recording of the running stack
with synthetic demo content (drawn stand-ins for people and a slide). Around those pictures the composition adds
captions, zoom and pan, a cursor drawn from the recorded pointer log, transitions and the end card. The burned-in
captions carry the story, so the video works muted; `out/studioflow.vtt` has the same lines as a captions file.

The video is rendered locally, not in CI. `npm run build:video` (below) writes all formats to `video/out/` (ignored, like
`video/work/` and `video/captures/`) and copies the files the site plays (`studioflow.mp4`, `studioflow-vertical.mp4`,
`studioflow.vtt`) to `site/public/media/`, which is committed: after a change here, render, commit those three files,
and the Pages workflow publishes them with the site. The square format and the poster stay in `video/out/` for posting.

## Storyboard (120 BPM, every cut on a beat; the table is `scenes.mjs`)

| time | scene | picture (capture) | caption |
| --- | --- | --- | --- |
| 0.0-3.0 | hook | type only | A multi-camera live show. / Just phones. |
| 3.0-7.0 | pairing | Regie, pairing dock with QR, a new station appears at 6.0 (`regie-pairing`) | Phones join by QR code. |
| 7.0-10.0 | phone | the sender page, the red LIVE tally at 8.5 (`sender-phone`) | The phone knows when it is live. |
| 10.0-15.0 | take | Studio Mode, zoom to Take, pressed at 12.5, fade to program (`regie-take`) | Preview. Take. On air. |
| 15.0-18.0 | layout | "Side by side" applied at 16.0 (`regie-layout`) | Layouts in one click. |
| 18.0-20.5 | output | the output page fading to the next scene at 18.5 (`output`) | The program is a web page. |
| 20.5-23.0 | obs | the output popover's "Use as camera" steps (`output-obs`) | OBS picks it up. |
| 23.0-25.0 | facts | type, one line per beat | Self-hosted. One docker compose. On your network. Open source, MIT. |
| 25.0-28.0 | end card | logo, claim, link, licence, Sponsored by OPTEN | Go live from any phone. opten.github.io/StudioFlow |

What is covered or left out on purpose: the pairing QR of the recording holds a test pairing token, so the composition
lays a QR for https://opten.github.io/StudioFlow/ over it (same tile, same place; `coverQr` in `scenes.mjs`). The
output popover is framed on its "Use as camera" steps only, so the test stack's addresses (172.31.x, localhost:8495)
and its headless-browser frame statistics never show.

## Build

One command, from the repository root with Node and ffmpeg:

```bash
python -m venv .venv-video
.venv-video/Scripts/pip install -r video/audio/requirements.txt          # bin/pip on Linux and macOS
.venv-video/Scripts/pip install --no-deps -r video/audio/earshot.txt
PYTHON=.venv-video/Scripts/python npm run build:video                    # from video/captures, about 7 minutes
PYTHON=.venv-video/Scripts/python npm run build:video -- --capture       # record the UI first (Docker, E2E stack 5)
```

earshot is installed without its dependencies on purpose: the kit renderer needs only numpy and scipy, and the torch /
CLAP stack of its listening tools (`timeline`, `critique`) would add gigabytes to every run. For the earshot check
below, use a full install as in earshot's README (CPU torch, then `pip install earshot`).

## The steps one by one

From the repository root, with Docker, Node and ffmpeg:

```bash
# 1. Record the real UI (a test stack with synthetic demo content; writes video/captures/, about 2 minutes)
tests/e2e/stack.sh up 5
E2E_PRODUCT_VIDEO=1 E2E_REUSE_STACK=1 tests/e2e/stack.sh test 5 --project=desktop-chromium specs/ui/ui-product-video.spec.ts
tests/e2e/stack.sh down 5

# 2. Cut the frames each scene needs (video/work/frames)
node video/extract.mjs

# 3. Music and sound (any Python with numpy, scipy, soundfile and pyloudnorm; the effects need earshot)
python video/audio/music.py video/work/audio/music.wav
earshot kit render video/audio/kit.json --out video/work/audio/kit
python video/audio/mix.py video/work/audio/music.wav video/work/audio/kit video/out/audio/mix.wav

# 4. Render the three formats with the mix, the poster and the captions (about 6 minutes)
node video/render.mjs
node video/render.mjs --stills 2.6,12.5,26     # PNG stills of every format into video/work/stills, for a look first

# 5. Listen with earshot
earshot timeline video/out/studioflow.mp4 --cues "1.5,3,6,7,8.5,10,12.5,15,16,18,20.5,23,23.5,24,24.5,25"
earshot critique video/out/studioflow.mp4
```

When the UI changes, record again (step 1) and check the times in `scenes.mjs`: each scene's `src` puts the moment that
matters on a beat (the comment at the top lists them), and the `rects` frame the part of the screen the scene is about.

## Files

- `build.mjs`: the whole build (`npm run build:video`), the steps below in order.
- `scenes.mjs`: the storyboard, the framing rects and the caption lines, shared by everything below.
- `extract.mjs`: frames per scene from `captures/*.mp4`.
- `composition/`: the HTML composition. `window.renderFrame(t)` draws film time t; no clocks or transitions, so the
  same t gives the same pixels.
- `render.mjs`: serves the repository, captures every frame in Chromium (Playwright), encodes H.264 + AAC with
  `+faststart`. Frame 0 is the poster frame (the settled "Just phones." at 2.6 s) so every platform's thumbnail shows it.
- `audio/music.py`: the music bed, synthesized in code (120 BPM, A minor, Am F C G).
- `audio/kit.json`: earshot's `launch` preset (effects and their levels against the music).
- `audio/requirements.txt`, `audio/earshot.txt`: the pinned Python packages of the audio.
- `audio/mix.py`: places 18 effects on the cuts and UI moments with earshot's mix model and masters to -14 LUFS.
- `share-copy.md`: post texts for LinkedIn, X, Instagram / Reels and YouTube Shorts (draft, to be approved).

## Sound and licences

Everything you hear is made in code: the music by `audio/music.py` (no samples, no third-party track), the effects by
earshot's bank (DSP recipes; earshot is MIT licensed, and the bank's 15 fitted sounds were fitted from CC0 recordings,
see earshot's `docs/CREDITS_FIT.md`; this mix uses none of the fitted ones except where the launch preset names them:
`fit/click/floss_lid` for `click`). The video uses the self-hosted fonts of the product (Sofia Sans Semi Condensed and
JetBrains Mono, SIL Open Font License) and the StudioFlow and OPTEN logos from `docs/`. Since the site's MP4s are committed,
`THIRD_PARTY_NOTICES.md` lists the video's material (section 6).

## earshot check, before and after

earshot 0.4.0 on `out/studioflow.mp4` (landscape master), cues = the 16 sound cues of `audio/mix.py`.

| | first mix | final mix |
| --- | --- | --- |
| critique verdict | launch-grade, 21 of 23 metrics in range (95 %) | launch-grade, 22 of 23 in range (97 %) |
| loudness / true peak | -14.2 LUFS / -1.3 dBTP | -14.3 LUFS / -1.3 dBTP |
| stereo width (side vs mid) | -17.6 dB, low (refs -15.5 .. -4.0) | -15.5 dB, in range |
| brightness (spectral centroid) | 1082 Hz | 1179 Hz (refs p10 1183 Hz) |
| realness p_real | 0.65, 2 of 7 windows lean synthesized | 0.75, no window leans synthesized (minor: under 0.77) |
| sound on the 16 cues | 100 % within 40 ms, median 0 ms | 100 % within 40 ms, median 0 ms |
| sound on the picture cuts | 92 % within 100 ms; a picture change at 1.63 s with no onset ("CHECK") | 100 % within 100 ms; no CHECK |
| salient hit density | 1.79 /s, in range (refs up to 1.86) | 1.79 /s, in range |

The fixes between the two: the hats alternate left and right, the pad and the arpeggio delay got wider, the side
channel above 250 Hz +4 dB (the low end stays mono), a +2.5 dB shelf above 6 kHz, and the punchline "Just phones."
starts 0.1 s earlier so it settles on the 1.5 s hit. The one open point is realness: the music is synthesized by
design (no licensed track), which earshot reads as "uncertain" rather than "produced".
