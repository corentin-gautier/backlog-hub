#!/bin/zsh
# Publishes the promo page (site/) to the root of the gh-pages branch on origin, served by GitHub Pages.
# Leaves the main working tree untouched (uses a temporary worktree).
#   scripts/publish-site.sh
set -e
here=${0:A:h:h}
cd $here
tmp=$(mktemp -d)
trap 'git worktree remove --force $tmp 2>/dev/null; rm -rf $tmp; git branch -qD gh-pages-new 2>/dev/null || true' EXIT

if git fetch -q origin gh-pages 2>/dev/null; then
	git worktree add -q --detach $tmp FETCH_HEAD
else
	git worktree add -q --detach $tmp
	git -C $tmp checkout -q --orphan gh-pages-new
fi
git -C $tmp rm -rqf --ignore-unmatch .
rsync -a --delete --exclude .git site/ $tmp/
touch $tmp/.nojekyll
git -C $tmp add -A
if git -C $tmp diff --cached --quiet && git -C $tmp rev-parse -q --verify HEAD >/dev/null; then
	echo "Site already up to date"
else
	git -C $tmp commit -qm "chore(site): publish"
	git -C $tmp push -q origin HEAD:refs/heads/gh-pages
	echo "Published to gh-pages"
fi
