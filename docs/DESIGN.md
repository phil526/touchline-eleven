# Touchline Eleven — prototype design

Written before implementation, 19 October 2026. UK English. An original football exhibition built around the space between players: move the defence, find the runner, make the chance. Two fictional clubs meet under the lights at Meridian Ground.

## Technology decision

| Stack | Rendering and characters | Physics and shared authority | Input/mobile | Delivery and assets |
|---|---|---|---|---|
| Three.js, JavaScript, Node + ws (chosen) | Explicit scene graph; inexpensive procedural articulated humans | One plain JavaScript simulation runs offline and on Node; custom swept ball checks | Native Gamepad and Pointer Events; controllable pixel ratio | Small build; static client plus persistent Node process; MIT renderer and original generated assets |
| Babylon.js + Node | Rich integrated animation/rendering tools | Custom shared JS or separate physics integration | Browser input; scalable engine | More engine API to maintain; Apache-licensed engine, asset licences still separate |
| Godot web + dedicated server | Strong authoring and animation editor | Shared game logic, but separate web/server exports | WebGL2 export, mobile constraints | Larger toolchain; original assets still required |

Choose pinned Three.js 0.180.0 and ws 8.18.3. No front-end framework: semantic HTML menus and ES modules. A small Node build copies modules and renderer dependencies into dist; Node's built-in test runner tests simulation and network invariants. No third-party physics library. Browser clients use the native WebSocket API; ws is server-side. References consulted: https://threejs.org/manual/ , https://github.com/websockets/ws , https://developer.mozilla.org/en-US/docs/Web/API/Gamepad_API/Using_the_Gamepad_API , https://doc.babylonjs.com/ , https://docs.godotengine.org/en/stable/tutorials/export/exporting_for_web.html .

## Pillars, audience and scope

Responsive decisions, visible football shape, trustworthy match state. For casual and competitive players who want a short exhibition. Exactly 22 footballers remain in every match. Priority: simulation, controls, AI, networking, device support, polish. This is a stylised playable engineering prototype with recognisable pitch proportions and broadcast framing, not AAA visual or animation fidelity.

## Match loop

Title → offline/online → team/settings → loading → kick-off → first half → half-time/end change → second half → full-time/results → rematch/menu. Six active minutes by default; each active second advances the football clock by 15 seconds. Dead balls, goals and half-time stop active time. Shorter test-friendly matches are selectable. Draws stand. Offline pause/restart; online match continues when a participant opens a menu. Both online participants must ready and agree to rematch.

## Teams and tactics

Northstar Athletic (NSA): deep blue and ivory, patient support. Ember Borough (EMB): amber and charcoal, slightly more direct. Balanced attributes avoid superhuman differences. Each has eleven named starters, numbered shirts, a goalkeeper and a 4-3-3. Defensive/balanced/attacking mentality changes line height, support positions and pressing numbers. Difficulty changes AI reaction and choice, never physical limits.

## Mechanics

Players accelerate, brake, turn, sprint and jockey. The control update raises acceleration 30%, strengthens braking through reversals and sharp turns, and retains existing top speeds. Close Control has a 20% speed penalty; defensive jockeying retains its original speed. Nearby pressure rotates a controlling player away from the closest defender so the body shields the ball. Standing/slide contact geometry still decides whether the ball is exposed; there is no invulnerability flag. Stamina drains during sprinting and recovers while moving gently; normal movement stays usable. Pace sets top speed, acceleration sets response, stamina sets drain, control sets touch recovery, passing sets dispersion, shooting sets shot accuracy, tackling sets challenge margin, and goalkeeping sets reach/reaction. Assisted dribbling uses a bounded velocity follower with tighter normal targets and quicker turn response; sprinting retains longer touches. First touches cushion more momentum with shorter recovery animation; one owner ID prevents conflicting possession. A free ball, controlled dribble, flight, keeper-held and dead-ball state all use the same ball.

Short, through and lofted passes score receivers by direction, distance and lane obstruction. Through passes lead runs. In open play, shooting charges to a cap then releases immediately, combining aim assistance with power, pressure and player accuracy. Standing challenges require range/facing and have recovery time. Switching favours influence near the ball and its predicted path. Automated receiver switching is allowed, except during committed actions.

## AI and goalkeepers

Formation anchors shift with ball location, possession and mentality. A limited set press; others cover lanes, mark or recover. Attackers spread and provide forward support; defenders retain cover. Ball carriers compare a shot, progressive pass and dribble. Keepers guard the ball-to-goal angle, track incoming shots, catch or parry within finite reach, collect and distribute after a limited hold. No teleport saves.

## Rules and assumptions

