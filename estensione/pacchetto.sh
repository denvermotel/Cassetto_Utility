#!/usr/bin/env bash
#
# Prepara i pacchetti delle estensioni per i due store.
#
# Non è una compilazione: copia i file e li comprime. Il sorgente resta quello
# leggibile, che è anche ciò che AMO vuole vedere.
#
#   ./estensione/pacchetto.sh
#
set -euo pipefail

QUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RADICE="$(dirname "$QUI")"
SORGENTE="$RADICE/Cassetto_Utility.user.js"

[ -f "$SORGENTE" ] || { echo "Manca $SORGENTE"; exit 1; }

# La versione dichiarata nei manifest deve corrispondere a quella dello script,
# altrimenti si pubblica un pacchetto che dice una cosa e ne contiene un'altra.
#
# Le due forme non coincidono e non possono: lo userscript usa 0.09-beta, che
# Tampermonkey capisce e mostra all'utente; gli store pretendono cifre e punti,
# quindi 0.9.0. La corrispondenza si verifica normalizzando, non a occhio.
VERSIONE_SCRIPT="$(grep -m1 '^// @version' "$SORGENTE" | awk '{print $3}')"

# 0.09-beta  ->  0.9.0
normalizza() {
  local v="${1%%-*}"                       # via il suffisso -beta
  local maggiore="${v%%.*}"
  local minore="${v#*.}"
  minore="$((10#$minore))"                 # 09 -> 9, senza farlo leggere in ottale
  echo "$maggiore.$minore.0"
}
VERSIONE_ATTESA="$(normalizza "$VERSIONE_SCRIPT")"
echo "Versione dello userscript: $VERSIONE_SCRIPT (nei manifest: $VERSIONE_ATTESA)"

for BROWSER in chrome firefox; do
  DEST="$QUI/$BROWSER"
  VERSIONE_MANIFEST="$(grep -m1 '"version"' "$DEST/manifest.json" | sed 's/.*"version"[^"]*"\([^"]*\)".*/\1/')"

  if [ "$VERSIONE_MANIFEST" != "$VERSIONE_ATTESA" ]; then
    echo "  ATTENZIONE $BROWSER: manifest $VERSIONE_MANIFEST, atteso $VERSIONE_ATTESA"
  fi

  rm -rf "$DEST/icone" "$DEST/servizio.js" "$DEST/menu.js" "$DEST/menu.html" "$DEST/Cassetto_Utility.user.js"

  # Solo le misure dichiarate nei manifest: il resto sarebbe peso morto
  # spedito agli store
  mkdir -p "$DEST/icone"
  for M in 16 32 48 128; do
    cp "$QUI/comune/icone/$M.png" "$DEST/icone/$M.png"
  done

  cp "$QUI/comune/servizio.js" "$QUI/comune/menu.js" "$QUI/comune/menu.html" "$DEST/"
  cp "$SORGENTE" "$DEST/"

  ZIP="$QUI/cassetto-utility-$BROWSER-$VERSIONE_MANIFEST.zip"
  rm -f "$ZIP"
  # -x esclude i file di sistema a qualsiasi profondità, non solo in cima
  ( cd "$DEST" && zip -q -r -X "$ZIP" . -x '.*' '*/.*' '__MACOSX/*' )
  echo "  $BROWSER: $(basename "$ZIP")"
done

echo
echo "Prova prima di pubblicare:"
echo "  Chrome   chrome://extensions, Modalita sviluppatore, Carica estensione non pacchettizzata -> estensione/chrome"
echo "  Firefox  about:debugging, Questo Firefox, Carica componente aggiuntivo temporaneo -> estensione/firefox/manifest.json"
