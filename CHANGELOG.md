# Changelog

## [0.10-beta] — 2026-08-17

### Nuovo
- **Dichiarazioni di intento**: scarico PDF in blocco dall'elenco (`Ric=DEN`), Report Excel con dichiarante, destinatario, casella dogana, tipo operazione e soglie, PDF singolo dal dettaglio
- **Resoconto con × di chiusura**: senza errori si chiude da sé dopo 20s, altrimenti resta finché non la si chiude a mano; il mouse sopra sospende la chiusura automatica

### Fix
- Barra, linguetta, dialoghi e selettore periodo restavano nel foglio in stampa: ora spariscono con `@media print`, tranne la barra (stile inline `!important`) tolta a mano su `beforeprint`/`afterprint`
- Barra sul sito di presentazione disallineata da quella vera: mancavano il pulsante Protocolli, la × di chiusura, il numero di versione
- Report Excel salvati come `.xlsx` vero: prima erano XML con estensione `.xls`, ed Excel avvertiva del formato a ogni apertura
- Cassetto delegato con cliente persona fisica: si cercava solo la partita IVA e si finiva sul codice dello studio. Ora si cerca prima il codice fiscale; se nessuno dei due si legge, esce `DELEGANTE` invece di un codice plausibile e sbagliato

## [0.09-beta] — 2026-08-09

Allineamento a [FE-Utility](https://github.com/denvermotel/fe-utility): stessa interfaccia, stessi temi, stesso confezionamento delle estensioni. Le funzioni sono quelle della 0.08.

### Nuovo
- **Estensioni Chrome e Firefox** dallo stesso sorgente dello userscript. `estensione/pacchetto.sh` produce gli zip e avverte se la versione dei manifest non corrisponde. L'icona apre un menu con i salti alle sezioni e le impostazioni; scarichi e report restano nella barra
- **Quattro temi di colore** (Ardesia e ottone, Notte nordica, Blu notte e ambra, Grafite e menta), scelti dal pannello impostazioni e salvati fra le sessioni
- **Pannello impostazioni** nella barra: quietanza o copia per gli F24 quietanzati, conferma sui lotti lunghi, tema, e — come estensione — se l'icona apre il menu o la barra
- **Conferma prima dei lotti lunghi** estesa a F24 e F23, non più solo alle CU
- **Importi come numeri nei fogli**, formato `#,##0.00`, sommabili in Excel senza conversioni; un valore non riconosciuto resta testo, una cella vuota resta vuota
- **Verifiche statiche** (`node test/esegui.mjs`): versioni allineate fra script e manifest, requisiti degli store, corrispondenza comandi menu/azioni, contrasti dei temi

### Modifiche
- **Barra ridisegnata**: tre tinte di pulsante per ruolo (accento, ardesia, contorno) al posto dei sette colori della 0.08
- **Esito detto dal colore e dalle parole**, non da un'emoji
- **Deposito unico** su tre ambienti (`GM_setValue`, `chrome.storage.local`, `localStorage`), letture sincrone da cache
- **Selettore del periodo** con palette chiara, perché vive nel form bianco del cassetto
- **Altezza della barra** aggiornata con `ResizeObserver` invece del controllo ogni 600 ms
- **Pagina delle istruzioni** rifatta sull'impalcatura del gemello, con `docs/privacy.html`

### Fix
- Il dialogo di conferma non costruisce più il contenuto con `innerHTML` da testo digitato dall'utente (filtro codice atto)
- **Zeri mancanti nei report**: `esc()` trasformava lo zero in stringa vuota nei contatori dei fogli Riepilogo
- **File HTML salvati come PDF**: il riconoscimento era sulla dimensione, ora sui primi byte (`%PDF`)
- **Preferenza persa cambiandola dal menu**: la rilettura poteva arrivare prima della scrittura e riportare indietro il valore. Ora viaggia nel messaggio
- **Barra bloccata dopo un errore** a metà di un lotto, senza sblocco dei pulsanti
- **Su Firefox la barra poteva non comparire**: `browser.*` restituisce promesse e ignora la callback. Ora si accettano entrambe le forme, con un tempo massimo
- Il cambio di tema non cancella più l'avanzamento di uno scarico in corso né anno/periodo scelti
- La copia dei protocolli dice quando non riesce, invece di tacere
- La × e l'ingranaggio sono disabilitati durante un lotto
- Rimosso un registro degli scarichi che nessuno rileggeva mai

## [0.08-beta] — 2026-06-18

### Nuovo
- **Report "Dettaglio tributi F24"**: una riga per codice tributo/causale, letta dal dettaglio di ogni F24 dell'anno. Colonne: data, protocollo, sezione (Erario/INPS/INAIL/Regioni/IMU…), codice, descrizione, anno di riferimento, codice atto, credito e debito. Riepilogo con conteggio F24 e righi

## [0.07-beta] — 2026-03-26

### Nuovo
- **CU multi-tipo**: supporto completo per CU lavoro autonomo (Quadro AU) e lavoro dipendente (Quadro DB). Il Report Excel riconosce automaticamente il tipo di CU e mostra i campi pertinenti (autonomo: Causale, Ammontare lordo, Imponibile, Ritenute acconto; dipendente: Redditi lav.dip., Ritenute IRPEF, Addizionale regionale, Addizionale comunale)
- **CU multi-modulo**: iterazione automatica su Modulo 1…N per CU con più moduli. Ogni modulo genera una riga separata nel Report Excel
- **Mappa causali CU**: tabella completa dei 30 codici causale da normativa (A→ZO) con descrizione estesa nel Report Excel
- **Report Excel CU**: nuove colonne "Tipo CU" (Autonomo/Dipendente/Altro), "Modulo", "Descrizione Causale". Riepilogo con conteggio per tipo
- **Filtro Codice Atto** per Ricerche tributi F24: campo input nella barra strumenti. Se valorizzato, pre-fetch del dettaglio di ogni F24 per estrarre il codice atto e filtrare prima del download. Alert conferma con conteggio risultati filtrati
- **Report Excel Ricerca F24**: nuova colonna "Codice Atto" estratta dal dettaglio di ogni versamento (fetch automatico)
- **CU tipo "Altro"**: per CU che non hanno né Quadro AU né Quadro DB, viene inserita una riga con tipo "Altro"

### Modifiche
- **Report Excel CU — colonne importi generiche**: le colonne importo sono ora etichettate in modo generico ("Importo 1/2/3/4") per accogliere sia i campi AU che DB
- **Stili Excel CU**: aggiunti stili colorati per tipo Autonomo (azzurro) e Dipendente (arancio) nel riepilogo

### Confermato
- **Download invisibile** (fetch+blob, nessuna tab aperta): confermato funzionante su tutti i percorsi F24/F23/CU/Ricerca F24

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
