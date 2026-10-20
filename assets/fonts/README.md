# Self-hosted title fonts

These are unmodified font binaries from the official [Google Fonts source repository](https://github.com/google/fonts), retrieved on 19 October 2026. The browser loads them from this directory through `client/style.css`; no Google Fonts stylesheet, remote font request, tracker or runtime network dependency is used.

| Local asset | Typeface / use | Upstream file | Licence notice |
| --- | --- | --- | --- |
| `BarlowCondensed-Bold.ttf` | Barlow Condensed Bold (700), sporting title line and selected display labels | [Google Fonts / Barlow Condensed Bold](https://github.com/google/fonts/blob/main/ofl/barlowcondensed/BarlowCondensed-Bold.ttf) | `../licences/BARLOW-CONDENSED-OFL.txt` |
| `CormorantGaramond-Italic.ttf` | Cormorant Garamond Italic, variable weight 300–700; title uses 600 | [Google Fonts / Cormorant Garamond Italic](https://github.com/google/fonts/blob/main/ofl/cormorantgaramond/CormorantGaramond-Italic%5Bwght%5D.ttf) | `../licences/CORMORANT-GARAMOND-OFL.txt` |

Barlow copyright: 2017 The Barlow Project Authors, [jpt/barlow](https://github.com/jpt/barlow). Cormorant copyright: 2015 the Cormorant Project Authors, [CatharsisFonts/Cormorant](https://github.com/CatharsisFonts/Cormorant). Both font files are distributed under the SIL Open Font License, Version 1.1. Their complete upstream copyright and licence notices are bundled in `assets/licences/`. The Cormorant filename is simplified locally; its binary data, embedded family names and variation axes are unchanged.

The condensed sans and italic serif contrast uses the existing ivory and amber brand colours. Standard UI copy retains the system sans-serif stack for compact controls and readability. `font-display: swap` keeps the title visible while local fonts load; suitable system fallbacks are declared. The build copies the complete `assets` directory into `dist/assets`, including both fonts and licence notices.
