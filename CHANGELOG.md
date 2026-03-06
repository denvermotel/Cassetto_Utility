# Changelog

## [0.06-beta] — 2026-03-06

### Nuovo
- **Supporto CU ricevute** (`Ric=CUK`): download massivo PDF di tutte le Certificazioni Uniche dell'anno selezionato. Il PDF viene generato via POST con la stessa logica del pulsante "Genera PDF" del portale
- **Report Excel CU**: genera un file `.xls` con elenco (dettaglio) e riepilogo. Per ogni CU, vengono recuperati automaticamente gli importi dal Quadro AU (Causale, Ammontare lordo, Imponibile, Ritenute a titolo di acconto) e la **denominazione del sostituto d'imposta** dal Quadro DA (campi DA001 002 e DA001 003)
- **Pulsante "Genera PDF CU"** nella pagina dettaglio CU per download diretto del PDF
- **Ricerche tributi F24** (`Ric=F24Sel`): supporto completo per la pagina di ricerca e i risultati. Download batch e Report Excel dei versamenti trovati. **Selettore Date** (Anno/Trimestre/Mese) nel tab "Ricerca per data versamento" per compilare automaticamente i campi Dal/Al
- **Link navigazione "Vai a CU" + "Vai a Versamenti"** sulle pagine generiche del cassetto (non F24/F23/CU)
- **Alert CU > 15**: se le CU da scaricare superano 15, mostra conferma prima dell'avvio (procedura non interrompibile)

### Modifiche
- **Excel fogli invertiti**: per tutti i report (F24/F23/CU/Ricerca F24) il primo foglio è ora "Elenco" (dettaglio), il secondo è "Riepilogo"
- **Excel CU — Denominazione Sostituto**: nuova colonna con cognome/denominazione dal quadro DA

### Fix
- Fix rilevamento pagina F24: regex per evitare conflitti tra `Ric=F24`, `Ric=F24Sel`, `Ric=DetF24Sel`

## [0.05-beta] — 2026-03-05

### Nuovo
- Conversione da bookmarklet a userscript Tampermonkey/Greasemonkey
- Monitoraggio URL dinamico, pagina Versamenti, storage persistente, tab riapertura, link istruzioni
- Grafica omogenea con FE-Utility, licenza GPL-3.0, pagina GitHub Pages

## [0.04-beta] — 2026-02-24

### Nuovo
- Supporto completo Modello F23: lista, dettaglio, download, Report Excel
- Rilevamento identificativo universale: PIVA, CF, PIVA delegato
- Badge differenziato: 👥 delegato / 🏢 PIVA / 👤 CF

## [0.03-beta] — 2026-02-24

### Nuovo
- Supporto cassetto delegato, Report Excel con raffronto, Log di sessione

## [0.02-beta] — 2026-02-24

### Nuovo
- Rinominato Cassetto_Utility, nomi file con PIVA+data, toggle Riepilogo

## [0.01-beta] — 2026-02-24

### Nuovo
- Prima release: barra fissa, batch download F24, fallback copia, toggle bookmarklet
