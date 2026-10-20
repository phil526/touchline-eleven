# Sound direction — first pass

Aim: a natural stadium foundation with clear, tactile football contact. The sound remains subordinate to play and readable on small speakers.

## Contact and referee

`sound-synthesis.js` creates four short, deterministic variations for each contact. A damped ball body is layered with transient boot/glove/turf noise. Passes and chips are lighter, headers have a dull body with little transient, volleys have a sharper snap, and charged shots/clearances have greater weight. The mixer uses power to vary level and playback rate. Whistles combine two resonances, breath noise, flutter and softened envelopes; kick-off/foul are single blasts, offside/half-time use two, and full-time uses three with a longer last blast.

## Crowd and mix

Four stereo MP3 files total approximately 520 KB: a 19-second bed, 11-second anticipation layer, 8.5-second goal cheer and 4.5-second save reaction. Loop boundaries are crossfaded; one-shots have soft edges. The source and adaptation notices are in `assets/audio/CREDITS.md`. A procedural fallback keeps effects and ambience usable if decoding fails. A synthesized diffuse gasp marks close misses and woodwork. Ordinary keeper collections do not receive save applause.

Two continuously running ambience layers are bounded. At most 18 one-shot voices may exist, with six slots reserved beyond the ordinary effect limit for whistles and major reactions. Lesser crowd reactions are throttled and suppressed under a goal cheer. No per-frame audio-buffer creation, no remote runtime asset fetches and no simulation RNG changes. The mixer compresses combined peaks and softly limits the output before the saved master level. Effects and crowd have independent gain buses; zero volume is initialized directly to prevent a startup leak.

The broad broadcast perspective uses restrained stereo; Third person uses the current camera orientation and approximate distance attenuation. Menus lower crowd ambience and suppress field effects. Background tabs and Quit suspend playback, with gesture-based resumption. No audio is required to understand a match event.

## Event transport

Simulation output includes a 24-entry `audioEvents` ring with a separate monotonic sequence, tick, pitch position, phase, contact kind and power. This preserves multiple actions between rendered frames/network snapshots without replacing the HUD's latest event. Actual aerial contact emits a header/volley cue; missed timing emits none. A recent shot leaving near the goal mouth emits an audio-only near-miss record while normal restart logic remains intact.

`match-sound.js` consumes live authority once per sequence, discards events older than half a simulation second, drains paused/hidden/menu events without replaying them, and resets for a new match. Visual goal replay snapshots never feed the director. Half-time transition events are filtered by phase so the second-half setup cannot repeat the half-time whistle. Kick-off whistles follow phase entry; ordinary throw-ins, corners and goal kicks have no generic whistle.

The first pass is not a physical-device listening certification. Remaining work includes subjective mix tuning with players on headphones/phone speakers, actual iOS interruption tests, and longer playtesting of reaction variety.
