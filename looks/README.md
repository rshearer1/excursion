# looks/ — review stills

The only place render output is allowed in git. Each folder is one batch of small JPEGs
(≤ 1080 px wide) plus a `notes.md` naming the scene commit and the sources, so a still can
be assessed from any machine — the work box, a phone — without the renders themselves.

Publish a batch from the home box after a looksheet or a `--test` reel:

```
node scripts/publish-looks.mjs                                  # out/looksheet/*.png
node scripts/publish-looks.mjs --video out/track.mp4 --label "handoff pass 2"
```

`out/` and `frames/` stay ignored. Keep batches to a handful of images; delete old
folders when they stop being useful.
