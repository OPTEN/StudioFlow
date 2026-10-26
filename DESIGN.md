---
name: StudioFlow
description: A web-based control room (Regie) modelled on OBS, for webinars. One continuous graphite console where colour belongs only to state.
colors:
  ground: "#0d1117"
  panel: "#151a22"
  raised: "#1b212b"
  raised-2: "#232a36"
  seam: "#262c36"
  seam-strong: "#353d4a"
  control-edge: "#636d7b"
  well: "#05070a"
  text: "#e6edf3"
  text-2: "#b4bdc8"
  muted: "#8b949e"
  blue: "#79c0ff"
  blue-fill: "#1f6feb"
  blue-fill-hover: "#1a5fd0"
  green: "#56d364"
  red: "#ff6a63"
  amber: "#e3b341"
  violet: "#c678dd"
  slot: "#3a4352"
  slot-strong: "#5a6578"
  on-fill: "#ffffff"
  on-state: "#0d1117"
  red-wash: "rgba(248, 81, 73, .1)"
  amber-wash: "rgba(227, 179, 65, .1)"
  green-wash: "rgba(86, 211, 100, .08)"
  blue-wash: "rgba(121, 192, 255, .08)"
  float: "#1b212b"
  pic-ink: "#0d1117"
  pic-text: "#e6edf3"
  pic-text-2: "#b4bdc8"
  pic-muted: "#8b949e"
  pic-blue: "#79c0ff"
  pic-red: "#f85149"
  pic-amber: "#e3b341"
  pic-scrim: "rgba(13, 17, 23, .9)"
colors-light:
  ground: "#ffffff"
  panel: "#f3f5f8"
  raised: "#e9edf2"
  raised-2: "#dfe4eb"
  float: "#ffffff"
  seam: "#d8dde4"
  seam-strong: "#818b99"
  control-edge: "#7c8694"
  text: "#17202b"
  text-2: "#3a4552"
  muted: "#566170"
  blue: "#0a5cc7"
  blue-fill: "#1f6feb"
  blue-fill-hover: "#1a5fd0"
  green: "#146a2a"
  red: "#b71c28"
  amber: "#8a5800"
  violet: "#7a3fd0"
  on-fill: "#ffffff"
  on-state: "#ffffff"
  red-wash: "rgba(196, 32, 43, .09)"
  amber-wash: "rgba(190, 120, 0, .13)"
  green-wash: "rgba(22, 114, 46, .08)"
  blue-wash: "rgba(10, 92, 199, .07)"
typography:
  brand:
    fontFamily: "Sofia Sans Semi Condensed, Arial Narrow, system-ui, sans-serif"
    fontSize: "16.5px"
    fontWeight: 700
    letterSpacing: "0.01em"
  title:
    fontFamily: "Sofia Sans Semi Condensed, Arial Narrow, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 600
  body:
    fontFamily: "Sofia Sans Semi Condensed, Arial Narrow, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.4
  control:
    fontFamily: "Sofia Sans Semi Condensed, Arial Narrow, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 600
  meta:
    fontFamily: "Sofia Sans Semi Condensed, Arial Narrow, system-ui, sans-serif"
    fontSize: "12.5px"
    fontWeight: 400
  label:
    fontFamily: "Sofia Sans Semi Condensed, Arial Narrow, system-ui, sans-serif"
    fontSize: "11.5px"
    fontWeight: 700
    letterSpacing: "0.09em"
  tag:
    fontFamily: "Sofia Sans Semi Condensed, Arial Narrow, system-ui, sans-serif"
    fontSize: "10.5px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0.08em"
  take:
    fontFamily: "Sofia Sans Semi Condensed, Arial Narrow, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 700
    letterSpacing: "0.08em"
  mono-value:
    fontFamily: "JetBrains Mono, ui-monospace, Cascadia Mono, Consolas, monospace"
    fontSize: "12.5px"
    fontWeight: 500
    fontFeature: "tnum"
  mono-meta:
    fontFamily: "JetBrains Mono, ui-monospace, Cascadia Mono, Consolas, monospace"
    fontSize: "11.5px"
    fontWeight: 500
    fontFeature: "tnum"
  mono-code:
    fontFamily: "JetBrains Mono, ui-monospace, Cascadia Mono, Consolas, monospace"
    fontSize: "11.5px"
    fontWeight: 600
    lineHeight: 1
  mono-pair-code:
    fontFamily: "JetBrains Mono, ui-monospace, Cascadia Mono, Consolas, monospace"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.14em"
rounded:
  screen: "2px"
  xs: "3px"
  md: "4px"
  lg: "6px"
  switch: "10px"
  full: "50%"
