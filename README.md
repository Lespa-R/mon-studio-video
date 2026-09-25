# Mon Studio HyperFrame

Ton studio local pour habiller tes plans vidéo avec des éléments HyperFrames :
texte qui passe **derrière toi**, titres, bandeaux, étalonnage, flou
d'arrière-plan, grain… puis export en MP4, au format de ton choix (16:9,
vertical 9:16, carré, 4:5).

Tout tourne sur ton Mac. Rien n'est envoyé en ligne.

---

## Démarrer

**Le plus simple** : double-clique sur **« Mon Studio HyperFrame »** sur ton
Bureau. Une fenêtre Terminal s'ouvre, vérifie que tout est installé, lance le
studio et ouvre ton navigateur.

**Depuis un terminal** :

```bash
cd ~/Code/mon-studio-hyperframe
npm run studio
```

> La fenêtre du Terminal **est** le studio : la fermer (ou `Ctrl-C`) l'arrête.
> Si le studio tourne déjà, le relancer ouvre simplement le navigateur.

L'adresse est **http://localhost:3002** (ou le port suivant si 3002 est pris —
le lanceur ouvre toujours le bon).

### Prérequis

Le lanceur les vérifie et te dit quoi installer s'il en manque un.

| Outil | Pour quoi | Installation |
|---|---|---|
| Node.js 22+ | le studio | `brew install node` |
| ffmpeg | lire et encoder la vidéo | `brew install ffmpeg` |
| outils Xcode (`swiftc`) | détection du visage et découpe | `xcode-select --install` |

### Sur un autre Mac

```bash
git clone git@github.com:Lespa-R/mon-studio-hyperframe.git ~/Code/mon-studio-hyperframe
cd ~/Code/mon-studio-hyperframe
npm run studio
```

Aucun `npm install` : le studio n'a pas de dépendance. Ta bibliothèque
(projets, clips, effets) reste sur le Mac où tu l'as créée — voir
[Où sont mes fichiers](#où-sont-mes-fichiers).

---

## Utiliser le studio

### 1. Un projet, des clips

- **Projets** (colonne de gauche) : `+ Projet` pour en créer un, `+ Dossier`
  pour les ranger. `✎` renomme, `×` supprime.
- **Vidéos** : glisse tes fichiers dans la zone prévue. À l'import, le studio
  détecte ton visage — c'est ce qui permet de placer le texte derrière toi.

### 2. Ajouter des effets

Dans la colonne **Effets**, choisis un effet et clique **Ajouter**. L'aperçu se
place automatiquement sur un moment où l'effet est visible.

| Effet | Ce qu'il fait |
|---|---|
| **Texte derrière moi** | le texte passe derrière ta tête et tes épaules |
| **Titre devant** | titre animé au-dessus de l'image (haut, centre, bas, sous le menton) |
| **Bandeau (lower third)** | nom et fonction en bas à gauche |
| **Étalonnage** | exposition, contraste, saturation, température |
| **Flou d'arrière-plan** | floute la pièce, te garde net |
| **Vignettage** | assombrit les coins |
| **Grain argentique** | texture de pellicule |
| **Bandes cinéma** | format large 2.39, 2.00… |
| **Fondu entrée / sortie** | ouverture et fermeture au noir |

Chaque effet se règle dans sa carte. **Tape sur son titre pour le renommer.**
La case à cocher l'active ou le désactive, `×` le retire.

### 3. Placer les effets dans le temps

Sous l'aperçu, la **timeline** montre une barre par effet : **fais-la glisser**
pour la déplacer, **tire un bord** pour changer son début ou sa fin. Clique sur
la règle pour te déplacer dans la vidéo. Espace = lecture / pause.

### 4. Choisir le format de sortie

La barre **Sortie**, au-dessus de l'aperçu, règle le format du projet :

- **Format** : Source, 16:9, 9:16 (Reels, TikTok, Shorts), 1:1, 4:5 (LinkedIn)
- **Taille** : 720p ou 1080p
- **Cadrage** : *Remplir* recadre (centré sur ton visage) · *Adapter* garde
  toute l'image avec des bandes (floues ou unies)

Le texte derrière toi reste parfaitement calé, même recadré en vertical.

### 5. Réutiliser un réglage

- **Copier les effets** copie toute la pile d'un clip, **⧉** un seul effet.
  Sélectionne un autre clip → **Coller** (en ajoutant ou en remplaçant).
- **★** sur un effet l'enregistre comme **préréglage**, disponible sur tous tes
  projets dans le menu *Mes préréglages*.
- L'onglet **Bibliothèque d'effets** (en haut à droite) sert à créer et ranger
  tes préréglages par collections, avec un aperçu en direct.

### 6. Exporter

**Rendre le MP4** produit la vidéo et affiche un lien de téléchargement. Tu peux
continuer à modifier pendant le rendu : il utilise l'état au moment du clic.

---

## Où sont mes fichiers

Tout est dans le dossier du projet :

| Chemin | Contenu |
|---|---|
| `studio.json` | ta bibliothèque : projets, dossiers, effets, préréglages |
| `media/` | tes clips importés et leurs découpes |
| `renders/` | les MP4 exportés |

Ces trois-là ne partent **pas** sur GitHub (ils sont personnels et lourds).
Pour sauvegarder ta bibliothèque, copie-les ailleurs.

`studio.json` est protégé : il est écrit de façon atomique, et s'il devenait
illisible, il serait mis de côté (`studio.corrupt-….json`) et restauré depuis
la dernière copie valide (`studio.backup.json`) — jamais écrasé.

---

## Si quelque chose coince

| Symptôme | Solution |
|---|---|
| Page « Ouvre le studio, pas le fichier » | tu as ouvert le fichier HTML directement : va sur http://localhost:3002 |
| « Le serveur ne répond pas » | relance le studio (double-clic ou `npm run studio`) |
| L'aperçu d'un effet « derrière moi » ne découpe pas | la découpe se calcule au premier usage : attends la fin de « mise à jour… » |
| Un message rouge en bas de l'écran | c'est l'erreur exacte : elle dit ce qui a échoué |
| Le port 3002 est pris | normal si HyperFrames Studio tourne : le studio prend le suivant tout seul |

---

## Aller plus loin

- **Ajouter un nouvel élément HyperFrames** (un nouvel effet) : c'est un seul
  fichier à modifier, l'interface suit toute seule. La marche à suivre est dans
  [CLAUDE.md](CLAUDE.md) — ouvre une session Claude Code dans ce dossier et
  décris l'élément que tu veux.
- **Fonctionnement interne** : [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
- **Mode ligne de commande** (un clip, un texte derrière toi, sans interface) :

  ```bash
  node bin/behind.mjs --video ~/Desktop/clip.mov --text "Hello World" --render
  ```

## Commandes

```bash
npm run studio   # lance le studio et ouvre le navigateur
npm start        # le serveur seul
npm test         # la suite de tests (sans dépendance)
npm run check    # contrôle HyperFrames de la dernière composition rendue
```
