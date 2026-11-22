#!/bin/zsh
# From a source checkout (macOS): runs the Backlog Hub server at every login (launchd agent) and opens the page.
# The desktop app (scripts/release.sh), when installed, shows this server rather than starting its own.
# ./install.sh --uninstall removes the agent.
set -e
here=${0:A:h}
label=local.backlogs
plist=~/Library/LaunchAgents/$label.plist
launchctl bootout gui/$UID/$label 2>/dev/null || true
if [[ $1 == --uninstall ]]; then rm -f $plist; echo "Removed."; exit; fi

node=$(command -v node)
[[ -x ~/.local/share/fnm/aliases/default/bin/node ]] && node=~/.local/share/fnm/aliases/default/bin/node
backlog_dir=$(command -v backlog)
# Dependencies (the Claude Code terminal), installed with the same Node as the server runs.
(cd $here && PATH=${node:h}:$PATH npm install --omit=dev --no-fund --no-audit --silent)
cat > $plist <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
	<key>Label</key><string>$label</string>
	<key>ProgramArguments</key><array><string>$node</string><string>$here/server.js</string></array>
	<key>EnvironmentVariables</key><dict><key>PATH</key><string>${backlog_dir:h}:/usr/bin:/bin:/usr/sbin:/sbin</string></dict>
	<key>RunAtLoad</key><true/>
	<key>KeepAlive</key><true/>
	<key>StandardOutPath</key><string>$HOME/Library/Logs/Backlogs.log</string>
	<key>StandardErrorPath</key><string>$HOME/Library/Logs/Backlogs.log</string>
</dict></plist>
EOF
launchctl bootstrap gui/$UID $plist
sleep 1
open http://localhost:6400
echo "Installed: http://localhost:6400"