spacing:
  hairline: "1px"
  xs: "4px"
  sm: "6px"
  md: "8px"
  row: "10px"
  lg: "12px"
  gutter: "16px"
  stage: "20px"
components:
  button:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    typography: "{typography.control}"
    rounded: "{rounded.md}"
    padding: "0 11px"
    height: "30px"
  button-hover:
    backgroundColor: "{colors.raised}"
  button-sm:
    typography: "{typography.control}"
    padding: "0 9px"
    height: "26px"
  button-primary:
    backgroundColor: "transparent"
    textColor: "{colors.blue}"
    rounded: "{rounded.md}"
    height: "30px"
  button-primary-hover:
    backgroundColor: "{colors.blue-fill}"
    textColor: "{colors.on-fill}"
  button-fill:
    backgroundColor: "{colors.blue-fill}"
    textColor: "{colors.on-fill}"
    rounded: "{rounded.md}"
  button-fill-hover:
    backgroundColor: "{colors.blue-fill-hover}"
  button-go:
    backgroundColor: "{colors.green}"
    textColor: "{colors.on-state}"
    rounded: "{rounded.md}"
  button-danger:
    backgroundColor: "transparent"
    textColor: "{colors.red}"
    rounded: "{rounded.md}"
  button-danger-hover:
    backgroundColor: "{colors.red-wash}"
  button-danger-fill:
    backgroundColor: "{colors.red}"
    textColor: "{colors.on-state}"
    rounded: "{rounded.md}"
  icon-button:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    rounded: "{rounded.md}"
    size: "28px"
  icon-button-hover:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.text}"
  take-button:
    backgroundColor: "{colors.blue-fill}"
    textColor: "{colors.on-fill}"
    typography: "{typography.take}"
    rounded: "{rounded.md}"
    height: "56px"
  take-button-hover:
    backgroundColor: "{colors.blue-fill-hover}"
  segment-active:
    backgroundColor: "{colors.blue-wash}"
    textColor: "{colors.blue}"
    height: "30px"
  input-field:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "0 9px"
    height: "30px"
  number-field:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.violet}"
    typography: "{typography.mono-value}"
    rounded: "{rounded.md}"
    padding: "0 8px"
    height: "30px"
  slot-code:
    backgroundColor: "{colors.raised-2}"
    textColor: "{colors.text}"
    typography: "{typography.mono-code}"
    rounded: "{rounded.xs}"
    padding: "3px 5px"
  tag-program:
    backgroundColor: "{colors.red-wash}"
    textColor: "{colors.red}"
    typography: "{typography.tag}"
    rounded: "{rounded.xs}"
    padding: "3px 6px"
  tag-preview:
    backgroundColor: "{colors.green-wash}"
    textColor: "{colors.green}"
    typography: "{typography.tag}"
    rounded: "{rounded.xs}"
    padding: "3px 6px"
  dock-header:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.muted}"
    typography: "{typography.label}"
    padding: "6px 8px 6px 6px"
    height: "40px"
  header-bar:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.text}"
    padding: "6px 16px"
    height: "50px"
  status-line:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.text-2}"
    padding: "0 16px"
    height: "38px"
  incident-bad:
    backgroundColor: "{colors.red-wash}"
    textColor: "{colors.text}"
  incident-warn:
    backgroundColor: "{colors.amber-wash}"
    textColor: "{colors.text}"
  incident-recovered:
    backgroundColor: "{colors.green-wash}"
    textColor: "{colors.text}"
  list-row:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "4px 6px"
  list-row-active:
    backgroundColor: "{colors.raised}"
  monitor-screen:
    backgroundColor: "{colors.well}"
    rounded: "{rounded.screen}"
  popover:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.text}"
    rounded: "{rounded.lg}"
    padding: "6px"
  toast:
    backgroundColor: "{colors.raised-2}"
    textColor: "{colors.text}"
    rounded: "{rounded.lg}"
    padding: "9px 10px 9px 14px"
  switch-on:
    backgroundColor: "{colors.blue-fill}"
    rounded: "{rounded.switch}"
    width: "36px"
    height: "20px"
---

# Design System: StudioFlow

## Overview

**Creative North Star: "The Continuous Console"**

The Regie (control room) is one continuous graphite console. There are no boxed panels, no gaps between regions and no outer frame. Header, message strip, stage and docks butt against each other and are separated only by 1px hairlines that run all the way to the window edge. The hairlines are also the handles: dragging one resizes the regions it divides. Only the content keeps a 16px gutter from the window edge. The density matches a broadcast tool on a 14–16 inch laptop: 14px body text, 30px controls and 40px dock headers.

