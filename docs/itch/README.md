# itch.io 등록 안내

## 업로드 파일 만들기

```bash
npm run pack:itch
```

`release/dusk-kart-itch.zip`이 생깁니다. 압축 루트에 `index.html`이 있고 `dist/`와 같은 파일입니다.

## 프로젝트 설정 (Create new project)

| 항목 | 값 |
|---|---|
| Title | Dusk Kart |
| Kind of project | **HTML** |
| Uploads | `dusk-kart-itch.zip` 업로드 후 **This file will be played in the browser** 체크 |
| Embed options → Viewport dimensions | 1280 × 720 |
| Embed options | **Mobile friendly** 체크(Orientation: Default), **Fullscreen button** 체크, **Automatically start on page load** 끔(클릭해야 소리가 나므로) |
| Classification | Games · Racing |
| Tags | `racing`, `kart`, `3d`, `multiplayer`, `first-person`, `physics`, `threejs`, `webgl`, `procedural` |
| Release status | Released (또는 In development) |
| Pricing | No payments (원하면 Donate) |
| Cover image | [`cover.jpg`](cover.jpg) (630×500) |
| Screenshots | `docs/screenshots/`의 hero, cockpit, chase, rain, rain-chase, courses |

## 게임 동작 메모

- itch.io는 게임을 다른 도메인(itch.zone)의 iframe 안에서 실행합니다. 그 주소는 공유할 수 없어서, itch에서 복사한 **초대 링크는 웹 버전(GitHub Pages) 주소**로 만들어집니다. 두 버전은 같은 방에서 함께 달릴 수 있습니다.
- iframe 안에서는 클립보드 복사가 막힐 수 있습니다. 그러면 로비에 링크 칸이 나타나 직접 복사할 수 있습니다.
- 기록과 설정은 itch.zone 쪽 브라우저 저장소에 따로 저장되므로 웹 버전의 기록과는 공유되지 않습니다.
- 언어는 브라우저 언어를 따라 한국어 또는 영어로 시작하고, 메인 메뉴의 **English / 한국어** 버튼으로 바꿀 수 있습니다.

## 페이지 소개문 (그대로 붙여 넣기)

```
DUSK KART is a browser kart racer filmed through a helmet action cam.

Race at dusk on an outdoor rental-kart track beside the Lumen Park funfair. Look down at the wheel and your gloved hands through a wide-angle lens with barrel distortion and edge motion blur, and race the AI or your friends over 3 laps. No install, no sign-up.

FEATURES
• Helmet action-cam view that leans with lateral G and looks into corners — plus chase and far cameras
• Kart physics, simplified but kart-like: a solid rear axle with no differential, caster jacking, rear-only brakes, a centrifugal clutch and a single-cylinder engine (top speed about 80 km/h)
• 5 original courses, from a 471 m sprint to a 1.15 km enduro
• Dry or rain: less grip, longer braking, rain streaks and drops on the lens
• Quick Race against 5 AI karts that use the same physics as you
• Time Trial with a saved best lap and ghost
• Online races for up to 8 players, browser to browser over WebRTC — no game server
• Three control modes: Easy (steering, braking and wall assists), Normal and Real
• Keyboard, gamepad and touch (phones in landscape or portrait)
• Zero assets: every model, texture and sound is generated in code

CONTROLS
Throttle  W / ↑ · gamepad RT · GAS
Brake / hold when stopped to reverse  S / ↓ / Space · LT · BRAKE
Steer  A D / ← → · left stick · drag on the left half
Camera  C · Y      Back to track  R · Back      Pause  Esc / P · Start

ONLINE
Pick a 5-character room code (or leave it empty for a new room) and share the invite link. Players find each other through public Nostr relays and then connect directly. Strict networks (some office, school or mobile networks) can block direct connections.

Source code (MIT): https://github.com/jeiel85/dusk-kart
```
