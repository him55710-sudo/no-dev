# Share the actual workflow

The current **0.7 system design walkthrough** follows an actual external-app permission change, its checks, apply and undo, with a separate deliberate missing-server-guard failure. [Open the guide](SYSTEM_WORKSPACE_DEMO.md) for the local page and source evidence. It is included in source/demo archives; hosted deployment is separate.

## Earlier single-file video

[Watch with English captions](https://him55710-sudo.github.io/pureobom/demo.html) · [한국어 자막](https://him55710-sudo.github.io/pureobom/demo.html?lang=ko) · [MP4](https://him55710-sudo.github.io/pureobom/media/pureobom-30s.mp4)

The 30-second video is an edited sequence of real browser screenshots from the public **0.5.1** build, captured on 2026-10-16. It is not continuous screen recording, a completion-time benchmark, a customer recording or an animation of functionality that has not been implemented. Pauses allow viewers to read. There is no audio; both WebVTT caption tracks and a full text walkthrough are available.

## What was actually done

1. Opened the shipping example with English explanations.
2. Inspected the original `freeShippingThreshold = 50000` source.
3. Selected the rule from its source-linked story and previewed `70000`.
4. Replaced one suggested input with `60000` and compared seven inputs. Three changed, zero were unavailable. `60000` changed from `0` to `3000`; `70000` remained `0`.
5. Applied the edit and inspected `freeShippingThreshold = 70000` in the actual source view.
6. Used session-history undo and inspected `50000` in the source again.
7. Opened the real VS Code installation guide.

The comparison was repeated after undo to capture a view with both important rows visible. The screenshot pixels were not repainted or supplied with invented results. The MP4 encoder pads the original odd-width frame by one pixel to meet H.264's even-dimension requirement.

## Assets and use

- `public/media/pureobom-30s.mp4`: H.264, 30 seconds, 24 fps, 478,777 bytes at initial publication.
- `public/media/pureobom-30s.en.vtt` and `.ko.vtt`: matching English/Korean captions.
- `public/media/demo-poster.png`: an unmodified screenshot of the real explanation and proposed change.
- `public/demo.html`: accessible player, language choice, transcript, direct demo/install/source links. The video does not autoplay.
- Root demo and player pages contain Open Graph metadata pointing to the public poster. This supplies preview data; individual platforms may cache or choose a different rendering.

Share the player URL when captions and context matter. The MP4 can be downloaded for a maintainer-authorized post. Keep the disclosure that this is an edited browser screen sequence. The main product is the VS Code extension; the video shows its browser companion, which uses the same core engine.

No community post or participant outreach was made while preparing these assets. [Launch drafts](LAUNCH.md) remain drafts. This video is a demonstration, not evidence of product demand or understanding gains.

## Verification

The static page was checked in the browser: the MP4 reached ready state 4 with no media error, and playback/pause displayed the actual comparison frame with the matching Korean and English captions. The transcript expanded, the language links changed the content and active caption track, and the main call to action opened the working shipping demo. At a 390×844 viewport override, clientWidth and scrollWidth were both 375px. The production build passed. These are delivery checks, not user-study results.

## Updating the recording

After a meaningful product change, repeat the steps above through the actual UI. Capture the start, source, story, diff, comparison, applied source, undone source and installation guide. Keep displayed outcomes consistent with the caption text. Encode those frames for 2, 3, 4, 4, 6, 4, 3 and 4 seconds respectively; update both caption files and the transcript if the flow changes. Verify playback, seeking, captions, mobile layout and direct links before replacing the published media.
