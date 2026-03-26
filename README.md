# 🧳 Cassetto_Utility

**Toolbox per il portale cassetto.agenziaentrate.gov.it**

Userscript per Tampermonkey / Greasemonkey che aggiunge una barra degli strumenti al Cassetto Fiscale dell'Agenzia delle Entrate, con download massivo F24/F23/CU e Report Excel.

[![Version](https://img.shields.io/badge/versione-0.07%20beta-green)](#)
[![License: GPL v3](https://img.shields.io/badge/licenza-GPL%20v3-blue)](https://www.gnu.org/licenses/gpl-3.0)
[![Tampermonkey](https://img.shields.io/badge/Tampermonkey-compatibile-brightgreen)](https://www.tampermonkey.net/)
[![Greasemonkey](https://img.shields.io/badge/Greasemonkey-compatibile-orange)](https://www.greasespot.net/)

---

> ⚠️ **VERSIONE IN FASE DI SVILUPPO E TEST**

---

## ⚡ Installazione rapida

> Richiede **Tampermonkey** (Chrome/Edge/Firefox) o **Greasemonkey** (Firefox)

1. Installa l'estensione del browser:
   - [Tampermonkey per Chrome](https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo)
   - [Tampermonkey per Firefox](https://addons.mozilla.org/it/firefox/addon/tampermonkey/)
   - [Greasemonkey per Firefox](https://addons.mozilla.org/it/firefox/addon/greasemonkey/)

2. Clicca il link di installazione:

   **[➤ Installa Cassetto_Utility.user.js](https://raw.githubusercontent.com/denvermotel/Cassetto_Utility/refs/heads/main/Cassetto_Utility.user.js)**

3. Accedi su [cassetto.agenziaentrate.gov.it](https://cassetto.agenziaentrate.gov.it) — la barra verde apparirà automaticamente.

---

## ✨ Funzionalità

### 🧳⬇ Scarica F24/F23
Download massivo delle quietanze/copie PDF per tutti i versamenti dell'anno selezionato.

### 🧳⬇ Scarica CU
Download massivo dei PDF di tutte le Certificazioni Uniche ricevute (`Ric=CUK`). Se le CU superano 15, viene mostrato un alert di conferma prima dell'avvio.

### 📊 Report Excel F24/F23
File `.xls` con Elenco (dettaglio) + Riepilogo e raffronto ✅/❌/⏳.

### 📊 Report Excel CU
File `.xls` con elenco e riepilogo di tutte le CU. Per ogni certificazione vengono recuperati automaticamente i dati dal quadro pertinente:

**CU Lavoro Autonomo** (Quadro AU — multi-modulo):
- **Causale** con descrizione estesa (es. A = lavoro autonomo, M = prestazioni occasionali)
- **Ammontare lordo corrisposto**
- **Imponibile**
- **Ritenute a titolo di acconto**

**CU Lavoro Dipendente** (Quadro DB — multi-modulo):
- **Redditi di lavoro dipendente e assimilati**
- **Ritenute IRPEF**
- **Addizionale regionale**
- **Addizionale comunale**

Per tutte le CU:
- **Denominazione sostituto d'imposta** (dal Quadro DA, campi DA001 002 e 003)
- **Tipo CU** (Autonomo / Dipendente / Altro) rilevato automaticamente
- **Supporto multi-modulo**: CU con più moduli generano una riga per ciascun modulo
- **Mappa completa causali**: 30 codici causale da normativa (A→ZO) con descrizione

### 🔍 Ricerche tributi F24
Supporto completo per la pagina "Ricerche tributi F24" (`Ric=F24Sel`):
- **Selettore Date** (Anno/Trimestre/Mese) nel tab "Ricerca per data versamento" per compilare automaticamente i campi Dal/Al
- **Filtro Codice Atto**: campo input nella barra per filtrare download e report per codice atto specifico. Pre-fetch del dettaglio di ogni F24 per estrarre il codice atto
- Download batch e Report Excel dai risultati di ricerca (con colonna Codice Atto)

### 🔄 Navigazione dinamica
La barra rileva automaticamente i cambi di pagina e aggiorna i pulsanti. Dalla pagina Versamenti, pulsanti diretti per F24/F23. Dalle pagine generiche, link rapidi "Vai a CU" e "Vai a Versamenti".

### 👥 Cassetto delegato
Rilevamento automatico PIVA delegato / PIVA propria / CF con cascata di priorità.

---

## 📋 Pulsanti per contesto

| Pulsante | Contesto | Descrizione |
|---|---|---|
| 🧳⬇ **Scarica F24** | Lista F24 / Ricerca F24 | Quietanza PDF o Copia F24 (fallback) |
| 🧳⬇ **Scarica F23** | Lista F23 | Copia PDF modello F23 |
| 🧳⬇ **Scarica CU** | Lista CU | Download massivo PDF CU via POST (alert se > 15) |
| 📊 **Report Excel** | Lista F24/F23 / Ricerca F24 | `.xls` con Elenco + Riepilogo |
| 📊 **Report Excel CU** | Lista CU | `.xls` con denominazione sostituto + importi da Quadro AU |
| 📋 **Protocolli** | Lista F24 | Copia data + protocollo in clipboard |
| 📅 **Selettore Date** | Ricerche tributi F24 | Anno/Trimestre/Mese → compila Dal/Al |
| 🎯 **Cod.Atto** (input) | Ricerche tributi F24 | Filtra download/report per codice atto |
| 🧳⬇ **Genera PDF CU** | Dettaglio CU | Download PDF singola CU |
| 🧳⬇ **Copia F24** | Dettaglio F24 | PDF copia modello F24 |
| 🧳⬇ **Quietanza** | Dettaglio F24 | Quietanza AdE |
| 🧳⬇ **Copia F23** | Dettaglio F23 | PDF copia modello F23 |
| 📄 **Vai a CU** / ⚠ **Vai a Versamenti** | Pagine generiche | Link di navigazione rapida |

---

## 🔧 Note tecniche

- Storage: `GM_setValue`/`GM_getValue` con fallback `localStorage`
- Monitoraggio URL ogni 500ms per aggiornamento dinamico pulsanti
- Download invisibile: fetch+blob con `<a download>` nascosto (nessuna tab aperta)
- CU PDF: generato via POST (`Ric=CUK, Anno, Protocollo, stampa=P, Fascicoli=SI, TipoStampa=C`)
- CU denominazione: fetch del Quadro DA con parsing HTML (campi DA001 002 e 003)
- CU importi autonomo: fetch del Quadro AU multi-modulo (Modulo=1…N) con parsing HTML
- CU importi dipendente: fetch del Quadro DB multi-modulo con parsing HTML
- CU causali: mappa completa di 30 codici causale da normativa (A→ZO)
- F24 codice atto: fetch pagina dettaglio con regex `codice atto <b>VALORE</b>`
- F24 quietanza: disponibile solo post 01/10/2006
- Excel: Foglio 1 = Elenco (dettaglio), Foglio 2 = Riepilogo
- Delay tra download: 600ms (F24/F23), 800ms (CU)
- Privacy: opera solo nel dominio `cassetto.agenziaentrate.gov.it`

---

## 📄 Licenza

[GPL-3.0](LICENSE)
