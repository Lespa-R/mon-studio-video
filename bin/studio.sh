#!/usr/bin/env bash
# Mon Studio Vidéo — lance le studio et ouvre le navigateur.
#
#   npm run studio          depuis le dossier du projet
#   double-clic             sur « Mon Studio Vidéo.command » (Bureau)
#
# La fenêtre du Terminal EST le studio : la fermer (ou Ctrl-C) l'arrête.
set -uo pipefail

cd "$(dirname "$0")/.."
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

say()  { printf '  %s\n' "$*"; }
fail() { printf '\n  ✗ %s\n\n' "$*"; read -r -p "  Appuie sur Entrée pour fermer… " _; exit 1; }

printf '\n  Mon Studio Vidéo\n  ────────────────\n'

# ---- prérequis
command -v node >/dev/null   || fail "Node.js introuvable. Installe-le : brew install node"
major=$(node -p 'process.versions.node.split(".")[0]')
[ "$major" -ge 22 ]          || fail "Node $major trop ancien (22+ requis). Mets à jour : brew upgrade node"
command -v ffmpeg >/dev/null || fail "ffmpeg introuvable. Installe-le : brew install ffmpeg"
command -v swiftc >/dev/null || fail "swiftc introuvable. Installe les outils Xcode : xcode-select --install"

# ---- déjà lancé ? on ouvre le navigateur — sauf si le code a changé depuis :
# un serveur lancé avant une mise à jour (parfois en arrière-plan, sans fenêtre
# à fermer) garderait l'ancien code. On l'arrête et on repart sur le neuf.
if [ -f .studio-port ]; then
  port=$(cat .studio-port)
  if curl -s -o /dev/null -w '%{http_code}' --max-time 2 "http://localhost:$port/api/state" | grep -q 200; then
    newer=$(find server lib -name '*.mjs' -newer .studio-port | head -1)
    if [ -z "$newer" ]; then
      say "Déjà lancé sur http://localhost:$port — ouverture du navigateur."
      open "http://localhost:$port"
      exit 0
    fi
    say "Le studio a été mis à jour depuis son lancement : redémarrage…"
    old=$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null)
    [ -n "$old" ] && kill $old 2>/dev/null
    for _ in $(seq 1 20); do lsof -tiTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1 || break; sleep 0.25; done
  fi
fi
rm -f .studio-port

# ---- démarrage, puis ouverture dès que le serveur répond
node server/server.mjs &
server=$!
trap 'kill $server 2>/dev/null; rm -f .studio-port; printf "\n  Studio arrêté.\n\n"' EXIT INT TERM

for _ in $(seq 1 60); do
  if [ -f .studio-port ]; then
    port=$(cat .studio-port)
    if curl -s -o /dev/null --max-time 1 "http://localhost:$port/api/state"; then
      open "http://localhost:$port"
      say "Ferme cette fenêtre (ou Ctrl-C) pour arrêter le studio."
      break
    fi
  fi
  kill -0 $server 2>/dev/null || fail "Le serveur s'est arrêté au démarrage (voir le message ci-dessus)."
  sleep 0.5
done

wait $server
