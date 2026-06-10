# Guide — Système de continuité de session IA

---

## 1. Prompt système à coller dans ChatGPT (Custom Instructions)

Colle ce texte dans **Settings → Personalization → Custom Instructions → "What would you like ChatGPT to know about you?"** :

---

```
Au début de chaque conversation concernant un de mes projets, lis automatiquement le fichier SESSION.md du projet sur GitHub avant de répondre.

Mes projets et leurs SESSION.md :
- Mani Bet Pro : https://raw.githubusercontent.com/emmanueldelasse-droid/[REPO]/main/SESSION.md
- BOBtheBAGEL : https://raw.githubusercontent.com/emmanueldelasse-droid/BobTheBagel/main/SESSION.md
- ManiTradePro : https://raw.githubusercontent.com/emmanueldelasse-droid/[REPO]/main/SESSION.md

Règles :
1. Si je mentionne un projet, charge son SESSION.md immédiatement via l'outil de navigation.
2. Résume en 3 lignes ce que tu as lu (projet, état, prochaine étape).
3. En fin de session, génère un SESSION.md mis à jour complet que je peux copier-coller sur GitHub.
4. Ne jamais inventer ou supposer l'état du projet — tout vient du SESSION.md.
5. RÈGLE FIN DE SESSION : Dès que je dis "on approche de la fin", "bientôt fini", "dernière chose", "tokens", ou toute formulation similaire → génère IMMÉDIATEMENT et SANS attendre le SESSION.md complet mis à jour, avant de répondre à autre chose.
```

---

## 2. Prompt à utiliser en début de session Claude

Colle ce message au tout début de chaque conversation :

---

```
Lis ce SESSION.md avant de commencer :
[colle ici le contenu brut du SESSION.md]

Résume en 3 lignes : projet, état actuel, prochaine étape prioritaire.
Puis demande-moi ce que je veux faire aujourd'hui.

RÈGLE IMPORTANTE : Dès que je dis "on approche de la fin", "bientôt fini", "tokens", "sauvegarde la session" ou formulation similaire → génère IMMÉDIATEMENT le SESSION.md complet mis à jour avant toute autre réponse.
```

---

## 3. Comment placer les fichiers dans GitHub

Pour chaque projet, crée un fichier `SESSION.md` à la **racine du repo** :

```
mon-repo/
├── SESSION.md          ← fichier de continuité IA
├── src/
├── worker.js
└── ...
```

### URL raw pour lecture automatique :
```
https://raw.githubusercontent.com/emmanueldelasse-droid/NOM-DU-REPO/main/SESSION.md
```

---

## 4. Workflow de session — étape par étape

### En début de session
1. Ouvre GitHub → ton repo → `SESSION.md`
2. Copie le contenu brut
3. Colle-le dans le prompt de démarrage (voir section 2)
4. L'IA résume et te propose de continuer

### Pendant la session
- Travaille normalement
- L'IA garde le contexte en mémoire pendant la session

### En fin de session
Écris à l'IA :
```
Génère le SESSION.md mis à jour pour cette session.
Inclus : tâches accomplies, décisions prises, fichiers modifiés, et la prochaine étape prioritaire.
```

L'IA te donnera le fichier complet à copier-coller.

### Pour commiter le SESSION.md sur GitHub
1. GitHub → ton repo → `SESSION.md`
2. Clique sur l'icône ✏️ (éditer)
3. Sélectionne tout → colle le nouveau contenu
4. "Commit changes" → message : `session: [date] [IA utilisée]`

---

## 5. Prompt de fin de session (à utiliser avec n'importe quelle IA)

```
On termine la session. Génère le SESSION.md complet mis à jour.

Inclus obligatoirement :
- Date et IA utilisée aujourd'hui
- Liste des tâches accomplies
- Liste des bugs résolus
- Décisions techniques importantes
- Fichiers modifiés avec description courte
- Prochaine étape prioritaire (1 seule, la plus importante)
- Contexte nécessaire pour reprendre

Format : markdown prêt à copier-coller sur GitHub.
```

---

## 6. Commandes rapides à mémoriser

| Situation | Ce que tu dis à l'IA |
|-----------|---------------------|
| Démarrer | "Lis ce SESSION.md : [colle contenu]" |
| Reprendre après pause | "Où en étions-nous ?" (si même session) |
| Changer d'IA | Donne le SESSION.md à la nouvelle IA |
| **⚠️ Bientôt à court de tokens** | **"on approche de la fin"** → l'IA génère le SESSION.md immédiatement |
| Fin de session normale | "Génère le SESSION.md mis à jour" |
| Bug mystérieux | "Relis le SESSION.md — est-ce qu'on a déjà rencontré ça ?" |

---

## 7. Mot-clé universel de fin de session

Le mot-clé à utiliser avec **n'importe quelle IA** (Claude, ChatGPT, Codex) :

> **"on approche de la fin"**

Toutes les IA sont instruites pour réagir à cette phrase en générant le SESSION.md **immédiatement**, avant toute autre réponse. Tu peux aussi utiliser :
- "bientôt fini"
- "tokens"
- "dernière chose avant de terminer"
- "sauvegarde la session"
