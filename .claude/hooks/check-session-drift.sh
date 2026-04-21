#!/usr/bin/env bash
# Stop hook : alerte si fichiers modifiés non commités sans toucher SESSION.md.
set -u
cd /home/user/Mani-Bet-Pro 2>/dev/null || exit 0

# Fichiers modifiés/ajoutés (exclut untracked ??)
CHANGED=$(git status --porcelain 2>/dev/null | awk '$1 ~ /^[MARC]/ || $2 ~ /./' | awk '{print $NF}' | grep -v '^SESSION\.md$' | wc -l)
SESSION_TOUCHED=$(git status --porcelain 2>/dev/null | awk '{print $NF}' | grep -c '^SESSION\.md$')

if [ "$CHANGED" -gt 0 ] && [ "$SESSION_TOUCHED" -eq 0 ]; then
  printf '{"systemMessage":"[hook SESSION-drift] %s fichier(s) modifié(s) non commité(s) · SESSION.md non touché · vérifier si mise à jour nécessaire avant fin session."}\n' "$CHANGED"
fi
exit 0
