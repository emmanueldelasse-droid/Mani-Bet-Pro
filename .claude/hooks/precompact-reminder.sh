#!/usr/bin/env bash
# PreCompact hook : force rappel update SESSION.md avant perte contexte.
cat <<'JSON'
{"hookSpecificOutput":{"hookEventName":"PreCompact","additionalContext":"RAPPEL CRITIQUE · compaction imminente · si travail non documenté SESSION.md (bugs fixés, routes ajoutées, version bumpée, nouveaux pièges stack) → mettre à jour MAINTENANT avant perte contexte · règles CLAUDE.md : télégraphique · file:line · <2000 octets · vérifier wc -c SESSION.md après edit."}}
JSON
