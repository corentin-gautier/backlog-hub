#!/bin/zsh
# Releases the desktop app: Backlog-Hub-<version>-arm64.dmg and -x64.dmg (signed, notarized) and
# Backlog-Hub-Setup-<version>.exe, built in dist/ and published as a GitHub release.
#
#   scripts/release.sh --release   the whole release: the next version from the Conventional Commits since the last
#                                  tag (scripts/changelog.mjs), its CHANGELOG.md section, build, commit
#                                  "chore(release): vX.Y.Z", tag, push, GitHub release with the section as notes,
#                                  the site republished and the Homebrew cask bumped
#   scripts/release.sh --dry-run   prints the next version and its notes, changes nothing
#   scripts/release.sh --upload    publishes the files already in dist/ for the current version (a failed upload)
#   scripts/release.sh             only builds everything, current version (--mac: the .dmg files, --win: the .exe,
#                                  --dir: a quick unsigned Mac app for this Mac in dist/mac-arm64/)
#
# Needs: the Xcode Command Line Tools, rsvg-convert (brew install librsvg), the Developer ID certificate in the
# keychain, and notarization credentials stored once with:
#   xcrun notarytool store-credentials backlog-hub --apple-id <apple id> --team-id D8YDS2RU3R
set -e
here=${0:A:h:h}
cd $here
mode=${1:-all}

if [[ $mode == --dry-run ]]; then
	node scripts/changelog.mjs | node -e "const r = JSON.parse(require('fs').readFileSync(0)); console.log(r.version ? 'Next: ' + r.version + '\n\n' + r.notes : 'Nothing to release (no feat, fix or perf since the last tag).')"
	exit
fi

if [[ $mode == --release ]]; then
	[[ $(git branch --show-current) == main ]] || { echo "Release from main."; exit 1; }
	[[ -z $(git status --porcelain) ]] || { echo "Commit or stash your changes first."; exit 1; }
	git pull --ff-only --quiet
	next=$(node scripts/changelog.mjs | node -p "JSON.parse(require('fs').readFileSync(0)).version")
	[[ $next != null ]] || { echo "Nothing to release (no feat, fix or perf since the last tag)."; exit 1; }
	# The version and changelog first (the installers carry the version); undone if the build fails.
	trap '[[ -n $released ]] || git checkout -- package.json package-lock.json CHANGELOG.md' EXIT
	node scripts/changelog.mjs --write >/dev/null
	npm version $next --no-git-tag-version >/dev/null
	echo "Releasing $next"
fi
version=$(node -p "require('./package.json').version")

rm -rf build && mkdir -p build/icon.iconset

if [[ $mode != --upload ]]; then
	backlog_version=$(npm view backlog.md version)

	# Icons: .icns for the Mac, a 512 px PNG for Windows (electron-builder makes the .ico).
	for size in 16 32 128 256 512; do
		rsvg-convert -w $size -h $size public/icon.svg -o build/icon.iconset/icon_${size}x${size}.png
		rsvg-convert -w $((size * 2)) -h $((size * 2)) public/icon.svg -o build/icon.iconset/icon_${size}x${size}@2x.png
	done
	iconutil -c icns build/icon.iconset -o build/icon.icns
	rsvg-convert -w 512 -h 512 public/icon.svg -o build/icon.png

	# Tools shipped in the app (resources/bin): the `backlog` CLI of each platform, the Touch ID vault on the Mac.
	fetch() { # npm package, file in it, destination
		local tmp=$(mktemp -d)
		(cd $tmp && npm pack "$1@$backlog_version" --silent >/dev/null && tar xzf *.tgz)
		mkdir -p ${3:h} && cp $tmp/package/$2 $3 && chmod +x $3
		rm -rf $tmp
	}
	fetch backlog.md-darwin-arm64 backlog build/bin/mac-arm64/backlog
	fetch backlog.md-darwin-x64 backlog build/bin/mac-x64/backlog
	fetch backlog.md-windows-x64 backlog.exe build/bin/win-x64/backlog.exe
	for arch in arm64 x64; do
		swiftc -O -target ${arch/x64/x86_64}-apple-macos13 vault/vault.swift -o build/bin/mac-$arch/backlogs-vault
	done

	rm -rf dist
	case $mode in
		--dir) CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac dir --arm64 -c.mac.notarize=false ;;
		--mac) APPLE_KEYCHAIN_PROFILE=backlog-hub npx electron-builder --mac --publish never ;;
		--win) npx electron-builder --win --publish never ;;
		*) APPLE_KEYCHAIN_PROFILE=backlog-hub npx electron-builder --mac --win --publish never ;;
	esac
fi

if [[ $mode == --release ]]; then
	git add package.json package-lock.json CHANGELOG.md
	git commit --quiet -m "chore(release): v$version"
	git tag v$version
	released=1
fi

if [[ $mode == (--release|--upload) ]]; then
	# Notes: this version's section of CHANGELOG.md, without its heading.
	files=(dist/Backlog-Hub-$version-arm64.dmg dist/Backlog-Hub-$version-x64.dmg dist/Backlog-Hub-Setup-$version.exe)
	awk -v v="## $version " '/^## / { on = index($0, v) == 1; next } on' CHANGELOG.md > build/notes.md
	git push --quiet origin main v$version 2>/dev/null || git push --quiet origin main
	gh release create v$version $files --verify-tag --title "Backlog Hub $version" --notes-file build/notes.md
	scripts/publish-site.sh # the site's download links point to the latest release

	# The Homebrew cask (corentin-gautier/homebrew-tap; TAP_DIR to override): version and both checksums.
	tap=${TAP_DIR:-$HOME/Projects/homebrew-tap}
	[[ -d $tap ]] || gh repo clone corentin-gautier/homebrew-tap $tap
	git -C $tap pull --quiet
	arm=$(shasum -a 256 $files[1] | cut -d' ' -f1)
	intel=$(shasum -a 256 $files[2] | cut -d' ' -f1)
	sed -i '' -E -e "s/^  version \".*\"/  version \"$version\"/" -e "s/arm:   \"[0-9a-f]+\"/arm:   \"$arm\"/" -e "s/intel: \"[0-9a-f]+\"/intel: \"$intel\"/" $tap/Casks/backlog-hub.rb
	git -C $tap commit --quiet -am "backlog-hub $version"
	git -C $tap push --quiet
fi
rm -rf build
files=(dist/*.(dmg|exe)(N)); (( $#files )) && ls -lh $files || true
