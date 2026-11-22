#!/bin/zsh
# Screenshots for the README (screenshots/*.png), taken on demo projects, never on yours:
# a throwaway home folder with three made-up boards, a server on port 6497 (HOME pointed at it), headless Chrome.
#
#   scripts/screenshots.sh
set -e
here=${0:A:h:h}
demo=$(mktemp -d)
port=6497
trap 'kill $server 2>/dev/null; rm -rf $demo' EXIT

day() { date -v+$1d +%Y-%m-%d; } # in N days

board() { # folder, name, port
	mkdir -p $demo/Projects/$1 && cd $demo/Projects/$1
	HOME=$demo backlog init "$2" --defaults --integration-mode none --no-git >/dev/null
	sed -i '' "s/^default_port:.*/default_port: $3/" backlog/config.yml
	grep -q '^default_port' backlog/config.yml || echo "default_port: $3" >> backlog/config.yml
}
task() { # title, status, extra args…
	HOME=$demo backlog task create "$1" -s "$2" ${@:3} --plain >/dev/null
}

board atlas Atlas 6491
task "Offline sync for the mobile app" "In Progress" --priority high
task "Faster search on big lists" "In Progress"
task "Export to CSV" "To Do"
task "Dark mode for charts" "To Do"
task "Onboarding emails" "To Do" --due-date $(day 9)
task "Rate limiting on the API" "To Do"
for t in "Sign in with Apple" "Push notifications" "Team invitations" "Billing page" "Audit log"; do task "$t" Done; done

board studio-site "Studio site" 6492
task "Redesign the pricing page" "In Progress"
task "Send the quote to the client" "To Do" --due-date $(day 2)
task "Renew the domain name" "To Do" --due-date $(day 8) -l yearly
task "Case study: Atlas" "To Do"
for t in "New home page" "Contact form" "Blog migration" "Image optimisation"; do task "$t" Done; done

board garden-journal "Garden journal" 6493
task "Write the November entry" "In Progress" -l monthly
task "Plant the spring bulbs" "To Do" --due-date $(day 22)
task "Order seeds for next year" "To Do"
for t in "October entry" "Photos of the dahlias"; do task "$t" Done; done

mkdir -p "$demo/Library/Application Support/Backlogs"
cat > "$demo/Library/Application Support/Backlogs/projects.json" <<EOF
{ "categories": ["Work", "Personal"], "projects": [
	{ "dir": "$demo/Projects/atlas", "port": 6491, "category": "Work" },
	{ "dir": "$demo/Projects/studio-site", "port": 6492, "category": "Work" },
	{ "dir": "$demo/Projects/garden-journal", "port": 6493, "category": "Personal" }
] }
EOF

cd $here
HOME=$demo BACKLOGS_PORT=$port node server.js >/dev/null 2>&1 &
server=$!
for i in {1..50}; do curl -s -o /dev/null localhost:$port && break; sleep 0.2; done

mkdir -p screenshots
node scripts/screenshots.mjs $port screenshots
