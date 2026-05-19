# docs/decisions · Architecture Decision Records (ADR)

Décisions structurantes du projet · contexte · alternatives · impacts · statut.

## Convention
- Format · `DECISION-XXX-NOM-COURT.md`
- Numérotation séquentielle · jamais réutilisée
- Statut · `proposed` · `accepted` · `superseded` · `rejected`

## Index

| ID | Titre | Statut | Référence code |
|---|---|---|---|
| 001 | Security audit MBP-A.4 (6/6 critiques résolues) | accepted | worker.js MBP-S.1 à S.4 |
| 002 | NBA engine parity MBP-A.2 (2 moteurs · test 492 assertions) | accepted | scripts/test-nba-engine-parity.mjs |
| 003 | MLB v6.94 calibration · zone edge [5,10] cherry-picking | **proposed** | worker.js:8629 (audit 421 logs) |
| 004 | MBP-CATCHUP-SETTLE PR #205 · settlement + recovery + stats | accepted | worker.js:137+ commit efc8730 |

## Template ADR

```
# DECISION-XXX · Titre court

## Statut
proposed | accepted | superseded | rejected

## Contexte
Pourquoi la décision est nécessaire · données · contraintes.

## Décision
Ce qui est décidé · scope explicite.

## Alternatives rejetées
Options envisagées et raisons du rejet.

## Conséquences
Positives · négatives · risques résiduels.

## Validation
ChatGPT review · créateur GO · date.

## Références code
file:line · PR · commit.
```

## Quoi mettre où
- Décision avec alternatives rejetées + contexte → ADR ici
- Bug · dette → `docs/monitoring/KNOWN_ISSUES.md`
- Audit ponctuel sans décision actée → `docs/monitoring/` ou TODO `SESSION.md`
- Règle générale projet → `docs/project/`
