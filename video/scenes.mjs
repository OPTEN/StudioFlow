// The storyboard of the StudioFlow product video (issue 69): one table for the frame extraction (extract.mjs), the
// composition (composition/comp.js) and the captions (render.mjs writes out/studioflow.vtt from it).
//
// Time is in seconds of the film. The music runs at 120 BPM, so every cut sits on a half-second beat. `src` is the start
// of the scene in its capture (video/captures/<clip>.mp4); the offsets put the moment that matters on a beat:
//   pairing   new station appears at capture 8.5 s   -> film 6.0
//   phone     red tally at capture 7.233 s            -> film 8.5
//   take      Take clicked at capture 7.14 s          -> film 12.5
//   layout    "Side by side" clicked at capture 6.32  -> film 16.0
//   output    fade to Interview at capture 7.33 s     -> film 18.5
//   obs       the "Use as camera" steps, already open from capture 12.7 s
// A rect is the part of the 1920 x 1080 capture the frame shows ([x, y, w, h]); `v` is the rect for the vertical and
// square formats, whose boxes are nearly square.

export const FPS = 30;
export const BPM = 120;
export const DURATION = 28;

export const scenes = [
  {
    id: 'hook',
    kind: 'type',
    start: 0,
    end: 3,
    lines: [
      { at: 0.0, text: 'A multi-camera live show.' },
      { at: 1.4, text: 'Just *phones.*', accent: 'red', big: true }, // settles on the 1.5 s hit
    ],
  },
  {
    id: 'pairing',
    kind: 'clip',
    clip: 'regie-pairing',
    start: 3,
    end: 7,
    src: 5.5,
    caption: 'Phones join by *QR code.*',
    coverQr: true, // the capture's QR holds a test pairing token; comp.js covers it with a QR for the site
    accent: 'green',
    rects: [
      { at: 0, r: [430, 640, 1000, 440], v: [430, 650, 560, 420] },
      { at: 1.9, r: [430, 640, 1000, 440], v: [430, 650, 560, 420] },
      { at: 2.7, r: [1000, 640, 920, 440], v: [1420, 650, 500, 420] },
    ],
  },
  {
    id: 'phone',
    kind: 'phone',
    clip: 'sender-phone',
    start: 7,
    end: 10,
    src: 5.733,
    caption: 'The phone knows when it is *live.*',
    accent: 'red',
  },
  {
    id: 'take',
    kind: 'clip',
    clip: 'regie-take',
    start: 10,
    end: 15,
    src: 4.64,
    caption: 'Preview. *Take.* On air.',
    accent: 'blue',
    rects: [
      { at: 0, r: [0, 90, 1920, 560], v: [860, 90, 1060, 560] },
      { at: 1.2, r: [0, 90, 1920, 560], v: [860, 90, 1060, 560] },
      { at: 2.1, r: [1180, 70, 740, 400], v: [1540, 60, 380, 320] },
      { at: 2.9, r: [1180, 70, 740, 400], v: [1540, 60, 380, 320] },
      { at: 3.7, r: [0, 90, 1920, 560], v: [860, 90, 1060, 560] },
    ],
  },
  {
    id: 'layout',
    kind: 'clip',
    clip: 'regie-layout',
    start: 15,
    end: 18,
    src: 5.32,
    caption: 'Layouts in *one click.*',
    accent: 'green',
    rects: [
      { at: 0, r: [0, 90, 1080, 900] },
      { at: 3, r: [20, 110, 1000, 840] },
    ],
  },
  {
    id: 'output',
    kind: 'clip',
    clip: 'output',
    start: 18,
    end: 20.5,
    src: 6.83,
    caption: 'The program is *a web page.*',
    accent: 'red',
    rects: [
      { at: 0, r: [0, 0, 1920, 1080], v: [380, 0, 1160, 1080] },
      { at: 2.5, r: [96, 54, 1728, 972], v: [440, 40, 1040, 1000] },
    ],
  },
  {
    id: 'obs',
    kind: 'clip',
    clip: 'output-obs',
    start: 20.5,
    end: 23,
    src: 12.7,
    caption: '*OBS* picks it up.',
    accent: 'blue',
    rects: [
      { at: 0, r: [1045, 652, 445, 378] },
      { at: 2.5, r: [1050, 660, 430, 366] },
    ],
  },
  {
    id: 'facts',
    kind: 'facts',
    start: 23,
    end: 25,
    items: [
      { at: 0.0, text: 'Self-hosted.' },
      { at: 0.5, text: 'One docker compose.' },
      { at: 1.0, text: 'On your network.' },
      { at: 1.5, text: 'Open source, MIT.', accent: 'green' },
    ],
  },
  { id: 'end', kind: 'end', start: 25, end: 28 },
];

/** The words the film shows, for the captions file (asterisks mark the coloured phrase). */
export const captionCues = [
  { start: 0, end: 1.5, text: 'A multi-camera live show.' },
  { start: 1.5, end: 3, text: 'Just phones.' },
  { start: 3, end: 7, text: 'Phones join by QR code.' },
  { start: 7, end: 10, text: 'The phone knows when it is live.' },
  { start: 10, end: 15, text: 'Preview. Take. On air.' },
  { start: 15, end: 18, text: 'Layouts in one click.' },
  { start: 18, end: 20.5, text: 'The program is a web page.' },
  { start: 20.5, end: 23, text: 'OBS picks it up.' },
  {
    start: 23,
    end: 25,
    text: 'Self-hosted. One docker compose. On your network. Open source, MIT.',
  },
  {
    start: 25,
    end: 28,
    text: 'StudioFlow. Go live from any phone. opten.github.io/StudioFlow. Sponsored by OPTEN.',
  },
];
