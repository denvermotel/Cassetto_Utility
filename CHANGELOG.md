# Changelog

## [0.09-beta] — 2026-08-09

Versione di allineamento al progetto gemello [FE-Utility](https://github.com/denvermotel/fe-utility):
stessa impalcatura dell'interfaccia, stessi temi, stesso modo di confezionare le
estensioni. Le funzioni sono quelle della 0.08; cambia come si presentano e dove
si possono usare.

### Nuovo
- **Estensioni Chrome e Firefox**: lo stesso sorgente dello userscript, confezionato
  per i due store. `estensione/pacchetto.sh` produce gli zip e avverte se la versione
  dei manifest non corrisponde a quella dello script. L'icona apre un menu con i salti
  alle sezioni del cassetto e le impostazioni; scarichi e report restano nella barra,
  perché dipendono dalla pagina aperta e un popup non sa quale sia
- **Quattro temi di colore** (Ardesia e ottone, Notte nordica, Blu notte e ambra,
  Grafite e menta), scelti dal pannello impostazioni e salvati fra le sessioni. Sono
  gli stessi di FE-Utility; il valore di partenza è diverso apposta, così due barre
  aperte insieme non si confondono
- **Pannello impostazioni** nella barra: quietanza o copia per gli F24 quietanzati,
  conferma sui lotti lunghi, tema, e - come estensione - se l'icona apre il menu o la barra
- **Conferma prima dei lotti lunghi estesa a F24 e F23**: fino alla 0.08 la chiedevano
  solo le CU, ma il tempo di attesa non dipende dal tipo di documento
- **Importi come numeri nei fogli**: le colonne d'importo di tutti e quattro i report
  escono come numeri veri, con formato `#,##0.00`, e si sommano in Excel senza
  conversioni. La conversione è prudente: un valore che non si riconosce come importo
  resta testo com'era, senza inventare uno zero, e una casella vuota resta vuota
- **Verifiche statiche** (`node test/esegui.mjs`): versioni allineate fra script e
  manifest, requisiti degli store, corrispondenza fra i comandi del menu e le azioni
  dello userscript, contrasti di tutti i temi, conversione degli importi

### Modifiche
- **Barra ridisegnata**: tre tinte di pulsante secondo il ruolo - accento per l'azione
  principale della pagina, ardesia per quelle di contorno, contorno vuoto per la
  navigazione - al posto dei sette colori della 0.08, che erano un colore per pulsante
  e non distinguevano niente
- **Esito detto dal colore e dalle parole**, non da un'emoji davanti al testo
- **Deposito unico** su tre ambienti (`GM_setValue`, `chrome.storage.local`,
  `localStorage`) con letture sincrone da cache e scritture accorpate
- **Selettore del periodo** rifatto con la palette chiara, perché vive nel form bianco
  del cassetto e un blocco scuro là in mezzo si legge come un errore di impaginazione
- **Altezza della barra**: aggiornata quando cambia davvero, con un `ResizeObserver`
  come rete di sicurezza, al posto del controllo ogni 600 ms per tutta la sessione
- **Pagina delle istruzioni** rifatta sulla stessa impalcatura del gemello, con
  l'informativa privacy in `docs/privacy.html`

### Fix
- Il dialogo di conferma non costruisce più il proprio contenuto con `innerHTML` a
  partire da testo digitato dall'utente: il filtro per codice atto ci finiva dentro
- **Zeri mancanti nei report**: `esc()` trasformava lo zero in stringa vuota, e uno
  zero finisce in celle dichiarate `ss:Type="Number"`. Colpiva i contatori dei fogli
  Riepilogo di tutti e quattro i report nel caso più comune, quello del report
  generato senza aver scaricato nulla
- **File HTML salvati come PDF**: il riconoscimento si basava sulla dimensione del
  file, e una pagina di sessione scaduta la supera. Ora si guardano i primi byte, che
  in un PDF sono `%PDF`: quei documenti finivano sul disco con estensione `.pdf` e
  venivano riportati «Scaricato» nel foglio
- **Preferenza persa cambiandola dal menu**: il menu invitava la pagina a rileggere lo
  storage, ma la propria scrittura era asincrona e non attesa, e la rilettura poteva
  riportare indietro il valore appena cambiato. Ora il valore viaggia nel messaggio
- **Barra bloccata dopo un errore**: un'eccezione a metà di un lotto saltava lo
  sblocco dei pulsanti e lasciava la barra inerte fino al ricaricamento, senza dirlo
- **Su Firefox la barra poteva non comparire affatto**: `browser.*` restituisce
  promesse e ignora la callback, e l'avvio aspetta la lettura delle preferenze prima
  di disegnare. Ora si accettano entrambe le forme, con un tempo massimo oltre il
  quale si parte con i valori predefiniti
- Il cambio di tema non cancella più l'avanzamento di uno scarico in corso, e non
  perde più anno e periodo scelti nel selettore
- La copia dei protocolli negli appunti dice quando non riesce, invece di tacere
- La × e l'ingranaggio sono disabilitati durante un lotto: chiuderla non lo fermava,
  toglieva solo il modo di vederlo
- Rimossa la scrittura di un registro degli scarichi che nessuno rileggeva mai e che
  cresceva a ogni anno interrogato

## [0.08-beta] — 2026-06-18

### Nuovo
- **Report "Dettaglio Tributi F24"**: nuovo pulsante 📑 nella lista F24 che legge il dettaglio di ogni F24 dell'anno selezionato (fetch sequenziale con barra di avanzamento) e genera un Excel con **una riga per ogni codice tributo/causale**. Colonne: Data versamento, Protocollo, Sezione (Erario/INPS/INAIL/Regioni/IMU…), Codice tributo, Descrizione (dal dettaglio, dove presente), Rateazione/regione/provincia/mese rif., Anno di riferimento, Codice atto, Importo a credito e Importo a debito separati. Foglio di riepilogo con conteggio F24 letti e righi totali

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
