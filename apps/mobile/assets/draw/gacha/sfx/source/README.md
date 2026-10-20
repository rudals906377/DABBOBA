# Gacha crank recording provenance

- Creator: いとーしゅーとのTOY BOX.
- Source: https://www.youtube.com/watch?v=yxRstg6O2js
- Published: 2021-11-08.
- Recording: the creator identifies a Yujin Slim Boy capsule machine.
- Permission checked 2026-10-16: the creator's description explicitly says
  `無料、ご自由にお使いください。` (free; please use freely), excluding illegal uses.
  This is the author's written free-use permission, not a CC0 designation.
- Bundled source: 2.080–2.280 s of the crank operation, converted to mono
  44,100 Hz / PCM16. No full video or speech is bundled.
- Source WAV SHA256:
  `98d7d81d37f0eb83f33d01714e0c1797800c9801a8941b34e8ee574dddb65a06`.
- Derived effect: `../gacha-lever-ratchet.wav`; regenerated offline by
  `scripts/generate-gacha-reveal-sfx.mjs`. DC removal, bounded level, 3 ms attack
  and a short release preserve the recorded gear texture. No pitch synthesis.

Additional excerpts from the same permitted recording:

| Source | Interval | SHA256 | Derived effect |
| --- | --- | --- | --- |
| `gacha-coin-recording.wav` | 0.820–1.100 s, coin insertion/drop | `3016eab302b3e59d46ed3df27b6a8d4c79ef6d837a0e6af30866d33e403bb015` | `../gacha-coin-drop.wav` |
| `gacha-capsule-roll-recording.wav` | 2.720–3.200 s, capsule rolling/rattling through the dispenser | `7b892bf5a217faef20767003e2cf07514a2197449a58868e7427c4d786b4b824` | `../gacha-capsules-rattle.wav` |

These finite effects use the same level/DC/cut treatment and offline generator.
The capsule recording is a real dispenser roll, not an isolated recording of
every capsule inside the chamber; it accompanies the visible chamber impulses.

The owner's three reference Shorts are analysis references only. Their audio is
not included in this repository or the app.
