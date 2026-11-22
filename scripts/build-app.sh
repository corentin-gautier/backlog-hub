#!/bin/zsh
# Builds Backlog Hub.app (mac/BacklogHub.swift, icon from public/icon.svg) and installs it in /Applications.
# Needs the Xcode Command Line Tools (swiftc, iconutil) and rsvg-convert (brew install librsvg).
set -e
here=${0:A:h:h}
build=$here/build
app="$build/Backlog Hub.app"
command -v rsvg-convert >/dev/null || brew install librsvg

rm -rf $build && mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources" $build/icon.iconset

# The icon, at every size macOS asks for.
for size in 16 32 128 256 512; do
	rsvg-convert -w $size -h $size $here/public/icon.svg -o $build/icon.iconset/icon_${size}x${size}.png
	rsvg-convert -w $((size * 2)) -h $((size * 2)) $here/public/icon.svg -o $build/icon.iconset/icon_${size}x${size}@2x.png
done
iconutil -c icns $build/icon.iconset -o "$app/Contents/Resources/AppIcon.icns"

swiftc -O $here/mac/BacklogHub.swift -o "$app/Contents/MacOS/Backlog Hub"

version=$(node -p "require('$here/package.json').version" 2>/dev/null || echo 1.0)
cat > "$app/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
	<key>CFBundleName</key><string>Backlog Hub</string>
	<key>CFBundleDisplayName</key><string>Backlog Hub</string>
	<key>CFBundleIdentifier</key><string>local.backlogs.app</string>
	<key>CFBundleExecutable</key><string>Backlog Hub</string>
	<key>CFBundleIconFile</key><string>AppIcon</string>
	<key>CFBundlePackageType</key><string>APPL</string>
	<key>CFBundleShortVersionString</key><string>$version</string>
	<key>CFBundleVersion</key><string>$version</string>
	<key>LSMinimumSystemVersion</key><string>13.3</string>
	<key>LSApplicationCategoryType</key><string>public.app-category.productivity</string>
	<key>NSHighResolutionCapable</key><true/>
	<key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict></plist>
EOF
codesign --force --sign - "$app"

# Replace the installed copy (quit it first if it runs).
osascript -e 'quit app "Backlog Hub"' 2>/dev/null || true
rm -rf "/Applications/Backlog Hub.app"
cp -R "$app" /Applications/
rm -rf $build
echo "Installed: /Applications/Backlog Hub.app"
