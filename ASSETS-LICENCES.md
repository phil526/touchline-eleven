# Asset and dependency provenance

All stadium geometry, pitch markings, club names, named footballers, kits, crest glyph compositions, ball texture, turf texture, shirt-number atlas, fictional advertising, UI composition, animations and sound synthesis were created for this prototype. They are reproducible from source and bundled under the project's MIT licence. There are no commercial team badges, real player likenesses, music, commentary or stock photographs. The crowd uses the separately licensed, credited recordings listed below.

| Asset | Editable source | Licence / origin |
|---|---|---|
| Meridian Ground and procedural textures | client/render.js | Original, project MIT |
| Footballer meshes and articulated animation | client/animation.js | Original, project MIT |
| Teams, names and attributes | shared/config.js | Original, project MIT |
| Crest/favicon and UI | assets/mark.svg, index.html, client/style.css | Original, project MIT |
| Ball contact, referee whistles, gasp and menu cues | client/sound-synthesis.js | Original synthesis, project MIT |
| Stadium ambience and cheering | assets/audio/stadium-*.mp3 | Free Crowd Cheering Sounds by Gregor Quendel, CC BY 4.0; excerpts, filtered, level-adjusted, faded/looped and re-encoded. [Source](https://opengameart.org/content/free-crowd-cheering-sounds), [licence](https://creativecommons.org/licenses/by/4.0/), full details in assets/audio/CREDITS.md and in-game Settings |
| Title display | assets/fonts/BarlowCondensed-Bold.ttf | Barlow Condensed by Jeremy Tribby; SIL OFL 1.1; official Google Fonts repository |
| Title italic | assets/fonts/CormorantGaramond-Italic.ttf | Cormorant Garamond by the Cormorant Project Authors; SIL OFL 1.1; official Google Fonts repository |
| Remaining typography | CSS system fonts; optional locally installed Bahnschrift | Operating-system fallback fonts are not distributed |
| Three.js 0.180.0 | npm three; https://github.com/mrdoob/three.js | MIT; notice copied to dist/vendor/THREE-LICENSE.txt |
| ws 8.18.3 | npm ws; https://github.com/websockets/ws | MIT; retained in node_modules/ws/LICENSE after npm ci |
| Playwright 1.62.1, playwright-core 1.62.1 | npm playwright; https://github.com/microsoft/playwright | Apache-2.0; optional browser-test tooling, absent from client bundle |

Full exact dependency resolutions and integrity hashes are recorded in package-lock.json. No runtime secrets are in the repository. `.env.example` contains configuration names and local defaults only. All third-party licence files can be inspected in the installed packages; release notices are also copied to assets/licences for a source handoff.

Exact font source URLs and bundled notice paths are recorded in `assets/fonts/README.md`. Both font files are self-hosted; playing the game makes no requests to a font CDN.
