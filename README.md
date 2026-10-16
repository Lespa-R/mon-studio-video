# Mon Studio Vidéo

Ton studio local pour habiller tes plans vidéo avec des éléments HyperFrames :
texte qui passe **derrière toi**, titres, bandeaux, étalonnage, flou
d'arrière-plan, grain… puis export en MP4, au format de ton choix (16:9,
vertical 9:16, carré, 4:5).

Tout tourne sur ton Mac. Rien n'est envoyé en ligne.

---

## Démarrer

**Le plus simple** : double-clique sur **« Mon Studio Vidéo »** sur ton
Bureau. Une fenêtre Terminal s'ouvre, vérifie que tout est installé, lance le
studio et ouvre ton navigateur.

**Depuis un terminal** :

```bash
cd ~/Code/mon-studio-video
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
git clone git@github.com:Lespa-R/mon-studio-video.git ~/Code/mon-studio-video
cd ~/Code/mon-studio-video
npm run studio
```

Aucun `npm install` : le studio n'a pas de dépendance. Ta bibliothèque
(projets, clips, effets) reste sur le Mac où tu l'as créée — voir
[Où sont mes fichiers](#où-sont-mes-fichiers).

---

## Utiliser le studio

L'écran **Montage** est organisé comme **Final Cut Pro** : la bibliothèque
(projets et clips en vignettes) à gauche, la visionneuse au centre,
l'inspecteur à droite (onglets Effets, Sous-titres, Projet), et la timeline
sur toute la largeur en bas. Le clip est la ligne principale (pellicule et
forme d'onde) ; chaque effet est un bloc de couleur au-dessus (violet :
textes, rose : animations, sarcelle : image) qu'on déplace ou rallonge à la
souris. Un clic sur un bloc l'ouvre dans l'inspecteur. Le navigateur d'effets
(**⌘5**) : double-clic sur une vignette, ou glisse-la sur la timeline — l'effet
se pose à la tête de lecture. « Partager » (**⌘E**) rend le MP4.

| Raccourci | Action |
|---|---|
| Espace · J K L | lecture / pause · reculer d'1 s, pause, lecture |
| ← → · ⇧← ⇧→ | image par image · 10 images |
| Début · Fin | début / fin du clip |
| S | survol de la timeline (l'aperçu suit la souris) |
| ⌘+ ⌘− · ⇧Z | zoom de la timeline · tout voir |
| ⌘5 · ⌘4 · ⌃⌘1 · ⌃⌘2 | effets · inspecteur · bibliothèque · timeline |
| V · ⌫ | activer/désactiver · supprimer l'effet sélectionné (⌘Z le remet) |
| ⌘Z · ⇧⌘Z | annuler · rétablir (effets, sous-titres, choix de découpe ; aussi ↶ ↷ au-dessus de l'aperçu) |
| ⌘D | dupliquer l'effet sélectionné |
| ⌘C ⌘V · ⌘I · ⌘E | copier/coller les effets · importer · partager |

Double-clic sur le nom d'un clip, dans la bibliothèque : tu le renommes.
L'annulation garde 50 étapes par clip, jusqu'à la fermeture du studio ; un
rognage ou un montage par le texte repart de zéro (le fichier a changé).


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
| **Titre devant** | titre animé au-dessus de l'image (haut, centre, bas, sous le menton, fixé dans le décor) |
| **Repère dans le décor** | un point sur un endroit du décor et son étiquette, qui y restent accrochés quand la caméra bouge |
| **Halo néon** · **Couleur sur le sujet** · **Sortie du cadre** · **Écho de mouvement** | sur la découpe du sujet (voir « Effets de suivi ») |
| **Projecteur** · **Étiquette qui suit** · **Viseur de suivi** · **Texte en orbite** | suivent un sujet : personne, objet cliqué, point du décor |
| **Recadrage qui suit le sujet** · **Stabilisation sur un point** | bougent le cadre lui-même |
| **Reflet de soleil** · **Tracé d'itinéraire** · **Flouter (anonymiser)** | accrochés au décor, ou qui cachent ce qui bouge |
| **Bandeau (lower third)** | nom et fonction en bas à gauche |
| **Titre surligné** | un coup de surligneur (ou un soulignement, un encadré) passe derrière la phrase |
| **Mots-clés percutants** | des mots qui claquent l'un après l'autre — sépare-les par « / » |
| **Liste à puces** | une carte dont les points apparaissent un à un |
| **Compteur animé** | un chiffre qui défile jusqu'à sa valeur (« +250 % »), avec une légende |
| **Flèche animée** | une flèche se dessine vers un point de l'image, avec une étiquette |
| **Barre de progression** | une fine barre qui se remplit au fil du clip |
| **Bouton d'appel à l'action** | « Abonne-toi », « Lien en commentaire »… surgit puis pulse |
| **Logo** | le logo de ta charte dans un coin |
| **Citation** | une citation qui apparaît mot à mot, avec son auteur |
| **Cercle dessiné** | un cercle tracé à la main autour d'un détail |
| **Réaction emoji** | une gerbe d'emojis (❤️ 👍 🔥 🎉…) qui s'envolent |
| **Notification** | une notification façon téléphone qui glisse depuis le haut |
| **Pseudo réseau social** | ton @pseudo et ton réseau dans une pastille |
| **Titre de chapitre** | un panneau plein écran annonce une nouvelle partie |
| **Transition balayage** | deux bandes de couleur traversent l'image, pour masquer une coupe |
| **Sous-titres** | affiche les sous-titres du clip (voir plus bas) |
| **Étalonnage** | exposition, contraste, saturation, température |
| **Flou d'arrière-plan** | floute la pièce, te garde net |
| **Remplacer l'arrière-plan** | remplace la pièce derrière toi par un fond studio, ton image, un dégradé ou une couleur |
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

**Texte derrière des personnes qui bougent** : dans **Texte derrière moi**,
choisis **Placement : Suit une personne**. Le studio repère les personnes du
clip (sur ton Mac, au premier aperçu) et les numérote **de gauche à droite** ;
choisis **Personne 1, 2, 3…** ou **Tout le groupe**. Le texte les accompagne
quand elles se déplacent, toujours derrière elles — la découpe les détoure
toutes. **Hauteur sur la personne** va de la tête (0) aux pieds (1) ; glisser
le texte sur l'aperçu règle son décalage par rapport à la personne. La carte
indique combien de personnes ont été trouvées.

**Étiquettes des personnes** accroche un nom (et une fonction) à chaque
personne — « Alice / Bruno / Chloé », dans l'ordre de gauche à droite — au-dessus
de la tête, sur le buste ou sous la personne, et les fait suivre.

> Si deux personnes se croisent, le suivi peut les intervertir ; coupe alors
> l'effet en deux sur la timeline, ou choisis « Tout le groupe ».

**Texte derrière une personne sans visage visible** (de dos, de loin, de
profil) : la découpe détecte la silhouette, pas le visage. Sur un clip où aucun
visage n'est trouvé, **Texte derrière moi** se place librement : fais-le glisser
sur l'aperçu à la hauteur voulue — les épaules, le dos, la tête passent devant.
Sur un clip avec visage, son réglage **Placement** propose « Calé sur le
visage » (par défaut) ou « Libre ».

Les textes (**Texte derrière moi**, **Titre devant**) ont un réglage
**Animation** : Flou montant, Rebond, Glissement, Machine à écrire, Mot par mot,
Balayage.

### Sous-titres

Onglet **Sous-titres**, à côté de *Effets* :

1. Choisis la langue parlée, clique **Générer**. La transcription se fait **sur
   ton Mac** avec **Whisper** (whisper.cpp, voir [Installer Whisper](#installer-whisper)) :
   rien ne part sur Internet, pas de compte, aucune autorisation macOS. Sans
   Whisper, le studio prend la reconnaissance vocale d'Apple ; la première fois,
   macOS demande alors l'autorisation pour « Mon Studio – Transcription ».
2. Corrige les lignes : le texte, et le début / la fin de chacune. `▶` ou un
   clic dans le texte place l'aperçu sur la ligne ; `+` en ajoute une après,
   `×` la supprime. La ligne en cours de lecture est surlignée en vert.
3. Le style se règle dans l'effet **Sous-titres** (ajouté tout seul) :
   *Bandeau*, *Karaoké* (le mot prononcé s'allume), *Mot à mot* (gros, style
   Reels), *Contour* ; taille, couleurs de la charte, majuscules, position —
   et il se déplace à la souris sur l'aperçu.

**Importer…** accepte un fichier SRT ou VTT ; **Exporter .srt** télécharge les
sous-titres corrigés (pour YouTube, LinkedIn…).

### Montage par le texte (retirer mots, silences, hésitations)

**✎ Texte**, sous l'aperçu, ouvre la transcription de ta vidéo d'origine
(**Transcrire avec Whisper** la première fois : quelques secondes par minute).

- Le texte s'affiche mot à mot, avec **⏸** pour les silences et **≈** pour le
  son sans texte : un « euh », une hésitation, un faux départ (Whisper ne les
  écrit pas). Clic sur un mot : tu l'entends.
- **Sélectionne des mots puis ⌫** : ils sont barrés, donc retirés. ⌫ sur une
  sélection déjà barrée la remet. Clic sur un ⏸ ou un ≈ : le raccourcir / le remettre.
- **Nettoyer** raccourcit d'un coup les silences trop longs (réglable) et retire
  les « euh » écrits ; coche **hésitations ≈** pour les retirer aussi — écoute
  avant, un ≈ est parfois un vrai mot que Whisper n'a pas compris.
- **Écouter le montage** joue la vidéo en sautant ce qui est retiré.
  **Appliquer au clip** fait les coupes. Les bords sont posés au moment le plus
  calme, avec un fondu de 10 ms : pas de clic.
- Comme pour le rognage, **l'original est conservé** : rouvre la fenêtre pour
  remettre un passage, ou **Tout remettre**. Les effets et les sous-titres
  suivent ; les mots retirés disparaissent aussi des sous-titres.

### Effets de suivi (famille « Suivi », ambre sur la timeline)

Ils s'appuient sur ce que le studio sait repérer : la **découpe** du sujet (la
personne, ou l'objet choisi dans « Découpe »), les **personnes** suivies, un
**objet que tu cliques** dans l'effet (SAM 2) et un **point du décor** suivi
quand la caméra bouge.

**Sur la découpe du sujet**
- **Halo néon** — un contour lumineux épouse la silhouette (halo, contour net ou
  les deux), avec une pulsation douce ou marquée.
- **Couleur sur le sujet** — le décor passe en noir et blanc (ou sépia, assombri,
  terni), le sujet garde ses couleurs.
- **Sortie du cadre (effet 3D)** — un cadre derrière le sujet, l'image assombrie
  ou floutée autour : il en déborde. Fais glisser le cadre sur l'aperçu.
- **Écho de mouvement** — des copies en retard suivent ses gestes (fantômes,
  silhouettes de couleur ou blanches) : une traînée quand il bouge.

**Qui suivent un sujet** — le menu **Sujet** : une personne (numérotée de gauche
à droite), le groupe, **un objet** (bouton « 🎯 Choisir l'objet… », la même
fenêtre que pour la découpe), un point du décor, ou un point fixe.
- **Projecteur** — le décor s'assombrit, un rond de lumière suit le sujet.
- **Étiquette qui suit** — un titre accroché à l'objet (au-dessus, en dessous, à côté).
- **Viseur de suivi** — des crochets d'angle, une étiquette et les coordonnées en
  direct, verrouillés sur le sujet.
- **Texte en orbite** — un anneau de texte tourne autour du sujet, passe derrière
  lui puis devant (découpe).

**Qui bougent le cadre** (un seul à la fois)
- **Recadrage qui suit le sujet** — en 9:16 depuis une vidéo horizontale, le cadre
  glisse avec la personne ou l'objet, avec un zoom et une fluidité réglables.
- **Stabilisation sur un point** — un endroit du décor reste immobile à l'écran :
  fais glisser la cible jaune (visible seulement dans l'aperçu) sur un endroit
  net. Le zoom donne la marge : il corrige les tremblements et les petits
  mouvements, pas un grand panoramique.

**Accrochés au décor**
- **Reflet de soleil** — glissé sur le soleil, il y reste ; ses reflets traversent
  l'image. Les personnes peuvent passer sous le reflet ou devant (découpe).
- **Tracé d'itinéraire** — une ligne pointillée ou pleine se dessine entre 2 à 4
  points du paysage (chacun se fait glisser), de « Départ » à « Arrivée ».
- **Flèche, Cercle dessiné, Réaction emoji, Compteur** — **Accroche : Fixé dans le
  décor** (ou la position du compteur) : ils restent sur leur endroit.
- **Titre devant › Perspective** — posé au sol ou sur un mur, à combiner avec
  « Fixé dans le décor ».
- **Titre derrière une montagne** — « Texte derrière moi » fixé dans le décor,
  animation **Lever**, et « Objet choisi » sur la montagne dans Découpe.

**Flouter (anonymiser)** — un visage, une plaque, un passant (clique dessus), ou
toutes les personnes : flou, pixels ou masque noir, qui suit dans tout le clip.

### Texte fixé dans le décor (la caméra bouge, le texte reste sur place)

Pour poser un texte sur un endroit du décor — une montagne, un bâtiment, la
mer — et qu'il y reste quand la caméra bouge (panoramique, marche, drone) :

- **Repère dans le décor** (effet) : un point, un trait et une étiquette
  (titre + sous-titre), comme les légendes des vidéos de voyage ;
- ou, pour **Titre devant** et **Texte derrière moi**, la position
  **Fixé dans le décor (suit la caméra)**.

Mets l'aperçu sur une image où l'endroit se voit bien et **fais glisser** le
texte dessus : il y est accroché à ce moment-là. Au prochain aperçu, le studio
suit l'endroit dans le clip (OpenCV, sur ton Mac ; quelques secondes pour une
vingtaine de secondes de vidéo). Le texte **s'efface quand l'endroit sort du
cadre et revient quand la caméra y retourne**. **Suivre** règle ce qu'il
reprend du mouvement : le déplacement (conseillé), la taille en plus (on
s'approche), ou aussi la rotation (la caméra penche).

> Choisis un endroit avec du relief ou des contrastes (une crête, un bâtiment,
> des rochers) : un ciel uni ou une mer plate ont peu de points à suivre. Et un
> endroit loin de la caméra : tout près (le sable à tes pieds), il défile plus
> vite que le reste et sort vite du cadre.

### Texte derrière un objet (fixe ou mobile)

Dans l'inspecteur, sur un clip avec un effet « derrière » (texte derrière moi,
remplacement de fond…), le menu **Découpe** propose :

- **Personne seule**, **Personne + objets tenus** (macOS) ;
- **Objet choisi** : l'objet seul passe devant le texte ;
- **Personne + objet choisi** : toi et l'objet.

Choisir l'objet (ou **🎯 Objet…** pour le changer) : glisse le curseur jusqu'à
une image où l'objet se voit bien, **clique dessus** — il se colore en bleu
(SAM 2, sur ton Mac ; une dizaine de secondes la première fois, ensuite
instantané). **Partie · Moyen · Entier** règle la taille prise pour ce clic
(une banane, une partie du régime, tout le régime). Un autre clic ajoute ce qui
manque, **⌥-clic** (ou clic droit) retire ce qui déborde. **Suivre cet objet** :
il est suivi dans tout le clip, même s'il bouge ou que la caméra bouge —
environ 4 images par seconde (une minute pour 8 s de vidéo), une fois ; le
résultat est gardé tant que tu ne changes ni le clip ni l'objet.

Installation (une fois, dans le même `.venv` que les plans) :

```bash
cd ~/Code/mon-studio-video && SAM2_BUILD_CUDA=0 .venv/bin/pip install torch torchvision "git+https://github.com/facebookresearch/sam2.git"
curl -L -o models/sam2.1_hiera_small.pt https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_small.pt
```

(Le paquet PyPI nommé « sam2 » n'est pas celui de Meta : passe par GitHub.)

### Découper un rush en plans

**▦ Plans**, sous l'aperçu : **Détecter les plans** repère chaque changement de
plan du clip (PySceneDetect, sur ton Mac ; une vingtaine de secondes de 4K en
3 s). Chaque plan s'affiche avec son image et ses temps :

- clic sur l'image : tu vois le plan ;
- décoche ceux à laisser de côté ; **⊕ avec le suivant** réunit deux plans
  coupés en trop ;
- **Sensibilité** *Fine* trouve plus de plans, *Large* moins ; **Plan le plus
  court** évite les miettes.

**Créer les clips** : chaque plan gardé devient un clip (« nom — plan 3 »),
rangé juste après le rush. Le rush lui-même ne bouge pas.

Installation (une fois) :

```bash
brew install python@3.12
cd ~/Code/mon-studio-video && /opt/homebrew/opt/python@3.12/bin/python3.12 -m venv .venv && .venv/bin/pip install scenedetect
```

### Installer Whisper

```bash
brew install whisper-cpp
```

Puis, dans `models/` (dossier du studio, exclu de git) :
`ggml-large-v3-turbo-q8_0.bin` (874 Mo) et `ggml-silero-v5.1.2.bin` (0,9 Mo,
détecteur de voix : évite que Whisper invente du texte sur la musique), depuis
huggingface.co/ggerganov/whisper.cpp et huggingface.co/ggml-org/whisper-vad.
Relance le studio : il les détecte tout seul.

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

**Fond : Studio** pose un plateau photo sans image à fournir : mur, sol, une
lumière derrière toi et une ombre à tes pieds. Trois **ambiances** : fond papier
clair, plateau sombre, ou couleur de ta charte ; **Lumière derrière toi** règle
l'intensité du halo.

> Les contours très fins (cheveux) peuvent garder un léger liseré de la couleur
> de ta pièce, visible surtout en gros plan sur un fond très différent.

### Rogner le clip (couper le début ou la fin)

**✂ Rogner**, sous l'aperçu, ouvre ta vidéo d'origine : fais glisser les deux
poignées bleues (ou place la lecture et clique **[ Début ici** / **Fin ici ]**,
ou tape les temps), vérifie avec **Lire la sélection**, puis **Rogner**.

- **L'original est conservé** : tu peux rouvrir la fenêtre pour rallonger, ou
  cliquer **Vidéo entière** pour tout annuler.
- Les **effets et sous-titres suivent la coupe**. Un effet placé dans une partie
  coupée est ramené au bord (le message le signale) ; les lignes de sous-titres
  coupées sont mises de côté — si tu rallonges, tout revient à sa place.
- La découpe du fond et le suivi des personnes se recalculent au prochain aperçu.

### Agrandir l'aperçu

Les bords des colonnes de gauche et de droite, et la ligne au-dessus de la
timeline, se **font glisser** : réduis les colonnes pour un aperçu plus grand.
Double-clic sur un bord : taille par défaut. La disposition est mémorisée.

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
- Collé sur un autre clip (ou en préréglage), un effet oublie l'**objet cliqué**
  et le **moment où il a été fixé dans le décor** : ils n'ont de sens que sur
  leur clip. Rechoisis l'objet, refais glisser l'effet sur son endroit.
- L'onglet **Bibliothèque d'effets** (en haut à droite) sert à créer et ranger
  tes préréglages par collections, avec un aperçu en direct.

### 6. Exporter

**Rendre le MP4** produit la vidéo. Les vidéos HDR des téléphones récents (HLG,
HDR10) sont converties en SDR à l'import — ou une fois, au premier export, pour
les clips plus anciens : sans ça, l'export ne contenait que la découpe. L'avancement s'affiche aussi dans le titre
de l'onglet (utile depuis une autre fenêtre) ; à la fin, **Ouvrir** la lance
dans QuickTime et **Afficher dans le Finder** la montre dans `renders/`. Tu peux
continuer à modifier pendant le rendu : il utilise l'état au moment du clic.

### 7. Promos de sites (motion design Remotion)

L'onglet **Promos** gère les vidéos promo de tes sites : une suite de scènes
animées (mots frappés sur le rythme, chiffres, avis, final) aux couleurs d'une
charte du studio, avec une musique générée calée sur l'image. Format par défaut :
**4:5 pour LinkedIn** (1080×1350).

- **Écrire le storyboard** : demande à Claude « fais une promo pour https://… ».
  La skill `promo-site` lit le site, ton backoffice et ton brief, te propose un
  storyboard à valider, crée la charte et la promo. Le bouton **+ Promo** en crée
  une vide si tu préfères partir de zéro.
- **Retoucher** : chaque scène a ses champs (textes, chiffres, citations…),
  sa durée en mesures et son énergie (intro, drop, pause, montée, final), qui
  pilote la musique et les flashes. `**mot**` = couleur d'accent, `*mot*` =
  italique, `|` = retour à la ligne. **Enregistrer** écrit le storyboard.
- **Charte** : choisis une charte du studio, elle est copiée dans la promo
  (couleurs, polices, logo).
- **Capturer le site** (page entière + thème de la vidéo tiré du site : clair
  ou sombre, dégradés, boutons), **Nouvelle musique** (chaque clic tire une
  musique propre à cette promo, jamais celle d'une autre), **Contrôler** (brouillon rapide + planche de 2 images
  par scène + **textes coupés ou qui se chevauchent, mesurés automatiquement** +
  bords + niveau sonore), **Rendre la vidéo finale** (encodage conforme
  LinkedIn, plus une **image de couverture**, la **fiche Project Hub** et le
  **texte du post**).
- **▶ sur une scène** : aperçu de cette scène seule en quelques secondes.
  **Aperçu interactif** : Remotion Studio, image par image, sans rendu.
- **Post LinkedIn** : un brouillon tiré du storyboard, à retoucher et copier.
  **Publier sur Project Hub** copie la demande à coller dans Claude.
- **Reprendre une scène d'une autre promo** (avec ses images), **Exporter la
  musique** seule, **Mettre à jour le moteur** d'une promo ancienne (l'ancien
  part à la Corbeille).
- Formats : 4:5 (LinkedIn), 9:16 (reels, stories) et 1:1 sont tous prêts.
- **Ajouter au montage** transforme la vidéo rendue en clip du projet ouvert,
  pour y ajouter des sous-titres ou des effets.
- **Supprimer** : le bouton sous une vidéo rendue l'envoie à la corbeille (le
  storyboard reste, tu peux la rendre à nouveau) ; la croix ✕ d'une promo, au
  survol dans la liste, envoie toute la promo à la corbeille. Rien n'est effacé
  pour de bon : tout se récupère depuis la Corbeille du Mac.
- **Cmd+S** enregistre le storyboard. La page **Stockage** montre aussi la place
  prise par les promos.

Les promos vivent hors du studio, dans `~/Code/promos/<nom>/` (avec une seule
installation de Remotion partagée, faite à la première promo). Le studio, lui,
reste sans dépendance.

---

## Où sont mes fichiers

Tout est dans le dossier du projet :

| Chemin | Contenu |
|---|---|
| `studio.json` | ta bibliothèque : projets, dossiers, effets, préréglages |
| `media/` | tes clips importés, leurs découpes, suivis, originaux après rognage, images et polices |
| `renders/` | les MP4 exportés |
| `~/Code/promos/` | les promos Remotion (hors du studio) : storyboard, charte copiée, musique, rendus dans `out/` |

Ces trois-là ne partent **pas** sur GitHub (ils sont personnels et lourds).
Pour sauvegarder ta bibliothèque, copie-les ailleurs.

### Voir et libérer de la place

L'onglet **Stockage** montre ce que pèse le studio, par catégorie et par clip,
et la place qui reste sur ton disque. En un clic :

- **Vider les caches** — découpes, suivis, fichiers de travail : sans risque,
  recalculés au prochain aperçu ;
- **Fichiers orphelins** — restes de clips supprimés ;
- **Images et polices inutilisées** — plus utilisées par aucun effet, préréglage
  ni charte ;
- **Rendre les rognages définitifs** — supprime les originaux gardés (tu ne
  pourras plus rallonger ces clips) ;
- **Rendus** — ouvre-les, affiche-les dans le Finder pour les déplacer, ou
  supprime-les.

Les vidéos des clips ne se suppriment pas ici (supprime le clip dans *Montage*),
et les fichiers d'origine sur ton Mac ne sont jamais touchés : le studio
travaille sur ses propres copies.

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
