# Current best: one shared test scene

Every test render comes from one place, so no test misses another thread's work.

- **Folder:** `D:\Rescue\Kingston\Users-ITSM\excursion-current` (a git worktree of this repo)
- **Branch:** `claude/project-thread-11phqh` (the "current best"; it holds PR #1 rooms/rigs, PR #2 speaker finish, and the look scripts in `blender/stage/`)
- **Command:** from that folder, `node blender/stage/test_still.mjs` (see the top of that file for options)

## Rules for every thread

1. **Render tests only with `test_still.mjs` in the shared folder.** Never from a private `.blend`, a scratchpad copy or a script in `out/`. It rebuilds `void.blend` when speaker sources change and stacks the current look (LED wall with meters, Shakify 30 %, lens, film, print_soft grade).
2. **Work on your own branch, cut from the current best:** `git fetch origin && git switch -c <your-branch> origin/claude/project-thread-11phqh` in your own checkout or worktree. Look changes go in `blender/stage/`; speaker and scene changes go where they already live (`build_scene.py`, `speaker_finish.py`, ...).
3. **Land a change:** push your branch, then in the shared folder run `git pull --no-edit origin <your-branch>` (a merge, no rebase, no force), render one test still there, and push: `git push origin claude/project-thread-11phqh`. Only one thread lands at a time; never leave uncommitted edits in the shared folder.
4. **Before you start work or a test, update:** `git -C D:\Rescue\Kingston\Users-ITSM\excursion-current pull`.
5. **One GPU:** the command refuses to start while another Blender runs. Tests are single frames or clips of about 3 s (90 frames at 30 fps; 100 max) at 48 samples.
6. **Watch the log** (`out/current-best/<name>/<name>.log`) for "Failed to load image" (magenta textures).

## Not in git (local to the shared folder)

- `assets/cache` and `blender/jobs` are junctions to the main checkout.
- Meter frames for the LED wall: `out/meters/<frame>.png`, one real frame per scene frame for the whole drive range (864-1763 for psychidelly), made by `node blender/stage/make_meters.mjs` (ffmpeg oscilloscope + stereo vectorscope + spectrum from the track audio). Re-run it after changing the drive. Replace the folder with real MiniMeters footage (same unpadded naming) when it exists; nothing else changes.

Nothing here merges into `main`; PRs merge only with Robert's go.
