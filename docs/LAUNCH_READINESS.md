# Launch readiness — 0.6.0

Checked **2026-10-16 05:50 Asia/Seoul** against the public repository, release, CI, Pages run and local observation sheet. This is a dated readiness audit, not a completed demand study. [Machine-readable public evidence](launch-status-2026-10-16.json).

## What is ready, and what is unproven

| Requirement                             | Evidence                                                                                                                                                                                                       | Status                                          |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Open-source distribution                | Public [MIT repository](https://github.com/him55710-sudo/pureobom), [0.6.0 release](https://github.com/him55710-sudo/pureobom/releases/tag/v0.6.0), four assets matching the previously downloaded checksums   | Available                                       |
| Read, change, check and undo in VS Code | [128 core checks and 16 integration checks](RELEASE_VALIDATION.md), actual installed-extension screenshots, source-linked rules and editor reports                                                             | Verified within the documented supported scope  |
| Public first encounter                  | [Browser demo](https://him55710-sudo.github.io/pureobom/?demo=shipping&lang=en), [captioned introduction](https://him55710-sudo.github.io/pureobom/demo.html), Korean/English instructions                     | Available; conversion is unmeasured             |
| Reproducible release                    | [Windows and Ubuntu CI](https://github.com/him55710-sudo/pureobom/actions/runs/38803845267) and [Pages deployment](https://github.com/him55710-sudo/pureobom/actions/runs/38803845903) succeeded for `d415f8b` | Verified for 0.6.0                              |
| Marketplace installation                | Manifest uses the local identifier `pureobom-local`; distribution is currently a GitHub VSIX                                                                                                                   | Not published                                   |
| Five-person comprehension observation   | [Protocol](USER_STUDY.md) prepared; [observation sheet](user-study-observations.csv) has zero result rows                                                                                                      | No recorded participants/results                |
| Useful changes in real projects         | Zero public issues or pull requests returned, and no recorded own-project observations                                                                                                                         | Unproven; unknown private usage is not measured |
| Voluntary reuse                         | No seven-day actual-reuse observations                                                                                                                                                                         | Unproven                                        |
| Broad demand and 10,000-star ambition   | Public snapshot: zero stars, zero forks                                                                                                                                                                        | Not achieved                                    |

Passing engine tests does not establish whether a nondeveloper understands the explanation. Agent demonstrations, generated examples, downloads and stars do not substitute for independent task completion or reuse. More supported syntax alone cannot resolve those unknowns.

## Marketplace handoff

Microsoft's [publishing guide](https://code.visualstudio.com/api/working-with-extensions/publishing-extension) requires a publisher identity and supports uploading a packaged VSIX through the [publisher management page](https://marketplace.visualstudio.com/manage). The publisher ID becomes part of the extension identity. Confirm the actual owner and ID before changing the manifest; `pureobom-local` is not proof of a registered publisher.

The prepared package is [pureobom-0.6.0.vsix](https://github.com/him55710-sudo/pureobom/releases/download/v0.6.0/pureobom-0.6.0.vsix). Its SHA-256 is `a344d78cfa2608c9da086ce8700210f1194159bffee07536a5b9e61049473d30`. It is verified for direct installation under the current local identity, not ready to upload under an unrelated publisher ID.

Once the intended publisher is known:

1. Match `extension/package.json` to that publisher. Update the identity lookup in the integration test and any installation/migration guidance if the ID changes. Keep the public extension name `pureobom` unless deliberately renamed.
2. Build and test the resulting identity, including fresh installation, source navigation, apply/undo and editor reports. An identity change is a different extension, so existing VSIX users need clear migration instructions.
3. Package a new release from the verified commit. Do not overwrite the already published 0.6.0 assets.
4. The owner completes the required account/publisher setup and authentication. Passwords and publishing tokens do not belong in this repository, issue forms or chat messages. Use the official guide for the current authentication options.
5. After publication, inspect the public listing and install from that listing in an isolated VS Code profile. Only then replace the GitHub-install instructions with the verified Marketplace link.

The current GitHub release can be used for the first pilot while Marketplace ownership is being prepared.

## Next evidence to collect

Use the existing [launch text](LAUNCH.md) and [five-person protocol](USER_STUDY.md). The maintainer chooses a relevant community or a small group of consenting participants and its posting/account context. No community post or invitation has been sent as part of this release.

Start with a single real task per person. Separate browser-demo completion, VSIX installation, an own-project change, and actual reuse. Record both support needed and unsupported cases. Keep contact details and private code out of the public sheet. The next product change should address an observed blocking step; do not turn an empty sheet into a success story or invent testimonials.

The next launch decision is therefore **where to recruit the first five participants and who owns the Marketplace publisher**. The package, examples, introduction, feedback form and observation procedure are ready for that decision.
