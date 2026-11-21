#!/bin/zsh
# Runs the Backlogs server at every login (launchd agent), then opens the app.
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
