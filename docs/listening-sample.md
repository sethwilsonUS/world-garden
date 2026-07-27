# Homepage listening sample

The homepage sample is a versioned, static MP3 so a visitor can hear Curio
Garden without first searching, signing in, or waiting for audio generation.
The browser preloads only the file metadata so the native controls can show its
short duration; playback begins only after the visitor presses play.

## Transcript

> Welcome to Curio Garden. A Wikipedia article becomes a listening path: start
> with the summary, choose any section, or play the whole article in order. The
> page keeps its headings, links, and sources, so you can listen without losing
> the structure that makes curiosity useful.

This is original product copy, not an excerpt from Wikipedia. The page presents
the same text as a visible transcript and identifies the audio as synthetic
speech.

## Generation

The checked-in file
`public/audio/curio-garden-listening-sample-edge-v1.mp3` uses Curio Garden's
standard public voice, `en-US-AriaNeural`, through the locally installed
`edge-tts` runtime:

```sh
mkdir -p public/audio
.edge-tts-venv/bin/edge-tts \
  --voice en-US-AriaNeural \
  --text "Welcome to Curio Garden. A Wikipedia article becomes a listening path: start with the summary, choose any section, or play the whole article in order. The page keeps its headings, links, and sources, so you can listen without losing the structure that makes curiosity useful." \
  --write-media public/audio/curio-garden-listening-sample-edge-v1.mp3
```

If the voice or transcript changes, generate a new versioned filename and
update `HOME_LISTENING_SAMPLE_URL`. Versioning prevents an older service-worker
cache entry from masking a changed sample.
