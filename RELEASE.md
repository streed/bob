# Bob Release Process

This document describes how to create new releases for Bob.

## Version Management

Bob uses semantic versioning (semver) stored in a `VERSION` file:
- **MAJOR.MINOR.PATCH** (e.g., `1.2.3`)
- **MAJOR**: Breaking changes
- **MINOR**: New features (backwards compatible)
- **PATCH**: Bug fixes (backwards compatible)

### Current Version
The current version is stored in the `VERSION` file at the project root.

## Creating a Release

### 1. Update Version
Edit the `VERSION` file with the new version number:
```bash
echo "0.1.0" > VERSION
```

### 2. Sync Version to Package Files
Run the version sync script to update all package.json files:
```bash
npm run sync-version
```

### 3. Commit Changes
```bash
git add VERSION package.json backend/package.json frontend/package.json
git commit -m "Bump version to 0.1.0"
```

### 4. Create and Push Tag
```bash
git tag v0.1.0
git push origin main
git push origin v0.1.0
```

### 5. GitHub Actions Automation
When you push a tag starting with `v` (e.g., `v0.1.0`), GitHub Actions will automatically:

1. **Create Draft Release**: A new release will be created as a draft
2. **Build Multi-Platform**: Apps will be built for:
   - **Linux**: AppImage, .deb, .rpm
   - **Windows**: NSIS installer, portable .exe
   - **macOS**: .dmg, .zip (Intel + Apple Silicon)
3. **Upload Assets**: All built files will be attached to the release

### 6. Manual Release Publication
1. Go to GitHub Releases page
2. Find your draft release
3. Edit the release notes as needed
4. **Manually mark as "Latest release"** when ready
5. Publish the release

## Release Naming Convention

- **Tags**: `v{VERSION}` (e.g., `v0.1.0`, `v1.2.3`)
- **Release Title**: `Bob v{VERSION}` (e.g., `Bob v0.1.0`)
- **Asset Names**:
  - Windows: `Bob-Setup-{VERSION}.exe`, `Bob-{VERSION}.exe`
  - macOS: `Bob-{VERSION}.dmg`, `Bob-{VERSION}-mac.zip`
  - Linux: `Bob-{VERSION}.AppImage`, `bob_{VERSION}_amd64.deb`, `bob-{VERSION}.x86_64.rpm`

## Version History Examples

```
0.0.1 - Initial release
0.1.0 - Added GitHub integration
0.2.0 - Added system status monitoring
1.0.0 - Stable release with Electron app
1.0.1 - Bug fixes for terminal connectivity
1.1.0 - Added auto-updater support
```

## Development vs Production Versions

- **Development**: Version from package.json (auto-synced)
- **Production**: Version from VERSION file (manually managed)
- **App Display**: Always shows VERSION file content

## Automated Build Details

The GitHub Actions workflow (`.github/workflows/release.yml`) handles:

- **Multi-platform builds** on GitHub's infrastructure
- **Code signing** (if certificates are configured)
- **Asset uploading** to GitHub Releases
- **Draft creation** for manual review before publication

## Manual Override

If you need to build locally:
```bash
# Build for current platform
npm run dist

# Build for specific platforms
npm run dist:linux
npm run dist:mac
npm run dist:win
```

## Important Notes

- ✅ **Releases are created as drafts** - you control when they go live
- ✅ **You manually mark releases as "latest"** - no automatic promotion
- ✅ **Version consistency** - VERSION file is the single source of truth
- ✅ **Multi-platform support** - automated builds for all major platforms
- ✅ **Asset naming** - consistent naming scheme across all platforms