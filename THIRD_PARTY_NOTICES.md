# Third-Party Notices

This repository does not vendor Doom engine source code or IWAD game data.

Local files expected by the native bridge:

```text
third_party/doomgeneric/
assets/doom/DOOM1.WAD
```

These files must be supplied by each developer and are governed by their own license or distribution terms. They are not covered by this repository's MIT License and must not be committed.

Package-manager dependencies are resolved through `package-lock.json`, `ios/Podfile`, and `ios/Podfile.lock`. Review dependency licenses before distributing app binaries.
