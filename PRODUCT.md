# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Angular (standalone, signals, OnPush) for the Regie (control room) and the sender PWA, ASP.NET Core (.NET 10) with SignalR as the API, LiveKit as the WebRTC SFU, PostgreSQL as the database. Everything runs in one Docker Compose stack on a Linux server or locally with Docker; data lives in volumes and there are no cloud services. The current Regie design is a clickable HTML prototype under `prototype/`.

## Users

- **Regie operator (primary):** one person, at most two at the same time, internal to OPTEN. Works on site during a webinar on a 14–16 inch laptop in normal room light, builds scenes beforehand and switches between them during the broadcast.
- **Speakers:** share one or more screens from their own laptop through the sender page in the browser.
- **Camera phones:** permanently mounted smartphones that act as cameras through the sender PWA and run unattended once set up.
- **Output consumer:** a proxy opens the output page (16:9, as an iframe) and distributes the picture to about 30 people.

## Product Purpose

StudioFlow is a web-based control room modelled on OBS, for webinars. Browser clients send camera and screen with the lowest possible latency, the Regie composes scenes from them (layout templates plus free moving, scaling and cropping), and a fixed 16:9 output delivers the program as a web page.

Success means: setup is quick, switching is safe, and no source failure goes unnoticed.

## Positioning

Everything runs in the browser and on your own server: phones and laptops become sources without installing an app, the program is an embeddable web page, and the whole stack starts with `docker compose up`. It needs neither an OBS machine nor cloud services.

## Operating Context

- On site, all devices on the same Wi-Fi; the server runs locally (a PC with Docker) or as a VPS under the operator's own control.
- Before the webinar: pair devices (phones by QR code, laptops by short URL with a code and approval, or by invite link) and build scenes.
- During the webinar: take a scene live with one click or, with Studio Mode on, check it in the preview first and send it to the program with Take.
- Audio runs outside StudioFlow through a mixing desk; the architecture stays prepared for audio.
- Terms from OBS and broadcasting: scene, source, item, preview, program, take, tally, slate, fallback.

## Capabilities and Constraints

- Sources: camera, screen (several per laptop), image, video; later text, overlays and web pages.
- Output: fixed canvas of 1920 × 1080, always 16:9, embeddable as an iframe, without controls.
- Latency target on site: about 0.15 s glass to glass (estimate, not yet measured).
- Login: one admin account from appsettings or `.env`, no SSO.
- Stability: automatic reconnect without limit; sources return to their place in the scene through device ID and slot.
- Regie workspace like OBS: docks (Scenes, Sources, Properties, Stations) can be arranged freely, resized and hidden; the layout is stored per browser.
- Fonts and assets come from the project's own build, without external CDNs, because the Regie runs on the LAN.
- Multi-tenancy is provided for in the data model; for now only OPTEN uses the system.
- Later, not now: restream, recording, audio in StudioFlow, public air mode for viewers without a proxy.

## Brand Commitments

- Name: StudioFlow.
- A standalone tool with its own look, not bound to the OPTEN website corporate design.
- Interface language: English by default; German (Switzerland) as the first translation; follows the user setting, browser language by default; Swiss spelling with ss, « », decimal comma.

## Evidence on Hand

No real content, customer data or screenshots. Sample content in designs (names of people, slides, camera images) is synthetic and must be labelled as such. Architecture and plan: https://claude.ai/artifact/FKKxDiTsDcu2nfYqfEQRGP

## Product Principles

1. Failures are visible immediately: every source shows its state where you are already looking.
2. Setup in minutes: pairing, building scenes and applying layouts take as few steps as possible.
3. Switching like OBS: without Studio Mode a scene goes live with one click. With Studio Mode you build in the preview, and only what is sent with Take goes live. A fade always runs to the end; there are no half mixes.
4. Terms and workflows come from OBS, so nobody has to relearn anything.
5. On an interruption everything keeps running: a freeze frame instead of a black picture, reconnect without any action.
