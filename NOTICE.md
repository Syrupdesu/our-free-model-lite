# NOTICE

This package is a modified derivative of **dsh-our-free-model** by Ebony-Vinyl
and its contributors, licensed under the MIT License:

- Upstream: https://github.com/Ebony-Vinyl/dsh-our-free-model
- Base version: 2.7.2

The MIT copyright notice for the upstream project is retained verbatim in
[LICENSE](LICENSE).

## What was taken

The free-lane implementation: the model adapter, the upstream protocol
(fingerprint, session, SSE parsing), the catalog builder, the Kilo lane, the
availability probe, the model test, the failure classification and the settings
store. These files are derived from the upstream project and were edited to
remove the features listed below.

## What was removed (and why)

- The EAC co-paid lane together with its sealed credentials, signing gateway,
  GitHub OAuth login, star gate and the associated UI. This lane was operated by
  a third party, required a GitHub identity, and enforced a star on the
  upstream repository.
- The "Beichen API" sponsor banner and its affiliate referral link.
- The remote announcement feed, the recommended-projects page, the star
  buttons and the community-group promotion.
- The in-app self-updater and its upgrade page. A self-updater signed by the
  upstream author can replace the code of a modified fork; a fork cannot
  meaningfully inherit that trust root.
- The ten third-party account channels (Qoder, TRAE, Cline, LobsterAI, Loomy,
  Raccoon, MiniMax, ZCode, Gemini and their vendored pack).
- Subscription imports, the aggregate provider registry, fallback chains,
  token savers, the local OpenAI-compatible gateway, the LAN relay, the
  dashboard, the request log and the model workspace.

No upstream code for the removed features remains in this package.
