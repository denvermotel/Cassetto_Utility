# Cassetto_Utility

Toolbox per il Cassetto Fiscale dell'Agenzia delle Entrate
(`cassetto.agenziaentrate.gov.it`). Scarica in blocco F24, F23 e certificazioni
uniche, e li ribalta in fogli di calcolo fino al singolo codice tributo.
Funziona sul cassetto proprio e su quello in delega.

Gira come userscript sotto Tampermonkey e come estensione Chrome o Firefox:
è lo stesso identico file.

[![Versione](https://img.shields.io/badge/versione-0.09%20beta-C9962F)](CHANGELOG.md)
[![Licenza: GPL v3](https://img.shields.io/badge/licenza-GPL%20v3-blue)](https://www.gnu.org/licenses/gpl-3.0)
[![Tampermonkey](https://img.shields.io/badge/Tampermonkey-compatibile-brightgreen)](https://www.tampermonkey.net/)
[![Greasemonkey](https://img.shields.io/badge/Greasemonkey-compatibile-orange)](https://www.greasespot.net/)

Progetto gemello: [FE-Utility](https://github.com/denvermotel/fe-utility), che
fa lo stesso mestiere sul portale Fatture e Corrispettivi. I due condividono
impalcatura, temi e modo di confezionare le estensioni.

---

## Installazione rapida

Richiede **Tampermonkey** (Chrome, Edge, Firefox) o **Greasemonkey** (Firefox).
In alternativa, si attendono le estensioni sugli store: vedi in fondo.

1. Installa il gestore di userscript:
   [Tampermonkey per Chrome](https://chromewebstore.google.com/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo) ·
   [per Firefox](https://addons.mozilla.org/it/firefox/addon/tampermonkey/) ·
   [Greasemonkey](https://addons.mozilla.org/it/firefox/addon/greasemonkey/)

2. Su **Chrome ed Edge**, attiva «Consenti script utente» nei dettagli di
   Tampermonkey (`chrome://extensions`). È obbligatorio: senza, non parte nulla
   e non compare nessun errore. È la prima cosa da controllare quando qualcuno
   segnala che «non funziona».

3. Installa lo script:
   **[Cassetto_Utility.user.js](https://raw.githubusercontent.com/denvermotel/Cassetto_Utility/refs/heads/main/Cassetto_Utility.user.js)**

4. Accedi a [cassetto.agenziaentrate.gov.it](https://cassetto.agenziaentrate.gov.it):
   la barra compare da sé.

Istruzioni per esteso, browser per browser:
[denvermotel.github.io/Cassetto_Utility](https://denvermotel.github.io/Cassetto_Utility/)

---

## Funzionalità

I comandi disponibili dipendono dalla pagina aperta: il cassetto è un sito a
pagine vere, e ognuna offre cose diverse.

| Pagina | Comandi |
|---|---|
| Elenco F24 | Scarica F24, Report Excel, Dettaglio tributi, Protocolli, Riepilogo |
| Elenco F23 | Scarica F23, Report Excel, Riepilogo |
| Elenco CU | Scarica CU, Report Excel CU, Riepilogo |
| Ricerca tributi F24 | Periodo; con i risultati anche Scarica F24, Report Excel, filtro per codice atto |
| Dettaglio di un versamento | Copia del modello e, per gli F24 quietanzati, la quietanza |
| Dettaglio CU | Genera PDF CU |
| Altre pagine | I salti a Versamenti e Certificazioni uniche |

### Scarica F24, F23 e CU

Tutti i documenti dell'anno selezionato in PDF, uno dopo l'altro. Non si apre
nessuna scheda: il file si chiede con `fetch` usando i cookie di sessione già
presenti e si salva come blob.

Per gli F24 quietanzati si scarica la quietanza, che è la prova del pagamento;
chi archivia il modello può invertire la scelta dalle impostazioni.

Un lotto avviato **non si interrompe**. Oltre i quindici documenti la barra
chiede conferma prima di partire.

I nomi dei file sono `CODICE_ANNO_MM_GG_TIPO_idxN.pdf`, così ordinandoli per
nome si ordinano per data.

### Dettaglio tributi F24

Il report che il cassetto non offre. Legge il dettaglio di ogni F24 dell'anno e
produce un foglio con **una riga per codice tributo**:

| Colonna | Da dove |
|---|---|
| Data versamento, Protocollo | Elenco |
| Sezione (Erario, INPS, INAIL, Regioni, IMU…) | Dettaglio |
| Codice tributo, Descrizione | Dettaglio |
| Rateazione, regione o provincia, mese di riferimento | Dettaglio |
| Anno di riferimento | Dettaglio |
| Codice atto | Dettaglio |
| Importo a credito e a debito, in colonne separate | Dettaglio |

È una lettura per documento, quindi è la funzione lenta: un anno con sessanta
F24 sono sessanta richieste.

### Report Excel F24, F23 e ricerca

Due fogli: l'elenco dei versamenti con lo stato di ogni scarico, e un
riepilogo. Serve al riscontro fra quello che il cassetto dichiara e quello che
è finito sul disco.

Le colonne d'importo sono numeri veri, non testo: si sommano in Excel senza
conversioni. La conversione è prudente - un valore che non si riconosce come
importo resta scritto com'era invece di diventare uno zero, e una casella vuota
sul modello resta vuota nel foglio.

### Report Excel CU

Una riga per ogni modulo di ogni certificazione, con il quadro riconosciuto
automaticamente:

| Tipo | Quadro | Colonne |
|---|---|---|
| Lavoro autonomo | AU | Causale con descrizione per esteso, ammontare lordo, imponibile, ritenute d'acconto |
| Lavoro dipendente | DB | Redditi, ritenute IRPEF, addizionale regionale, addizionale comunale |
| Altro | — | Una riga, senza importi |

Per tutte: la denominazione del sostituto d'imposta, letta dal quadro DA. Le
causali sono la tabella completa da normativa, trenta codici da `A` a `ZO`.

### Ricerca per codice atto

Nella pagina delle ricerche tributi, un campo nella barra. Se valorizzato, il
codice atto di ogni risultato viene letto dal dettaglio e download e report si
limitano a quelli che corrispondono.

### Selettore del periodo

Compare nel form di ricerca del cassetto: anno e trimestre o mese, e le due
date si compilano da sole. L'ultimo giorno del periodo è calcolato, non
scritto: febbraio e gli anni bisestili vengono giusti, e un periodo che
finirebbe nel futuro si ferma a oggi.

### Impostazioni

Dal pannello che si apre con l'ingranaggio nella barra.

| Preferenza | |
|---|---|
| Quietanza o copia | Per gli F24 quietanzati, quale dei due scaricare |
| Conferma sui lotti lunghi | La domanda oltre i quindici documenti |
| Come aprire lo strumento | Solo come estensione: menu sull'icona o barra nella pagina |

| Tema | |
|---|---|
| Ardesia e ottone | Predefinito. Fondo freddo, accento caldo: la distanza maggiore dal blu del cassetto |
| Notte nordica e ottanio | Tinte desaturate, per le sessioni lunghe |
| Blu notte e ambra | Vicino ai gestionali contabili |
| Grafite e menta | Il più sobrio, ed è quello di FE-Utility |

---

## Note tecniche

Il cassetto è un sito a pagine vere servite da una servlet, non
un'applicazione a vista singola: ogni documento è una richiesta, e non esiste
una via breve per averli tutti insieme.

Non si toccano interfacce interne per ottenere dati che il cassetto non mostri
già: si leggono le stesse pagine che vedrebbe una persona. Uno script che si
appoggia a endpoint non documentati si rompe in silenzio dopo un aggiornamento
lato Agenzia; uno che legge il DOM si rompe in modo visibile.

Le preferenze stanno in locale e non escono mai dal browser: `GM_setValue`
sotto Tampermonkey, `chrome.storage.local` nelle estensioni, `localStorage`
come ripiego. Un'unica interfaccia sopra i tre, con letture sincrone da cache e
scritture accorpate. Dettagli in [`docs/privacy.html`](docs/privacy.html).

Nessun font esterno e nessuna dipendenza a runtime: la CSP del cassetto li
bloccherebbe comunque.

### Compatibilità browser

| Browser | Gestore | Stato |
|---|---|---|
| Chrome, Chromium, Edge | Tampermonkey | Funzionante (richiede «Consenti script utente») |
| Firefox | Tampermonkey | Funzionante |
| Safari | Userscripts (Mac App Store) | Non collaudato sulla 0.09 |
| Firefox | Greasemonkey 4 | Non collaudato |

---

## Estensioni Chrome e Firefox

Lo stesso sorgente dello userscript, confezionato per i due store. Nessun
passaggio manuale di attivazione: si installa e basta.

L'icona apre un menu con i salti alle sezioni del cassetto e le impostazioni.
Gli scarichi e i report restano nella barra, e non è una dimenticanza: quei
comandi cambiano da pagina a pagina, e un elenco di pulsanti per metà spenti
direbbe meno di una barra che mostra solo quelli che in quel momento
funzionano.

A differenza di FE-Utility, il content script gira nel **mondo isolato**: qui
non serve leggere variabili della pagina, quindi `chrome.storage` si raggiunge
direttamente e il ponte su `postMessage` che il gemello è costretto ad avere
non esiste.

Per confezionare i pacchetti:

```bash
./estensione/pacchetto.sh
```

Copia i file comuni nelle due cartelle, produce gli zip e avverte se la
versione dei manifest non corrisponde a quella dello script.

Per provarle senza pubblicarle:

- **Chrome** — `chrome://extensions`, Modalità sviluppatore, Carica estensione
  non pacchettizzata, cartella `estensione/chrome`
- **Firefox** — `about:debugging`, Questo Firefox, Carica componente
  aggiuntivo temporaneo, file `estensione/firefox/manifest.json`

## Licenza

[GPL-3.0](LICENSE). Fornito così com'è, senza garanzie.
Non è un prodotto dell'Agenzia delle Entrate.
