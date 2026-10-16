# Kuji paper recording provenance

Both recordings were published under CC0 1.0 Universal. License and creator
pages were checked on 2026-10-16. Commercial use, editing and redistribution
are permitted: https://creativecommons.org/publicdomain/zero/1.0/

1. `soft-tear.wav` by birdOfTheNorth, published 2021-12-30:
   https://freesound.org/people/birdOfTheNorth/sounds/613295/
2. `Paper Rustle` by BenjaminNelan, published 2016-08-31:
   https://freesound.org/people/BenjaminNelan/sounds/353125/

The bundled excerpts are decoded from the public HQ previews, downmixed to
mono 44,100 Hz / PCM16. They are real paper recordings, not recordings of a
specific Kuji brand or ticket. No voice or music is included.

| Source excerpt | Recording / interval | SHA256 |
| --- | --- | --- |
| `paper-peel-recording.wav` | soft tear, 0.050–0.210 s | `6c5d3fffaf1abefff3110a47d2e461ce4df76b018c224e13e34f7f707a348401` |
| `paper-tear-recording.wav` | soft tear, 0.240–0.460 s | `38d1b6159796888fcab35a18f21bd8242ff5f81c9a526aab968219d0e9468ce6` |
| `paper-release-recording.wav` | soft tear, 0.400–0.520 s | `65780afe29b240be5c137dbbb7f77c63a21a694689b7038b0f09bf62dd5d7b22` |
| `paper-flutter-recording.wav` | paper rustle, 0.760–1.080 s | `36ff63d8cbfd3aa1ec611073492136a6db5d892629a3c0c4ae12700cef7b6031` |

`scripts/generate-gacha-reveal-sfx.mjs` verifies the source hashes and renders
the four final effects in the parent directory. It removes DC, controls level
and softens the cut edges without adding a synthesized pitch or free-running loop.