105 × 68 metre pitch; 7.32 × 2.44 metre goals. Whole-ball line crossing determines a goal. Last touch determines throw-ins, corners and goal kicks. Offside candidates are recorded at teammate pass release and penalised on receiving involvement; passive interference and deliberate-play interpretations are simplified. A mistimed tackle contacting an opponent without winning the ball can produce a direct free kick, or a penalty in the defender's own box. Taker selection and positioning are automated. Human free kicks, throw-ins, goal kicks, corners and penalties wait for fresh input and release-only charge; AI restarts remain timed. Penalty aim is constrained toward the goal mouth and persists after releasing movement. Headers, volleys and sliding tackles are supported. No cards, advantage, substitutions, injuries, handball or complete official-law compliance.

## Camera, art and sound

Elevated sideline camera tracks active play with bounded smoothing and forward room; camera orientation stays fixed when teams change ends. Screen-right is pitch +x and screen-up is -z. Height and reduced movement options. Procedural proportioned articulated players blend locomotion and kick/tackle/save/celebration poses. Original procedural turf, markings, goals/netting, tiered stands, seats, roofs, technical areas, floodlights and fictional boards; no downloaded likenesses or commercial content. Web Audio contact variations, referee whistle patterns and licensed stadium ambience start only after interaction. Crowd reactions follow live events; anticipation follows attacks. Camera-relative stereo, bounded voices and master/effects/crowd gain controls. See AUDIO.md for the first sound pass.

## Inputs

One action record: analogue movement, sprint, jockey, pass, through, loft, shoot held, tackle, switch. Keyboard uses WASD/arrows, Shift, Ctrl, J, K, L, Space, E, Q and Escape. Standard controller uses left stick, RT, LT, A, Y, X, B, RB, LB and Start. Touch uses an independent pointer-captured stick and large multi-touch buttons. Blur clears inputs; online stale input expires. A full control table ships with the game.

## Online contract

Two humans, one team each. Authoritative Node process runs 60 Hz fixed steps, accepts up to 30 Hz input intentions and emits 20 Hz snapshots. Sequence numbers and per-slot acknowledgements reject replays; clients interpolate about 100 ms behind and predict only the local player's movement with bounded visual reconciliation. Never predict goals or possession. No determinism claim. Token-based rejoin, two-slot room cap, validation, message/rate limits, idle expiry and 20-second reconnect grace. Match continues with neutral input/AI fallback during loss; forfeit/end policy is explicit. HTTPS client uses WSS behind a reverse proxy. Static preview can play offline without any multiplayer process; hosted multiplayer needs a persistent Node service.

## Budgets and acceptance

Aim for 60 fps desktop and 30 fps mobile; these remain targets until measured. Maximum 1.75 device pixel ratio; low/medium/high presets, optional shadows, shared geometry and instanced seats. Simulation never depends on render frame rate. Debug-only timing, possession, phases and target overlays. Acceptance: 22 players, complete end-changing match, goals counted once, coherent restarts, actionable AI, all action devices implemented, two clients agreeing on authority, room rejection/reconnect/rematch tests, production build, source archive and an evidence-labelled verification report. Physical mobile/gamepad and public-network results must not be inferred from local/emulated tests.


### Scoring improvements — 19 October 2026

First-time ground shots use a 0.4-second bounded intention buffer on the selected receiver. The shared simulation checks incoming direction, predicted arrival, pass team and ground height before arming. It executes only within the existing receiving radius, after offside validation and before first-touch damping. It does not attract or teleport the ball. A pending automatic switch can resolve early on a fresh shot request, allowing short-pass combinations during follow-through. Possession also transfers human control immediately, preventing AI from acting on a very short return while the original passer is still in follow-through. Ground and aerial timing remain separate.

Clean finishing reduces dispersion by 40% within 16.5 m of goal and within the penalty-area width, with no opponent within 3 m, facing error at most 45 degrees and no sprint-speed penalty. For these shots, the aim target uses the goal plane. Optional human shooting assist gently adjusts the target towards the selected corner, or evaluates keeper position and obstructed lanes when no side is selected. Full-width aim, charge, trajectory and saves are preserved. The setting travels with validated input, so preview and authority agree online. AI receives the same clean-contact dispersion improvement but retains its existing corner-choice logic.

One-two commands are single pass intentions. A successful pass records the runner, receiver, five-second expiry and forward/lateral target in authoritative match state. The receiver becomes controlled immediately; AI moves the original passer with normal acceleration, stamina, collision and offside rules. Return passes still require input. Receiver selection favours the runner only when directional input aligns; an aimed alternative remains available. Runs are cleared on possession changes, unrelated passes, shots, dead play and expiry. No additional touch button is needed: Control + Pass reuses the existing customizable layout.
