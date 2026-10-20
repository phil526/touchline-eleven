# Touchline Eleven

**Find the space. Own the moment.** An original, playable 3D football exhibition: Northstar Athletic versus Ember Borough at Meridian Ground. Full 11-a-side throughout, offline human-versus-AI and two-human authoritative online rooms. Built as a compact prototype, with procedural art rather than commercial player assets.

**Play:** [Touchline Eleven](https://touchline-eleven-meridian-261019.smart-brush-7237.chatgpt.site/) · **Source:** [private GitHub repository](https://github.com/phil526/touchline-eleven).

The October 20 update adds **ball rolls, body feints and fake shots**, **manual penalty goalkeeping with a repeatable keeper drill**, and **shot maps with outcome-based feedback**.

| New action | Keyboard | Controller | Touch |
|---|---|---|---|
| Ball roll | V | D-pad left | Roll |
| Body feint | B | D-pad up | Feint |
| Fake shot / cancel charge | N | D-pad down | Fake |
| Penalty keeper direction | A/D for screen side; W/S for centre | Left stick | Left / Centre / Right |
| Commit penalty dive | Space | B / Circle | Dive |
| Ready for keeper practice | J | A / Cross | Ready |

Skill moves work while carrying the ball in open play. Movement chooses the side; the default is to the player's right. Each takes about half a second and has a short recovery. Defenders can still tackle the ball. A fake shot cancels a charged shot without releasing it.

Manual penalty saves are enabled by default in the browser. Choose the side as seen from behind the taker, then dive as the ball is struck. One committed dive is allowed per penalty. **Settings → Assisted penalty saves** restores automatic keeper decisions. **Practice → Penalty saves** waits for Ready before each attempt and counts real saves.

Open **Shot map & feedback** from the pause menu, **View shot map** after full-time, or **Shot map** in practice. Select a team and an attempt to inspect its player, shot type, power and outcome. Both teams' origins are rotated to attack right for comparison. Goals, saves, misses, blocks and woodwork have distinct symbols. Practice feedback uses the actual result and retains attempts across rounds until restarting/exiting the drill. Match history resets on a new exhibition; at most 512 recent attempts are retained.

The v0.5 update adds hold-and-release short passes and through balls, more deliberate goalkeeper positioning with bounded physical save contact, and repeatable offline shooting and slide-tackle drills. An original blue, silver and red stadium title screen introduces the game. The visible Third person follow camera, shot guide, sliding challenges and short goal replays remain, alongside close control, cushioned first touches, coordinated support runs and approximate planted-foot animation. Hold **Ctrl**, controller **LT**, or the touch **Control** button while in possession for close control.

The latest update adds **finesse shots** (Z + Space / RB + B) and **chip shots** (X + Space / LT + B), with a touch shot selector, named power meter and a curved or lofted flight guide. Choose the shot, hold Shoot to charge, and release. Finesse trades pace for placement; chips can clear a keeper away from the goal.

Timed **headers, volleys and clearances** now reward well-timed arrivals from crosses and corners, with jumping and volley animations. Tap Shoot for an aerial finish; use C / R3 / the contextual Clear button to clear upfield. **Settings → Customize touch controls** opens a drag-and-resize editor. Automatic graphics adjustment lowers detail and resolution under sustained load while preserving all 22 players.

Human **free kicks, throw-ins, goal kicks, corners and penalties** now wait for your input. Aim with movement or the stick; hold and release Pass/Through or Shoot. Charge stays at maximum until release. Throw-ins use Pass for a shorter throw and Shoot for a long throw. AI restarts remain automatic.

The control update increases acceleration by 30%, adds stronger directional braking, and tightens normal dribbling and first-touch cushioning. Close Control now moves at 80% of normal speed and automatically shields the ball from nearby pressure, with a visible body pose and SHIELDING indicator. Hold Ctrl / LT / touch Control to use it. Human penalties also wait for a fresh input: aim toward a goal corner and release Shoot to take the kick.

Players now use smoother anatomical models in matches and penalties: shaped jerseys, tapered limbs, connected shorts that bend with the legs, rounded football boots, facial details and three hair shapes. Close cameras use more detail; broadcast distance uses lighter versions of the same models. Both teams and goalkeepers retain their existing kits and animations.

Goalkeepers now dive with their whole body, reach toward released shots and visibly gather catches or punch harder shots clear. Caught balls stay between their gloves, and Penalty Practice lets the save and landing play out before resetting. The penalty camera stays for the save follow-through.

Midfielders and forwards receive a **30% movement burst for 1.5 seconds** when they gain possession in open play. The player panel displays **BURST +30%**. The burst ends if possession is lost or play stops, does not refresh on ordinary dribbling touches, and applies equally to both teams. Defenders and goalkeepers retain their usual movement speed.

## Start locally

**Fastest way to play the delivered build:** unzip the source archive, open a terminal in `touchline-eleven`, run `node scripts/preview.mjs`, then open **http://localhost:5173**. This uses the included prebuilt client and requires only Node.js; no package installation or multiplayer server is needed for offline play.

Install **Node.js 22 or newer** with npm. From this project folder:

GitHub contains the source, assets, tests and documentation. Generated `dist` and installed `node_modules` are excluded from Git; run the build below after cloning. The downloadable source ZIP also includes a prebuilt `dist`.

```sh
npm ci
npm run build
npm start
```

Open **http://localhost:8787**. The same process serves the complete client and the multiplayer WebSocket endpoint. Choose **Play exhibition**, select a club, difficulty, duration and mentality, then **Take to the pitch**. The first launch needs dependency downloads; the built game itself has no CDN, external font or asset requests.

For a client-only preview, run `npm run dev` and open **http://localhost:5173**. Offline play runs entirely in the browser and does not need the authoritative multiplayer server. The static client still needs an HTTP origin; opening `index.html` using `file://` is not supported by ES modules. The archive includes `dist`, so `python -m http.server 5173 --directory dist` can serve the prebuilt offline game without Node dependencies. A multiplayer server remains necessary for online mode.

| Command | Purpose |
|---|---|
| `npm ci` | Install exact dependencies from package-lock.json |
| `npm run dev` | Build and serve client on port 5173; restart after source edits |
| `node scripts/preview.mjs` / `npm run preview` | Serve the included prebuilt offline client; no package installation needed |
| `npm run server` / `npm start` | Authoritative server and built client on port 8787 |
| `npm test` | Simulation, AI, ball-control, passing, shooting, goalkeeping, practice, replay, animation, camera and real WebSocket tests |
| `npm run build` | Produce self-contained `dist` |
| `npx playwright install chromium` | Install optional browser test runtime |
| `npm run test:browser` | UI, keyboard, emulated controller/touch and two-browser checks; builds must be current |
| `node tests/gameplay-browser-smoke.mjs` | Receiver preview, passing, close control, input release and camera regression checks |
| `node tests/practice-browser-smoke.mjs` | Practice setup, shot/slide attempts, feedback, reset, pause and exit checks |

The browser smoke script starts and closes its own temporary server. `BROWSER_EXECUTABLE` can select an installed Chrome/Edge executable; `QA_OUTPUT` selects its output folder. An optional `PLAYWRIGHT_MODULE` file URL selects an already-installed Playwright package. These are test configuration, not game runtime requirements.

## A second player

1. Run `npm start` once. Open http://localhost:8787 in two independent browser windows or profiles.
2. First player: **Play with a friend → Create a room**. The default server address is `ws://localhost:8787/ws`.
3. Second player: enter the same server address and the six-character room code, then **Join**. Alternatively use **Copy invite**.
4. The host chooses their club and duration. Each participant chooses their own mentality. Any change clears readiness. Both select **Ready to play** to start.
5. Each controls one team; all other footballers run AI. Only mutual agreement starts a rematch. An online menu never pauses the server.

For another computer on your LAN, use the host's LAN address, for example `http://192.168.1.20:8787` and `ws://192.168.1.20:8787/ws`, on both devices. The standalone service binds to `0.0.0.0`; allow inbound TCP 8787 in the host firewall if required. A `localhost` invite only points back to the receiving device, so use the LAN or deployed address when sharing across computers. Gamepad availability over plain LAN HTTP varies by browser; HTTPS is preferred for device features.

Disconnects reserve a slot for 20 seconds and allow token-based reconnection in the same page. The server continues, with AI fallback for the disconnected participant. Expiry or leaving ends the exhibition with a departure result and preserves its actual score. Reloading loses the in-memory token: return to the menu if the server has restarted or the rejoin window expired. Invalid/full rooms and unavailable servers display errors.

## Deploy

**Static offline client:** publish the contents of `dist` on an HTTPS static host. All rendering and offline simulation files are included. A static host does not contain a persistent Node multiplayer process. The hosted offline client is available at [Play Touchline Eleven](https://touchline-eleven-meridian-261019.smart-brush-7237.chatgpt.site). The game is publicly playable; the GitHub source repository is private.

**Multiplayer:** deploy the entire source to a host that supports a persistent Node process and WebSocket upgrades. Run `npm ci --omit=dev`, `npm run build`, then `npm start`. Use one process for this prototype. Rooms are in memory; restarting the process closes them. Do not distribute connections across independent workers without room-aware routing.

Copy `.env.example` to `.env` and adjust the port, binding and trusted browser origins. Start with `node --env-file=.env server/index.js` to load it. No private keys or accounts are needed. Example:

```dotenv
PORT=8787
HOST=127.0.0.1
ALLOWED_ORIGINS=https://football.example,https://your-static-client.example
```

Terminate TLS at a reverse proxy. A minimal Caddy configuration on a correctly configured domain is:

```caddyfile
football.example {
    reverse_proxy 127.0.0.1:8787
}
```

This forwards HTTP and WebSocket upgrades. With another proxy preserve `Upgrade`/`Connection`, use an idle timeout above 30 seconds, and route `/ws` to the process. Open `https://football.example`; the same-origin server address is `wss://football.example/ws`. When client and server are on different origins, enter the server's `wss://` URL in the online screen and include the client origin in `ALLOWED_ORIGINS`. HTTPS pages cannot use insecure `ws://` endpoints. Use process supervision and host-level connection limits for a deployment. Public online hosting, load capacity and internet play are not certified by local tests.

## How the match works

The default six active real minutes represent 90 football minutes: 15 displayed seconds per active second. Each half lasts three active minutes. Goals, dead balls and half-time stop the active clock; restart setup and human aiming time mean wall-clock duration is longer. Teams change ends; sideline cameras keep their orientation, while Third person turns towards the new attacking end. Exhibition draws stand. Restart positioning and takers are automated. Human free kicks, throw-ins, goal kicks, corners and penalties then wait for a fresh action, with movement controlling direction rather than moving the taker. AI restarts, including AI penalties, remain automatic. There is no complex set-piece editor. Offside is judged at a team-mate's release and penalised on receiving involvement, with a visible reason. Standing and sliding challenges award fouls for geometric opponent contact before the ball, with penalties inside the defender's area.

WASD or arrows move and aim; hold and release J for a pass, K for a through ball, or Space for a shot. Quick taps still work. L lofts, Shift sprints, Ctrl jockeys, E performs a standing tackle, F slides, Q switches and Esc opens the match menu. Controller A / Cross and Y / Triangle charge passes and through balls; X / Square lofts with possession and slides while defending, while RB / R1 remains a standing tackle. Touch Pass and Through also charge; Pass becomes standing Tackle while defending, and Slide has its own button. Full tables are in [docs/CONTROLS.md](docs/CONTROLS.md) and the in-game Controls screen. Sprinting uses recoverable stamina and pushes the ball further ahead. Hold Ctrl, LT / L2 or touch Control while in possession for tighter dribbling. The gold diamond and dotted line preview the intended pass recipient. In open play, passing charge adds pace and through-ball lead, reaches its cap after 0.75 seconds and automatically releases. Manual restarts hold at the cap until you release. The shared power meter labels the current action. Shot and passing guides use the same intended target calculation as release; accuracy dispersion means they do not guarantee the final result. Touch supports simultaneous pointers and a landscape prompt.

Choose **Practice** on the title screen for **Shooting & aim** or **Slide tackle timing**. Shooting repeats a clear chance against the goalkeeper; slide practice brings a carrier towards your defender so you can learn ball-first contact. Both use the normal movement, aim and action controls, display an objective and attempts/successes, then reset after the actual outcome. **Restart drill** clears the counters and **Exit practice** returns to the title. Practice is offline, keeps its score and statistics separate from exhibitions, and shows no match result or goal replay.

Settings provide Broadcast, Telebroadcast and Third person views, height and zoom for all cameras, third-person field of view, three graphics levels, shadows, reduced camera motion and separate master/effects/crowd levels. Third person keeps your avatar visible from behind and above; drag or use the right stick to orbit, then move relative to that view. Saved First person preferences migrate automatically. Open Camera & settings from the match menu to change your view. Quit game confirms before ending the session; it stops gameplay and audio and lets you return to the title screen.

Goal replays use a bounded four-second visual history sampled at up to 20 Hz. Up to three seconds of action play in at most 2.6 seconds during the existing three-second goal break. Skip with the button, Space, Esc, A / Cross or B / Circle. The simulation and online authority continue, the HUD keeps the live score, and playback ends immediately when live play leaves the goal phase. Replays do not mutate match state or consume gameplay random numbers.

## Project map

| Path | Responsibility |
|---|---|
| `shared/` | Fixed-step simulation, rules, ball geometry, AI and original teams/attributes |
| `client/main.js`, `index.html`, `client/style.css` | Menus, match lifecycle, HUD, radar, preferences |
| `client/input.js` | Device-independent action layer and focus handling |
| `client/render.js`, `client/animation.js` | Stadium, camera, original assets and articulated animation |
| `client/audio.js`, `client/match-sound.js`, `client/sound-synthesis.js` | Layered audio, camera-relative mixing, event deduplication and volume buses |
| `client/network.js` | Input transport, snapshots, interpolation and bounded visual prediction |
| `client/replay.js` | Bounded visual goal history, interpolation, playback and skipping |
| `client/practice.js` | Isolated shooting and slide drills using the real match simulation |
| `client/title.css`, `assets/title-stadium.svg` | Original blue/silver/red title composition and editable stadium illustration |
| `server/index.js` | Authoritative ticks, HTTP, room/session validation and cleanup |
| `tests/` | Simulation, networking and browser smoke checks |
| `scripts/` | Build and static preview |
| `docs/` | Design, rules, art, controls, protocol, verification and limitations |

Open `/?debug=1` to enable the development timing/possession overlay. F2 toggles collision rings and AI targets. `/?debug=1&autoplay=1` starts a short AI-versus-AI exhibition. Debug mode also exposes `window.__T11` to the browser smoke script; normal launches do not. Offline time advancement is a test seam and cannot manipulate the online authority.

## Delivered scope and next work

Read [docs/DESIGN.md](docs/DESIGN.md) for the initial design and technology comparison, [docs/VERIFICATION.md](docs/VERIFICATION.md) for executed checks, [docs/LIMITATIONS.md](docs/LIMITATIONS.md) for honest scope, and [ASSETS-LICENCES.md](ASSETS-LICENCES.md) for asset provenance. Original source and procedural art are MIT licensed. The self-hosted stadium crowd recordings are credited to Gregor Quendel under CC BY 4.0; see `assets/audio/CREDITS.md`. Three.js and ws retain their own MIT notices; optional Playwright is Apache-2.0.

Most valuable next improvements: physical controller/mobile playtesting; stronger goalkeeper and attacking decision tuning; smoother prediction under jitter; foot-contact animation and mobile GPU optimisation. No progression, purchases, accounts or commercial club content is planned for this exhibition prototype.


The first sound-design pass adds four contact variations for passes, shots, finesse, chips, headers, volleys and clearances. Sound intensity follows power; actual contact determines the cue. Stereo placement follows the camera, with distance attenuation in Third person. Real stadium ambience builds as attacks approach goal, with gasps for close misses/woodwork, applause for saves and an extended goal reaction. Kick-off, fouls, offside, half-time and full-time have distinct whistle patterns; ordinary throw-ins/corners do not whistle. Replays do not repeat the live goal reaction. Existing Master, Effects and Crowd sliders control the whole mix and retain their saved values.


Scoring now includes buffered first-time ground shots (tap Shoot just before a pass arrives), more consistent clean finishing inside the box, and optional close-range shooting assist in Settings. One-twos use R, controller LB + A, or touch Control + Pass: the passer runs forward, you control the receiver, and you choose the return pass. See `docs/CONTROLS.md` for timing and cancellation details.

### Penalties and throw-ins

Penalties at either end automatically switch to a view behind the taker. Move the goal target left/right and up/down with WASD/arrows or the movement stick, hold Shoot for power, and release. The target stays where you leave it; the previous camera returns after the kick. Your penalties wait for input, while AI penalties remain automatic.

For repeated kicks, choose **Practice → Penalty Practice → Start drill**. Attempts and goals are counted, with goal/save/miss feedback and an automatic fresh setup. Restart clears the counters and Exit returns to the menu.

Touchline restarts now use two-handed overhead throws with an airborne trajectory for both human and AI takers. Corners and goal kicks remain foot deliveries.
