# Audio assets

Put external audio files here. The runtime supports the common browser formats
`mp3`, `wav`, `ogg`, `m4a`, `aac`, and `webm`.

Recommended layout:

- `assets/audio/music/` — looping/background tracks
- `assets/audio/sfx/` — one-shot effects

Audio paths referenced by `content/audio.json` or Zone JSON must stay under
`assets/audio/` so the build can validate and package them for `dist/`.

You can either register a reusable asset in `content/audio.json` and reference
its `id`, or reference an audio file path directly from a JSON `audio` hook.
