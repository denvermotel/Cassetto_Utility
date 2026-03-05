# Changelog

## [0.05-beta] — 2026-03-05

### Nuovo
- **Conversione a Tampermonkey/Greasemonkey**: lo script non è più un bookmarklet ma un userscript con header `==UserScript==`, installabile direttamente dal browser. Compatibile con Tampermonkey (Chrome/Edge/Firefox) e Greasemonkey (Firefox)
- **Monitoraggio URL dinamico**: polling ogni 500ms rileva i cambi di pagina e ricostruisce automaticamente i pulsanti della barra. Non serve più ricaricare la pagina quando si naviga tra le sezioni del Cassetto Fiscale
- **Pagina Versamenti (Ric=VERS)**: sulla pagina hub dei versamenti la barra mostra i pulsanti "📄 Modello F24" e "📄 Modello F23" per navigazione diretta. Badge "Versamenti" visibile
- **Storage persistente** (`GM_setValue`/`GM_getValue`): il log dei download viene salvato nello storage Tampermonkey (persistente tra sessioni e aggiornamenti script). Fallback automatico su `localStorage` se non disponibile
- **Tab riapertura** barra dopo chiusura con ✕ (prima la chiusura era definitiva nel bookmarklet)
- **Link istruzioni** (ℹ️) nella barra, posizionato a destra vicino alla ✕
- **Grafica barra omogenea con FE-Utility**: stessa struttura CSS (`#CU_Panel`, `#CU_TopRow`, `#CU_BottomRow`), stessi colori, stessa logica di padding dinamico
- **Anti-doppio avvio**: se lo script è già caricato, il pannello viene semplicemente mostrato/nascosto (toggle)
- **Padding dinamico**: `padding-top` del `<body>` calcolato sull'altezza reale della barra e aggiornato ogni 600ms
- **Licenza GPL-3.0** allineata a FE-Utility
- **Pagina GitHub Pages** (`index.html`) con istruzioni, anteprima barra, changelog
- **Metadata Tampermonkey**: `@downloadURL`, `@updateURL`, `@namespace`, `@homepageURL`, `@supportURL`, `@grant GM_setValue/GM_getValue/GM_info/unsafeWindow`

## [0.04-beta] — 2026-02-24

### Nuovo
- Emoticon unificata **🧳** per tutti i documenti e pulsanti
- Supporto completo **Modello F23**: lista, dettaglio, download, Report Excel
- Rilevamento identificativo universale: PIVA (11 cifre), CF (16 char), PIVA delegato — con cascata di priorità
- Badge differenziato: 👥 delegato / 🏢 PIVA / 👤 CF
- Etichetta tipo documento (F24/F23) visibile in barra

### Fix
- Report Excel — colonna Protocollo solo per F24

## [0.03-beta] — 2026-02-24

### Nuovo
- Supporto cassetto delegato
- Report Excel con raffronto lista sito vs file scaricati
- Log di sessione per tracking download

## [0.02-beta] — 2026-02-24

### Nuovo
- Rinominato Cassetto_Utility (da nome generico)
- Nomi file con PIVA+data nel pattern
- Toggle Riepilogo nella barra

## [0.01-beta] — 2026-02-24

### Nuovo
- Prima release: barra fissa, batch download F24, fallback copia, toggle bookmarklet
