# homebrew-tap

Homebrew tap for [CollabMD](https://github.com/andes90/collabmd).

## Install

```bash
brew tap andes90/tap
brew install collabmd
```

Or in a single command:

```bash
brew install andes90/tap/collabmd
```

## Maintenance

`Formula/collabmd.rb` is managed from the main `collabmd` repository by the Homebrew release workflow.

When a GitHub release is published in `andes90/collabmd`, the workflow:

1. Downloads the tagged source tarball
2. Computes the Homebrew `sha256`
3. Regenerates `Formula/collabmd.rb`
4. Commits the update into this tap repository