Colour belongs to state. The neutral graphite steps carry the structure, and every saturated hue has a fixed meaning: red is Program and live, green is Preview and ok, amber is a station reconnecting, blue is selection, the primary action and the active hairline, and violet is an editable number. An outage therefore reads as colour that was not there a moment ago. Risky actions sit apart from everything else, behind a dashed red outline.

The system explicitly rejects two things. One is OBS's clutter of equal-ranking grey dock windows, in which an outage gets lost. The other is framed cards with gaps between them. The docks keep OBS's freedom: they can be moved, resized and hidden. They keep it without OBS's chrome.

**Key Characteristics:**
- One flat surface on panel graphite (#151a22). Regions are divided by 1px seam hairlines (#262c36) that reach the window edge. Content keeps a 16px gutter.
- Hairlines are interactive. They turn blue on hover or focus, a double-click resets them, and arrow keys move them.
- Saturated colour appears only as state: tally, lamps, washes, dashed alert outlines and the primary action.
- One compact semi-condensed grotesk for everything. Mono only for measurements, time codes and slot codes.
- Depth comes from tonal steps. Shadows appear only on floating layers.
- Motion is 150–200ms ease-out for state changes. An outage flashes once and then holds its light. The only longer motion is the fade itself, and it always runs to completion.

## Colors

A dark graphite neutral ladder with five syntax-palette state hues. No colour is decorative. The values on this page and in the frontmatter `colors` are the dark theme; the light theme is described under "Themes".

### Primary
- **Signal Blue** (blue): selection outlines, focus rings, the active hairline while resizing, dock insertion lines, drop strips, the selected-segment underline and the text of outline primary buttons.
- **Action Blue** (blue-fill): the one filled primary action per context (Take, filled primary buttons, the on state of the Studio Mode switch). Hover deepens to **Action Blue Pressed** (blue-fill-hover).

### Secondary
- **Tally Red** (red): Program, LIVE, the outage state, the "Changes go live immediately" warning (German: "Änderungen gehen sofort live") and danger actions. Its wash (red-wash) tints rows and message entries for an outage.
- **Tally Green** (green): Preview, ok lamps, the "No open messages" check (German: "Keine offenen Meldungen") and the recovered state. Its wash (green-wash) marks a recovered station until someone confirms it with "Seen" (German: "Gesehen").

### Tertiary
- **Reconnect Amber** (amber): "reconnecting" (German: "verbindet neu"). A source that is reconnecting gets an amber lamp, an amber dashed outline on its element and an amber-wash row.
- **Value Violet** (violet): editable numeric values only, such as the fade duration and the X/Y/size fields in Properties. It turns muted when the value is inactive (Cut).

### Neutral
- **Ground** (ground): the field behind inputs and the link box. It is also the base colour for overlay scrims on monitors.
- **Well** (well): the near-black behind monitor canvases, thumbnails and layout previews, so the 16:9 picture reads as a hole in the console.
- **Panel Graphite** (panel): the console surface for the header, message strip, stage and docks.
- **Raised** (raised) and **Raised Higher** (raised-2): hover and active rows, popovers, the toast, slot-code chips and pressed buttons.
- **Seam** (seam): every region hairline and divider between rows inside a dock.
- **Strong Seam** (seam-strong): borders of buttons and segmented groups, popover and toast borders, separators in menus and popovers, and scrollbar thumbs. A label or a fill identifies these, so the border is quiet.
- **Control Edge** (control-edge): the border of text fields, selects, number fields, the link box and the drop zone, and the switch track when off. There the edge is the only thing that shows where the control is, so it meets 3:1.
- **Text** (text), **Secondary Text** (text-2), **Muted** (muted): primary content, supporting values, and labels or hints.
- **Slot** (slot) and **Strong Slot** (slot-strong): the blocks inside layout-template previews.
- **On Fill** (on-fill) is the text colour on Action Blue. **On State** (on-state) is the text colour on green or red fills and on the blue element label.

### Named Rules
**The State-Only Colour Rule.** A saturated hue appears only when it carries one of its five meanings. Never use red, green, amber, blue or violet as decoration, and never give a hue a second meaning.

**The Wash Rule.** A state tints a whole row or message entry with its wash (8–10% alpha) and colours its icon, lamp or label. It never fills an entire region with solid colour.

### Themes

The Regie has two appearances. **Dark** is the console described on this page and the default. **Light** is the same console for bright rooms and daylight. A setting in the settings popover chooses **Dark**, **Light** or **System** (follows the operating system live) and applies per browser (`localStorage['studioflow.theme']`, absent means Dark). The Regie, `/monitoring`, the login page and the first-run setup page follow it; the sender and the output page do not. Switching is a pure display setting and is allowed during a broadcast. "Reset layout" does not reset it.

**Mechanism.** Every colour is a semantic CSS custom property (`--panel`, `--red`, ...). `:root` carries the dark values; `:root[data-theme='light']` overrides all of them. `data-theme` is always the resolved theme, set before the first paint by `theme-init.js` and kept by `ThemeService`. Components use only the tokens and never branch on the theme. The Sass source is `$theme-dark` and `$theme-light` in `styles/_tokens.scss`.

**The light ladder.** Same tonal logic, mirrored: depth still comes from steps, not from shadows.
- Ground `#ffffff` (inputs, link box), Panel `#f3f5f8` (the console surface), Raised `#e9edf2` and Raised Higher `#dfe4eb` (hover, active, chips, toast), Float `#ffffff` (popovers; in dark theme Float equals Raised).
- Seam `#d8dde4` for hairlines. Strong Seam `#818b99` for the quiet borders of buttons, segments and popovers. Control Edge `#7c8694` for field edges and the switch track, which meets 3:1 on Panel, Ground and Float.
- Text `#17202b`, Secondary Text `#3a4552`, Muted `#566170`.
- On State is white in the light theme, because green and red fills are dark there.

**The light state hues.** The same five meanings, darkened so text and lamps pass on a light surface. Blue `#0a5cc7`, Green `#146a2a`, Red `#b71c28`, Amber `#8a5800`, Violet `#7a3fd0`. Action Blue (`#1f6feb`, hover `#1a5fd0`) is unchanged and carries white text. The washes keep the Wash Rule and are tuned for light: red 9%, amber 13%, green 8%, blue 7% alpha of the light hues. An incident stands out in light exactly as in dark: the lamp, the wash and the dashed outline appear, flash once and stay.

**Contrast.** Text and state text meet 4.5:1 on every surface and on their own wash. The PGM and PVW tags stay readable on a current row and on a row washed in their own hue. Lamps, tally outlines and focus rings meet 3:1 on every surface, and so does the Control Edge on the surfaces fields sit on. In the dark theme Tally Red is `#ff6a63` (5.15:1 on Raised Higher) and Control Edge `#636d7b` (3.3:1 on Panel); the dark Strong Seam `#353d4a` stays a hairline-weight border (1.6:1) for things that a label or a fill identifies, which keeps the console from turning into boxes (WCAG 1.4.11 asks for the border only where it is the sole indicator). `tools/lib/studio-theme-contrast.spec.ts` reads the compiled tokens and checks these pairs in both themes, so a changed value that breaks them fails the unit tests.

**Picture areas stay dark.** Monitors, scene thumbnails, station and source previews, layout-template previews and the well stay near black in the light theme as well. A video picture on a white background looks flat and too dark, and broadcast tools do the same. The picture tokens (`--well`, `--slot`, `--slot-strong`, and `--pic-ink`, `--pic-text`, `--pic-text-2`, `--pic-muted`, `--pic-blue`, `--pic-red`, `--pic-amber`, `--pic-scrim`) are one set for both themes. Everything drawn on a picture (the edit box and its handles, snapping guides, the live note, thumbnail keycaps, the "Preview off" note) uses these `--pic-*` tokens and never the themed ones, so selection blue and alert dashes keep their dark-theme brightness. The renderer's canvas colours (`packages/scene-renderer/src/palette.ts`) are unchanged. The tally outline around a picture sits on the console surface and uses the themed red or green.

**The One-Appearance Rule.** A new colour is added as a token in both theme maps, or as a picture token. Never put a literal colour in a component stylesheet.

## Typography

**UI Font:** Sofia Sans Semi Condensed (with Arial Narrow, system-ui, sans-serif)
**Mono Font:** JetBrains Mono (with ui-monospace, Cascadia Mono, Consolas, monospace), tabular numerals

**Character:** a compact semi-condensed grotesk keeps long labels (German ones in particular) and dense dock rows on one line. The mono font is a measuring instrument, not a style. It appears only where digits must align or codes must be read exactly.

**Font delivery:** both families are self-hosted. The prototype loads them from `prototype/fonts/` with `@font-face`. These are variable latin woff2 files under the SIL Open Font License; the license texts sit next to them. Sofia Sans Semi Condensed is used at weights 400–700 and JetBrains Mono at 400–600. The Angular build ships the same files, with no external CDN, because the Regie runs in a LAN.

### Hierarchy
- **Brand** (700, 16.5px, +0.01em): the "StudioFlow" word next to the mark in the header. It is the largest UI text.
- **Title** (600, 15px): monitor scene names. The pairing dock headings use the same step at 15.5px/700.
- **Body** (400, 14px, line-height 1.4): default text and scene names (600, 14px).
- **Control** (600, 13px): buttons, header chips, segmented controls and tabs (13–13.5px). Small buttons use 12.5px.
- **Meta** (400, 12.5px, muted): hints, scene and source meta lines, field labels and control-column help text.
- **Label** (700, 11.5px, +0.09em, uppercase, muted): dock titles (SCENES, SOURCES, STATIONS), monitor tally names (PREVIEW, PROGRAM), and form-group labels such as TRANSITION or APPLY TEMPLATE (11px). The label always names the region or control group it sits on.
- **Tag** (700, 10.5px, +0.08em, uppercase): the PGM and PVW tags on scene and station rows.
- **Take** (700, 15px, +0.08em, uppercase): only the TAKE button. Its shortcut hint "Space" is set at 11px/600 below it.
- **Mono value** (500, 12.5–13px): the fade duration, number inputs, the clock, the LIVE runtime and output latency.
- **Mono meta** (500, 11.5–12px): resolution and fps, bitrate and latency metrics, and timestamps in the message strip.
- **Mono code** (600, 11.5px): slot codes such as K1, S2 and M3, on a raised-2 chip.
- **Mono pairing code** (600, 24px, +0.14em): the verification code shown while a laptop pairs (18px in the mini preview).

### Named Rules
**The Instrument Mono Rule.** JetBrains Mono is reserved for measurements, time codes, slot codes, URLs and pairing codes. Words in sentences, names and buttons are always set in Sofia Sans Semi Condensed.

**The Label-Is-A-Name Rule.** The uppercase label style names the dock or control group it belongs to. It is never an eyebrow or teaser above a heading.

## Layout

**Surface model.** The app is a CSS grid of header (min 50px), message strip (min 38px) and workspace. A 1px grid gap shows the seam colour through, which forms the hairlines. Inside the workspace a center column holds the stage and the bottom dock zone, with optional left and right dock zones. Every divider between zones and docks is a 1px separator element. Region backgrounds run edge to edge, and only content is inset by the 16px gutter (which also respects the safe-area insets).

**Stage.** On the left are the monitors and on the right is a fixed control column (172px) with the Studio Mode switch, Transition (Cut | Fade), the duration stepper and, in Studio Mode, Take. The column and the docks never move when the mode toggles.
- Studio Mode off (default): a single Program monitor, right-aligned against the control column. The vacated Preview area shows a quiet muted note ("Preview off"). The Program header carries "Changes go live immediately" in red. A scene click or key 1–9 goes live directly.
- Studio Mode on: Preview and Program side by side with a 20px resizable split between them. Take (Space) switches Preview to Program.
- Monitors are always 16:9. They are sized from the stage's container width and height so they never overflow.

**Docks.** The default arrangement is Scenes | Sources | Properties | Stations along the bottom (height clamp(240px, 42dvh, 420px), at least 150px). Side zones start at 320px wide (220px min, 42% max). Docks move between the bottom, left and right zones by dragging their header grip, or with arrow keys on the grip. A blue insertion line shows the target, and dashed blue drop strips (92px wide at the sides, 72px tall at the bottom) appear at empty edges. Every hairline between docks and zones is a resize handle with a widened 9px hit area. It turns blue on hover or focus, a double-click or Enter resets it, and arrow keys move it in 16px steps (64px with Shift). "Docks and layout" in the header shows or hides each dock and resets the layout. The layout and the Studio Mode state persist per browser. The pairing dock (Pair device) temporarily takes the place of Sources and Properties.

**Spacing rhythm.** The scale is 4 / 6 / 8 / 10 / 12 / 16 / 20px. Rows inside docks are separated by 2px gaps or by seam hairlines (Stations). Docks pad their content by 12px (Properties) or 4–6px (lists).

**Responsive.**
- The design holds from 1280 × 720 to 1920 × 1080.
- At heights of 820px or less (on screens wider than 1180px), scene rows collapse to one line with 48px thumbnails and dock headers shrink to 36px.
- At 1180px or less, docks stop being draggable and stack as a two-column grid of hairline-separated sections below the stage, and the page scrolls.
- At 900px or less, everything stacks by priority: Program, then the controls (two columns, Take full width), then Preview, then the docks in one column. Scenes become a horizontal strip, and the message strip shows only the ok state and incidents.

## Elevation & Depth

The console is flat. Depth comes from tonal steps (well, ground, panel, raised, raised-2) and from hairlines, not from shadows. A shadow appears only on layers that float above the surface: popovers, the toast and the dock-drag ghost. Scrollable docks show a soft inner fade at the top and bottom edges to indicate overflow.

### Shadow Vocabulary
- **Pop** (`box-shadow: 0 4px 10px rgba(1, 4, 9, .5)`; light theme `0 4px 12px rgba(31, 41, 55, .2)`): popovers (Output, Docks and layout, Stations), the toast and the dragged dock ghost.
- **Scroll edge** (background `linear-gradient(rgba(1, 4, 9, .65), transparent)` at 10px, masked by panel at 18px; light theme `rgba(31, 41, 55, .14)`): top and bottom of scrolling dock bodies, shown only while there is more to scroll.
- **Selected underline** (`box-shadow: inset 0 -2px 0 #79c0ff`): the active segment or tab.
- **Active hairline glow** (`box-shadow: 0 0 0 1px #79c0ff`): a splitter being hovered, focused or dragged becomes a 3px blue line.

### Named Rules
**The Seam-Not-Shadow Rule.** Regions sit on the surface and are divided by hairlines. Shadows belong only to things that float (popovers, toast, drag ghost).

## Shapes

Small, tool-like corners. Monitor screens, thumbnails and layout previews use 2px. Slot codes, tags and keycap badges use 3px. Buttons, inputs, list rows and segmented groups use 4px. Popovers and the toast use 6px. Only the Studio Mode switch (10px track) and lamps or tally dots (circles) are round. Regions themselves have no corners and no borders, only hairlines.

Dashed lines are the conditional outline of this world, and they always signal something that needs attention:
- red dashed: danger actions and confirmations;
- amber dashed: an element whose source is reconnecting;
- red dashed: an element whose source is down;
- blue dashed: dock drop strips;
- faint grey dashed: the safe-area guide shown while hovering or dragging in a monitor.

Monitor tally is a solid 2px outline (red for Program, green for Preview). A 1px dot raster (20px pitch) appears in a monitor only while an element is being dragged.

## Components

### Buttons
Quiet outlines on the surface. Fills are reserved for the action that matters.
- **Shape:** gently squared (4px). The default height is 30px with 11px side padding. The small size is 26px with 9px padding.
- **Default:** transparent with a strong-seam border and Text-coloured label. Hover shows Raised, active shows Raised Higher, and disabled is at 45% opacity.
- **Primary (outline):** blue border and blue text. Hover fills it with Action Blue and white text. Used for "Pair device" and "+ Source".
- **Fill:** Action Blue with white text, used for confirmation in pairing. **Go:** green with dark text, used for approving a waiting device.
- **Danger:** a 1px dashed red outline with red text that tints red-wash on hover. It always sits apart from other actions, pushed to the far end of its row or into a separate zone above a seam ("Delete scene", "Block device", "Revoke link"). A confirmation step appears in a dashed red box, and its final action uses the solid red **Danger fill**.
- **Icon button:** 28px square, muted, raised on hover. Icons are inline 16px SVG strokes (1.6 stroke width).

### Take
The only large filled control. It is 172px wide and at least 56px tall, Action Blue with uppercase "TAKE" and a small "Space" hint in the same white (never faded, it must stay 4.5:1 on the blue). It exists only in Studio Mode. It presses down by 1px when active and is disabled while a transition runs.

### Studio Mode switch and Transition
- **Switch:** 36 × 20px track, Control Edge when off and Action Blue when on, with a 14px thumb that slides in 150ms. It sits at the top of the control column.
- **Transition:** a two-segment control (Cut | Fade) with strong-seam dividers. The active segment gets blue-wash, blue text and a 2px blue underline.
- **Duration stepper:** minus and plus buttons around a violet mono value. The steps are 0.2 / 0.3 / 0.5 / 0.8 / 1 / 1.5 / 2 s (default 0.3 s; 0,3 s in the German UI). It is muted and disabled under Cut. There is no T-bar: a fade always runs to completion, and new switches are ignored while it runs.

### Monitors
- **Header:** a tally dot with the uppercase label (PREVIEW green, PROGRAM red), the scene name in Title, and muted meta on the right (element count, or "1920 × 1080 · 30 fps" in mono).
- **Screen:** a 16:9 Well with a 2px tally outline. When a scene goes live, the Program outline flashes once (6px, light red, settling to 2px in 500ms).
- **Editing:** the selected element gets a 1px blue box, a blue mono label tab and four 11px square corner handles. Blue 1px guides show snapping.

### Inputs / Fields
- **Style:** Ground fill, strong-seam 1px border, 4px radius, 30px height. Text is 13–13.5px in Sofia Sans, and the caret is blue.
- **Focus:** the border turns blue, and controls without a border get a global 2px blue outline offset by 2px.
- **Number fields:** the mono label and unit are muted, and the value is in Value Violet.
- **Camera panel (Stations dock):** labelled rows of a muted label, a native range slider (blue accent, full keyboard support: arrows, Page Up/Down, Home, End) and the live value in Value Violet mono ("2.0×", "+0.5 EV"). Choices (lens, focus Auto | Lock, light Off | On) are segmented controls with `aria-pressed`. Only the controls the phone reports are drawn, and the value shown is the one the phone reports back. A refusal is a plain inline sentence in the secondary text colour, never a hue. A lens switch of a source in the program asks in the dashed red confirmation; zoom, focus and brightness never ask.
- **Selects:** use the same box as text inputs.

### Docks
- **Header:** 40px tall on Panel with a seam underline. It holds a drag grip (60% opacity, full on hover), the uppercase Label title, a mono count and right-aligned actions.
- **Body:** scrolls with scroll-edge fades.
- **Rows:** rows in Scenes and Sources are 4px-rounded, transparent at rest and Raised on hover or when current. Scene rows carry a 64px 16:9 thumbnail with a mono keycap number (1–9) and a tally outline (red PGM, green PVW). Station rows are divided by seam hairlines and expand with a 200ms grid-row reveal.
- **Reorderable rows:** the rows of Scenes and Sources can be dragged. Each row has a 16px grip handle in a column of its own (muted, Raised-2 text on hover, invisible at rest on a mouse, 70% opacity on touch screens where there is no hover, and a blue focus outline). A held row floats on Raised Higher with the Pop shadow (the drag ghost rule) and follows the pointer; the rows it passes slide aside in the state-transition time, and a 2px Signal Blue line marks the insertion point. Under reduced motion they jump instead of sliding. The list scrolls by itself within 36px of its edge. Mouse and pen drag from anywhere on the row after 4px, a finger from the handle at once or from the row after a 350ms press and hold. Escape or a drop away from the list puts the row back. In an Auto grid scene the Sources hint says that the order is the position in the grid.

### Texts and lower thirds
Texts are part of the picture, not of the console, so the **production** chooses their colours (accent, background, text; defaults Action Blue `#1f6feb`, Ground `#0d1117`, white) and the Regie themes never change them. The output draws them as HTML text in Sofia Sans Semi Condensed with the system emoji fonts behind it, and every size is a fraction of the item height, so a text keeps its proportions at every resolution (the renderer's `METRICS` in `text-block.ts`).
- **Lower third** (960 × 180 at 80/820): a bar with a 5% accent edge at the start, line 1 bold at 34% of the item height, line 2 medium at 22%; both lines stay on one line and end in an ellipsis. The text follows its reading direction (right-to-left names sit at the right edge).
- **Title** (1600 × 300, centred): line 1 bold at 24% (two lines at most, then an ellipsis), line 2 at 12%, and a 2.5% accent rule along the bottom edge.
- **Note** (540 × 96 in the top right corner): like the lower third, with a 6% accent edge and line 1 at 34%.
- **Showing and hiding** fades and slides for 300 ms (lower third from the left, title up, note down), decelerating in and accelerating out; a cut under `prefers-reduced-motion`. Nothing else moves.
- **Contrast:** the colour form warns below 4.5:1 between text and background (the ratio is rounded down so the warning never reads 4.5). The defaults give 18.9:1. The warning is advice, not a block: a text over a picture needs its own judgement.
- **In the console:** the text editor lives in the Properties dock above the geometry. Its preview is a picture area (the `--slot` ground, in both themes) that draws the real renderer; the show/hide state is a plain word (“Shown” in the green text hue, “Hidden” muted), the one hue carrying its one meaning. A hidden text row keeps its code and name at half opacity like every hidden row but stays selectable. The colour form in the production menu shows a sample strip that wears the colours being edited; this is the only place where literal colours come from data, and they never reach another element.

### Lamps, washes and the message strip (outage language)
- **Lamp:** 7px green when ok, muted when idle, 9px amber with a soft halo while reconnecting, and 11px red with a halo when down. A new outage pulses its lamp once (1.2s) and then holds.
- **Wash:** the station row, the message entry and the affected element use the state's wash. The element also gets a dashed amber or red outline with a filled label tab ("S1 · sharing stopped"; German: "S1 · Teilen beendet").
- **Message strip:**
  - Each incident is its own segment, divided by seams: icon, slot code, name, state word in colour, where it is used ("in Program", "in Preview"; German: "im Program", "in der Preview"), a mono timer and a direct action.
  - With no incidents, the strip shows "No open messages" and a log of recent events (German: "Keine offenen Meldungen", "Letzte Ereignisse").
  - The header summarises station health ("All 5 stations ok" or "2 incidents"; German: "Alle 5 Stationen ok", "2 Störungen").
- **Hold frame:** after the configured hold time (3s, 10s or hold), the audience sees the last frame of the lost source heavily blurred and darkened, with "Picture returns shortly" centred (German: "Bild kommt gleich zurück").
- **Recovered:** a returning station keeps a green-wash entry and a "Seen" button until someone confirms it.

### Popovers, menus and toast
- **Popovers:** Float (Raised in the dark theme), strong-seam border, 6px radius and Pop shadow, opening 6px below their trigger. They use 34px menu items, uppercase Label headings and strong-seam separators.
- **Toast:** centred at the bottom on Raised Higher with the Pop shadow. It confirms switches ("‘Lea presents’ is live"; German: "«Lea präsentiert» ist live") and dock moves, with an optional undo action.

### Audit log page
`/audit`, a page of its own like `/monitoring` (it follows the theme), reached from the production menu. A 50px header bar (brand, Label title, "Back to the control room") above one scrolling Panel.
- **Filters:** one wrapping row of labelled controls: Time range and Production (selects), custom From and To (`datetime-local` inputs, red border and a plain sentence when the end is not after the start), Search (a search input), the categories as toggle buttons (`aria-pressed`, selected look as in the segmented control: Raised Higher with the selected shadow), "Clear filters" when any filter is on, and the export buttons ("Export CSV" primary outline, "Export JSON" default) at the end of the row. At 900px and below the row simply wraps.
- **Table:** one hairline per row, 13px text, the time in mono with the details arrow (28px target, rotates 90° when open) in front, then who, what and production. Headings are Label style on Panel and stay at the top of the scroll area. The open details row is Raised, a two-column list of muted mono keys and secondary mono values (action code, actor, exact UTC time, entry number, then every detail as stored). A new entry that arrives while the page is open fades from the blue wash over 2.4s (no animation under reduced motion). The table never scrolls the page sideways: its container scrolls when 640px do not fit.
- **States:** loading, empty ("No entries match.", with a hint) and error ("Try again") use the plain empty block; a failed "Load more" keeps the loaded entries and says so next to the button. No new colours or tokens: Panel, Raised, seam, text and the blue wash in both themes.

### Header
50px tall on Panel. On the left are the mark and brand, then the production name in text-2. On the right are LIVE with a red dot and mono runtime, output status to the proxy with a lamp and mono latency, station health, the Docks and layout and presence icon buttons, and the mono clock.

## Do's and Don'ts

### Do:
- **Do** separate regions with 1px seam hairlines (#262c36) that run to the window edge, and keep content 16px from that edge.
- **Do** make every region divider a resize handle: blue on hover or focus, double-click or Enter to reset, arrow keys for 16px steps (Shift for 64px).
- **Do** give each saturated hue exactly one meaning: red Program and down, green Preview and ok, amber reconnecting, blue selection and primary action, violet editable number.
- **Do** show an outage everywhere at once (header, message strip, monitor element, scene list, source row, station row) with lamps and washes, and keep a recovered station marked until "Seen".
- **Do** keep the control column and the docks fixed when Studio Mode toggles. Only the Preview monitor appears or disappears.
- **Do** put risky actions behind a dashed red outline, away from other actions, with a dashed confirmation box.
- **Do** set measurements, time codes, slot codes and pairing codes in JetBrains Mono with tabular numerals.
- **Do** self-host Sofia Sans Semi Condensed and JetBrains Mono in the product build.
- **Do** label sample imagery and names as synthetic wherever placeholder content appears.
- **Do** keep picture areas dark in the light theme and draw everything on a picture with the `--pic-*` tokens.
- **Do** add every new colour as a token in both theme maps (or as a picture token), and check it with the contrast test.

### Don't:
- **Don't** box regions as cards with gaps between them, and don't frame the app with an outer border.
- **Don't** add a T-bar or any control that can leave a fade half-finished.
- **Don't** use shadows on regions. Shadows are only for popovers, the toast and the drag ghost.
- **Don't** use a saturated hue decoratively, including for branding, section accents or illustrations.
- **Don't** use the uppercase label style as an eyebrow or kicker above a heading.
- **Don't** load fonts or assets from an external CDN in the product.
- **Don't** write a literal colour value in a component stylesheet or branch on the theme in a component.
- **Don't** invert or lighten a picture area, or the QR code, to match the light theme.
