# Model management

Settings > Models is the unified entry for online model configuration. The
language-model panel remains the default and keeps its existing provider UI.
Additional tabs cover online speech recognition, online speech synthesis,
image generation, and video generation.

Offline speech recognition and synthesis models remain under Settings > Voice.
That page owns local model download, removal, and selection. When an online
speech mode is selected, its model selector lists every model from the
corresponding user-created provider catalog. Choosing an item immediately
applies that provider endpoint, credential, and model through the Gateway; the
Voice page does not duplicate provider editing or send the user to a separate
management action.

All online configuration crosses the preload boundary and is handled in Main:

- Speech recognition uses the Gateway `talk.catalog`, `config.get`, and
  `config.patch` methods.
- Speech synthesis uses the Gateway `tts.providers`, `config.get`, and
  `config.patch` methods.
- Image generation reads and writes `agents.defaults.mediaModels.image` through
  `config.get` and `config.patch`. Its endpoint is stored under the isolated
  `models.providers.justdo-image-openai` configuration key.
- Video generation reads and writes `agents.defaults.mediaModels.video` through
  `config.get` and `config.patch`. Its endpoint is stored under the isolated
  `models.providers.justdo-video-openai` configuration key.

The canonical OpenAI providers enter the native `image_generate` and
`video_generate` runtimes with cloned capability-scoped config views. Their
manifest-declared `openai` IDs remain unchanged, while neither media category
mutates `models.providers.openai`; language, image, and video endpoints and
credentials therefore cannot overwrite each other.

Image understanding is a separate OpenClaw capability configured by
`agents.defaults.imageModel`; it must not be conflated with image generation.
The non-language tabs do not display public provider catalogs or pre-populated
models. Their provider collections start empty and are persisted only after the
user adds a provider, its endpoint and credentials, and one or more
models. The current integration targets local endpoints with
capability-specific OpenAI protocols: Realtime transcription WebSocket with
PCMU 8 kHz for speech recognition, `/audio/speech` for synthesis, the Images
generation/edit routes for images, and the Videos submission/poll/download
routes for video. A generic REST transcription endpoint or a provider-specific
media API is not sufficient.

All four custom-provider tabs follow the language-model layout: providers
appear in a left sidebar, provider connection fields appear on the right, and
the selected provider's models appear as editable cards. Users can add, edit,
and remove providers and models, then select a default model. Saving persists
the user-owned catalog locally and applies the selected provider/model to the
Gateway-native capability configuration. No fallback policy is exposed by this
catalog UI.
