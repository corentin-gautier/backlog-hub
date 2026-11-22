#!/bin/zsh
# Builds the Backlog.md fork (visual doc editor, theme that follows macOS) and makes it the
# `backlog` command, in place of Homebrew's (kept, unlinked and pinned: `brew link backlog-md`
# brings it back).
#   scripts/backlog-fork.sh           build and link
#   scripts/backlog-fork.sh --update  rebase the fork on upstream's main first (and push it)
set -e
FORK=${BACKLOG_FORK:-$HOME/Projects/Backlog.md}
BRANCH=backlogs
LINK=/opt/homebrew/bin/backlog

if [[ ! -d $FORK ]]; then
	git clone -q -b $BRANCH https://github.com/corentin-gautier/Backlog.md.git $FORK
	git -C $FORK remote rename origin fork
	git -C $FORK remote add origin https://github.com/MrLesk/Backlog.md.git
fi
cd $FORK
git rev-parse --verify -q $BRANCH >/dev/null || { echo "No '$BRANCH' branch in $FORK"; exit 1; }
git checkout -q $BRANCH
if [[ $1 == --update ]]; then
	git fetch -q origin
	git rebase origin/main || { echo "Conflicts: fix them in $FORK, 'git rebase --continue', then run this again."; exit 1; }
	git push -q --force-with-lease fork $BRANCH
fi
bun install --silent
bun run build >/dev/null
if [[ $(readlink $LINK) != $FORK/dist/backlog ]]; then
	brew list backlog-md &>/dev/null && { brew unlink -q backlog-md; brew pin backlog-md; }
	ln -sf $FORK/dist/backlog $LINK
fi
echo "backlog $(backlog --version) from $FORK ($(git rev-parse --short HEAD))"
echo "Restart the boards to use it: close their tabs in Backlogs, or restart Backlogs."
