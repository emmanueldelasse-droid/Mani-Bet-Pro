# Mani Bet Pro · objectif réel

## Ce que c'est
- Moteur d'aide à la décision paris sportifs · NBA · MLB · Tennis
- Dashboard front (GitHub Pages) → afficher · expliquer · contrôler
- Worker Cloudflare → analyser · détecter · loguer · apprendre
- Système d'apprentissage : logs settlés → recalibration poids variables

## Ce que ce n'est PAS
- Pas un bookmaker
- Pas un tipster commercial
- Pas un placeur automatique de paris réels (paper trading uniquement)
- Pas un chatbot conversationnel
- Pas un outil de live betting (pré-match seulement)

## Rôle du moteur
- Analyser matchs prog. du jour · récupérer données fiables
- Détecter opportunités · edge vs marché · divergence motor/odds
- Protéger contre paris douteux · gates `data_quality` · `confidence=INCONCLUSIVE`
- Apprendre via logs settlés · calibration par sport · ajustement poids
- Améliorer calibration sport par sport · pas mélange
- Éviter décisions sur données fragiles · fallback explicite

## Rôle du dashboard
- Afficher matchs · recommandations · variables explicatives
- Permettre inspection détaillée match · stats équipe/joueur
- Contrôler bot · run manuel · settle manuel · export CSV logs
- Suivre paper trading · bankroll · historique
- Tout en français user-facing (cotes décimales européennes)

## Règles absolues
- Stabilité > nouvelles features
- Données fiables > nombre de paris
- Calibration > intuition
- Jamais inventer blessures · cotes · stats · projections
- Jamais masquer donnée fragile · afficher `INCONCLUSIVE` plutôt que cacher
- Jamais publier recommandation sans `data_quality` calculé
- Confidence honnête : `HIGH` doit avoir hit rate > `MEDIUM` > `LOW`
- Si source provider down · fallback documenté ou abstention

## Priorités produit
- P1 calibration sport par sport · validation hit rate > 55%
- P1 garde-fous edge · cotes plafond · sample minimum
- P2 transparence variables · pourquoi telle reco
- P2 ergonomie consultation · vocabulaire FR cohérent
- P3 nouvelles sources données · nouveaux sports

## Hors périmètre
- Trading financier · crypto · forex
- Sports non encore documentés (NFL · NHL · soccer · MMA · esports)
- Live betting · in-game · cash-out
- Comptes utilisateurs · auth · multi-tenant
