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
  détecte ton visage — c'est ce qui cale le texte derrière toi. Sans visage
  visible (de dos, de loin), le texte derrière la personne marche quand même :
  tu le places à la souris.

### 2. Ajouter des effets

Dans la colonne **Effets**, choisis un effet et clique **Ajouter**. L'aperçu se
place automatiquement sur un moment où l'effet est visible.

Le menu est classé en trois familles : **Textes**, **Animations**, **Image**.

| Effet | Ce qu'il fait |
|---|---|
| **Texte derrière moi** | le texte passe derrière ta tête et tes épaules |
| **Titre devant** | titre animé au-dessus de l'image (haut, centre, bas, sous le menton) |
| **Bandeau (lower third)** | nom et fonction en bas à gauche |
| **Titre surligné** | un coup de surligneur (ou un soulignement, un encadré) passe derrière la phrase |
| **Mots-clés percutants** | des mots qui claquent l'un après l'autre — sépare-les par « / » |
| **Liste à puces** | une carte dont les points apparaissent un à un |
| **Compteur animé** | un chiffre qui défile jusqu'à sa valeur (« +250 % »), avec une légende |
| **Flèche animée** | une flèche se dessine vers un point de l'image, avec une étiquette |
| **Barre de progression** | une fine barre qui se remplit au fil du clip |
| **Bouton d'appel à l'action** | « Abonne-toi », « Lien en commentaire »… surgit puis pulse |
| **Logo** | le logo de ta charte dans un coin |
| **Étalonnage** | exposition, contraste, saturation, température |
| **Flou d'arrière-plan** | floute la pièce, te garde net |
| **Remplacer l'arrière-plan** | remplace la pièce derrière toi par ton image, un dégradé ou une couleur |
| **Vignettage** | assombrit les coins |
| **Grain argentique** | texture de pellicule |
| **Bandes cinéma** | format large 2.39, 2.00… |
| **Fondu entrée / sortie** | ouverture et fermeture au noir |

Chaque effet se règle dans sa carte. **Tape sur son titre pour le renommer.**
La case à cocher l'active ou le désactive, `×` le retire.

**Déplacer à la souris** : quand l'aperçu est en pause, chaque animation — et
aussi **Texte derrière moi** et **Titre devant** — visible à cet instant a un
cadre pointillé (au survol de l'aperçu).
**Fais-la glisser** où tu veux ; sa position passe en « Libre » et deux
curseurs, Horizontal et Vertical, permettent d'ajuster au pour cent près.
Un simple clic sur le cadre ouvre sa carte de réglages, **Échap** annule un
glisser en cours. La flèche se déplace avec sa cible ; la barre de progression
reste en haut ou en bas.

**Texte derrière une personne sans visage visible** (de dos, de loin, de
profil) : la découpe détecte la silhouette, pas le visage. Sur un clip où aucun
visage n'est trouvé, **Texte derrière moi** se place librement : fais-le glisser
sur l'aperçu à la hauteur voulue — les épaules, le dos, la tête passent devant.
Sur un clip avec visage, son réglage **Placement** propose « Calé sur le
visage » (par défaut) ou « Libre ».

Les textes (**Texte derrière moi**, **Titre devant**) ont un réglage
**Animation** : Flou montant, Rebond, Glissement, Machine à écrire, Mot par mot,
Balayage.

### Ta charte graphique

L'onglet **Charte graphique** (en haut à droite) définit tes chartes : quatre
couleurs (principale, secondaire, texte, fond), une police pour les titres et
une pour les textes, et ton logo. Les polices du Mac sont proposées d'office ;
**Importer une police…** accepte WOFF2, WOFF, TTF ou OTF (par exemple
téléchargée depuis Google Fonts).

Chaque projet choisit sa charte dans la barre **Charte**, au-dessus de
l'aperçu. Dans un effet, les **pastilles** à côté d'une couleur la lient à la
charte : elle suit alors chaque changement de la charte. Le sélecteur de
couleur, lui, fixe une couleur libre. Les titres, bandeaux et animations
prennent les polices de la charte ; l'élément **Logo** prend son logo.

### Remplacer l'arrière-plan

Ajoute l'effet **Remplacer l'arrière-plan**, choisis **Fond : Image**, puis
**Choisir une image…** (PNG, JPEG ou WebP, 25 Mo max). Un léger **flou** et une
**luminosité** un peu baissée rendent le montage plus naturel. Le texte « derrière
moi » reste devant le nouveau fond mais derrière toi, et l'étalonnage
s'applique aussi au décor.

> Les contours très fins (cheveux) peuvent garder un léger liseré de la couleur
> de ta pièce, visible surtout en gros plan sur un fond très différent.

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
| `media/` | tes clips importés, leurs découpes, et les images de fond (`asset_….png`) |
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
