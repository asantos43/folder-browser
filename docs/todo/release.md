# TODO: Packaging, platforms, release and ideas for later

Part of the plan in [`TODO.md`](../../TODO.md) (the index, the performance rule and the roadmap). Open work of this area; what was delivered is in [`history.md`](history.md).

## Packaging, platforms and the release
- [ ] Try the app on **Windows and macOS** (Trash, Open With…, the chooser, icons, packages): everything so far was tried on Linux only
- [ ] Pictures of the application on Windows and macOS for the guide (today only Linux)
- [ ] Try the `.exe` on a Windows machine, and the `.dmg` on a Mac (built and checked, never started by the author)
- [ ] Sign the files (Windows code signing, macOS Developer ID and notarisation, GPG for the `.deb` and `.rpm`): `docs/RELEASING.md`, "Signing"
- [ ] Mark v0.1.0 and v0.1.1 as superseded on their release pages

## Ideas for later
- Hidden attribute of Windows (today only names that start with a dot)
- ZIP64 and other encodings than UTF-8
- Search inside files (see "Text tools", group 5); a terminal here
- External subtitles (`.srt`, `.vtt`) beside a video (see "Video: warnings, tracks, subtitles…"); a playlist that survives closing the tab (see "Playlists")
- Password protection and `.wsnpx` from `docs/VIEWER-GUIDELINES.md`
