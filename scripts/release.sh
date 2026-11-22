#!/bin/zsh
# Builds the desktop app: Backlog-Hub-<version>-arm64.dmg and -x64.dmg (signed, notarized) and
# Backlog-Hub-Setup-<version>.exe, in dist/.
#
#   scripts/release.sh             build everything
#   scripts/release.sh --mac       only the .dmg files (--win: only the .exe)
#   scripts/release.sh --dir       a quick unpacked Mac app for this Mac, unsigned (dist/mac-arm64/)
#   scripts/release.sh --publish   build everything, push main, then a GitHub release v<version> with the files
#                                  and this version's CHANGELOG.md section as notes
#   scripts/release.sh --upload    the same release from the files already in dist/ (no build)
#
# Needs: the Xcode Command Line Tools, rsvg-convert (brew install librsvg), the Developer ID certificate in the
# keychain, and notarization credentials stored once with:
#   xcrun notarytool store-credentials backlog-hub --apple-id <apple id> --team-id D8YDS2RU3R
set -e
here=${0:A:h:h}
cd $here
mode=${1:-all}
version=$(node -p "require('./package.json').version")
backlog_version=$(npm view backlog.md version)

rm -rf build && mkdir -p build/icon.iconset

if [[ $mode != --upload ]]; then

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

case $mode in
	--dir) CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac dir --arm64 -c.mac.notarize=false ;;
	--mac) APPLE_KEYCHAIN_PROFILE=backlog-hub npx electron-builder --mac --publish never ;;
	--win) npx electron-builder --win --publish never ;;
	*) APPLE_KEYCHAIN_PROFILE=backlog-hub npx electron-builder --mac --win --publish never ;;
esac
fi

if [[ $mode == (--publish|--upload) ]]; then
	# Release notes: this version's section of CHANGELOG.md. The release is tagged on main, pushed first.
	files=(dist/Backlog-Hub-$version-arm64.dmg dist/Backlog-Hub-$version-x64.dmg dist/Backlog-Hub-Setup-$version.exe)
	awk -v v="## $version" '$0 ~ "^## " { on = index($0, v) == 1; next } on' CHANGELOG.md > build/notes.md
	git push origin main
	gh release create v$version $files --target main --title "Backlog Hub $version" --notes-file build/notes.md
fi
rm -rf build
files=(dist/*.(dmg|exe)(N)); (( $#files )) && ls -lh $files || true
