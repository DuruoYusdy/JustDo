# Local speech input and output

JustDo provides offline speech-to-text and text-to-speech on Windows x64. Speech
is opt-in. The installer contains only the sherpa-onnx `v1.13.7` runtime; model
weights are downloaded after the user enables a feature in Settings > Voice.

The curated catalog contains:

- Whisper Tiny INT8 for the smallest general Chinese/English input download;
- Whisper Base INT8 for higher-quality multilingual input;
- SenseVoice Small INT8 for Chinese-first meetings, punctuation, Cantonese,
  English, Japanese, and Korean;
- Kokoro-82M v1.1 INT8 for natural Chinese/English output and 103 speakers;
- AISHELL3 VITS for compact Chinese output and 174 speakers;
- Piper Lessac INT8 for compact US English output.

All models reuse the bundled sherpa-onnx runtime. Every downloadable archive
includes its corresponding model or training-data license notice.

The reproducible release artifacts currently measure:

| Model | Download |
| --- | ---: |
| Whisper Tiny INT8 | 52.7 MiB |
| Whisper Base INT8 | 83.4 MiB |
| SenseVoice Small INT8 | 148.2 MiB |
| Kokoro-82M INT8 | 137.6 MiB |
| AISHELL3 VITS | 26.0 MiB |
| Piper Lessac INT8 | 20.2 MiB |

## User flow

1. Open Settings > Voice.
2. Choose an input/output model and audio source.
3. Enable Voice input or Reply reading.
4. JustDo downloads the selected model and shows progress and download size.
5. The archive size and SHA-256 digest are checked, then it is extracted to
   `<userData>/local-speech-models/<model-id>` using staging and atomic replace.
6. Once ready, the composer capture/import control or reply-reading control is
   available.

Partial downloads and staging files are removed after success or failure. A
complete existing model is reused. Voice audio and transcripts stay local.

Voice input can use the default or a selected microphone, Windows system
playback, microphone and system playback as separate tracks, or a browser-
decodable audio/video file. System playback uses Electron's Windows loopback
capture and therefore records the complete system output mix, not one external
process. The display video track required by Chromium is discarded immediately.

Meeting mode restarts each recorder at the configured 15-60 second boundary and
queues local transcription while capture continues. Microphone segments are
labelled "Me" and system segments "Meeting audio" with elapsed timestamps. This
distinguishes the local participant from remote playback; it does not perform
remote-speaker diarization. Imported files are decoded locally and transcribed
in the same bounded WAV segments.

## Internal update server layout

Model downloads use the same base URL as application updates. Given this
configuration:

```json
{
  "feedUrl": "https://updates.example.test/electron-app-update",
  "speechModels": { "path": "speech-models/v1" }
}
```

publish the complete generated directory:

```text
https://updates.example.test/electron-app-update/speech-models/v1/
├── manifest.json
├── kokoro-int8-multi-lang-v1_1.tar.zst
├── sherpa-onnx-whisper-tiny.tar.zst
├── sherpa-onnx-whisper-base.tar.zst
├── sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09.tar.zst
├── vits-icefall-zh-aishell3.tar.zst
└── vits-piper-en_US-lessac-medium-int8.tar.zst
```

The files must be served as ordinary binary downloads. Do not apply HTTP
`Content-Encoding: zstd`; the application performs decompression itself. The
download uses Electron's main session, so app proxy and certificate behavior is
shared with application updates.

`manifest.json` is generated beside the archives and supplies the exact byte
length and SHA-256 digest for every published model. The client accepts entries
only for compiled-in model IDs and filenames; server-provided commands and paths
are never executed. The current six models also retain embedded integrity
metadata, so they remain installable from an older server that has no manifest.

Run these release-engineering commands before publishing:

```bash
npm run setup:local-speech-models
npm run build:local-speech-model-artifacts
```

Upload `build-speech-models/speech-models/v1` without modifying any generated
file. A model revision must use a new ID and filename; never replace bytes under
an existing filename.

## Runtime ownership

The Renderer captures or decodes audio and encodes mono PCM16 WAV segments. Main
selects the downloaded Whisper or SenseVoice command layout and returns editable
draft text; it never sends the message automatically. Completed assistant
replies invoke OpenClaw's `tts-local-cli` provider with the selected Kokoro or
VITS layout. Generated speech is not persisted in the transcript or Redux.

Capturing one named external process is intentionally not part of this web-media
path. It requires a Windows-native WASAPI Process Loopback companion, PID/window
selection, and Windows 10 build 20348 or newer. That remains a separate Windows-
only extension rather than presenting whole-system capture as per-app capture.
