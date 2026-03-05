# 🧳 Cassetto_Utility

**Toolbox per il portale cassetto.agenziaentrate.gov.it**

Userscript per Tampermonkey / Greasemonkey che aggiunge una barra degli strumenti al Cassetto Fiscale dell'Agenzia delle Entrate, con download massivo F24/F23 e Report Excel con raffronto.

[![Version](https://img.shields.io/badge/versione-0.05%20beta-green)](#)
[![License: GPL v3](https://img.shields.io/badge/licenza-GPL%20v3-blue)](https://www.gnu.org/licenses/gpl-3.0)
[![Tampermonkey](https://img.shields.io/badge/Tampermonkey-compatibile-brightgreen)](https://www.tampermonkey.net/)
[![Greasemonkey](https://img.shields.io/badge/Greasemonkey-compatibile-orange)](https://www.greasespot.net/)

---

> ⚠️ **VERSIONE ANCORA IN FASE DI SVILUPPO E TEST**
> Funziona correttamente il download massivo F24/F23 e il Report Excel.

---

## ⚡ Installazione rapida

> Richiede **Tampermonkey** (Chrome/Edge/Firefox) o **Greasemonkey** (Firefox)

1. Installa l'estensione del browser:
   - [Tampermonkey per Chrome](https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo)
   - [Tampermonkey per Firefox](https://addons.mozilla.org/it/firefox/addon/tampermonkey/)
   - [Greasemonkey per Firefox](https://addons.mozilla.org/it/firefox/addon/greasemonkey/)

2. Clicca il link di installazione:

   **[➤ Installa Cassetto_Utility.user.js](https://raw.githubusercontent.com/denvermotel/Cassetto_Utility/refs/heads/main/Cassetto_Utility.user.js)**

   Tampermonkey aprirà automaticamente la finestra di conferma installazione.

3. Accedi su [cassetto.agenziaentrate.gov.it](https://cassetto.agenziaentrate.gov.it), naviga in **Versamenti → Modello F24** oppure **Versamenti → Modello F23**, seleziona l'anno — la barra verde apparirà automaticamente in cima alla pagina.

> ⚠️ Consenti sempre i download multipli quando il browser lo chiede per `agenziaentrate.gov.it`.

---

## ✨ Funzionalità

### 🧳⬇ Scarica F24/F23
Download massivo automatico dei PDF per tutti i versamenti dell'anno selezionato. Per F24: quietanza PDF (o Copia F24 come fallback). Per F23: copia PDF del modello. Lo stato viene salvato nello storage Tampermonkey per persistenza tra sessioni.

### 📊 Report Excel
Genera un file `.xls` con due fogli:
- **Riepilogo**: Identificativo, Modalità, Anno, Tipo modello, Data report, Versamenti trovati, Scaricati/Errori/Non scaricati
- **Dettaglio**: N°, Data, Importo, Protocollo (solo F24), Nome File, Stato — con colorazione righe (🟢 scaricato · 🔴 errore · 🟡 non scaricato)

### 📋 Protocolli
Copia in clipboard data + numero di protocollo di tutti i versamenti F24 visibili nella pagina.

### 🔍 Riepilogo
Toggle rapido nella barra: mostra/nasconde conteggi di versamenti trovati, quietanze e file scaricati.

### 👥 Cassetto delegato
Rilevamento automatico dell'identificativo con cascata di priorità:

| Priorità | Caso | Sorgente | Icona |
|---|---|---|---|
| 1 | Cassetto delegato | `div.section.border.border-primary.my-1.bg-light.px-3` → PIVA soggetto delegato | 👥 |
| 2a | Cassetto proprio – Società | `#user-info-data-container p.mb-2` → 11 cifre (PIVA) | 🏢 |
| 2b | Cassetto proprio – Persona fisica | `#user-info-data-container p.mb-2` → 16 caratteri (CF) | 👤 |
| 3 | Fallback | Primo numero 11 cifre in `#user-info` | 👤 |

---

## 📋 Differenze F24 vs F23

| Caratteristica | F24 | F23 |
|---|---|---|
| Quietanza disponibile | ✅ Sì (dal 01/10/2006) | ❌ No — solo copia PDF |
| Protocollo in lista | ✅ Visibile in tabella | ❌ Solo nel dettaglio |
| Nomi file | `…_QuietanzaF24_…` / `…_CopiaF24_…` | `…_CopiaF23_…` |

---

## 📁 Formato nomi file

| Tipo | Formato |
|---|---|
| Quietanza F24 | `CODICE_ANNO_MESE_GIORNO_QuietanzaF24_idxN.pdf` |
| Copia F24 | `CODICE_ANNO_MESE_GIORNO_CopiaF24_idxN.pdf` |
| Copia F23 | `CODICE_ANNO_MESE_GIORNO_CopiaF23_idxN.pdf` |
| Report Excel | `CODICE_ANNO_ReportF24_CassettoUtility.xls` / `…ReportF23…` |

`CODICE` = PIVA (11 cifre), CF (16 caratteri) o PIVA del delegato — estratto automaticamente.

**Esempi:**
```
09876543210_2025_03_15_QuietanzaF24_idx2.pdf   ← società delegata
VRDLCU75T10F205Z_2024_11_30_CopiaF24_idx0.pdf  ← persona fisica CF
03456789012_2023_04_27_CopiaF23_idx0.pdf        ← società PIVA
09876543210_2025_ReportF24_CassettoUtility.xls  ← report Excel
```

---

## 🔧 Note tecniche

- Lo storage usa `GM_setValue`/`GM_getValue` (Tampermonkey) con fallback su `localStorage`
- F24: quietanza disponibile solo post 01/10/2006 via servizi telematici AdE
- F23: solo copia PDF del modello
- Delay: 600 ms tra download
- Privacy: opera solo nel dominio `cassetto.agenziaentrate.gov.it`, nessun dato viene inviato a server esterni

### Compatibilità browser

| Browser | Estensione | Stato |
|---------|-----------|-------|
| Chrome / Chromium | Tampermonkey | 🔧 in fase di test |
| Firefox | Tampermonkey | 🔧 in fase di test |
| Firefox | Greasemonkey 4 | ❌ non testato |
| Edge | Tampermonkey | 🔧 in fase di test |

---

## 📄 File

| File | Descrizione |
|---|---|
| `Cassetto_Utility.user.js` | Userscript Tampermonkey/Greasemonkey |
| `index.html` | Pagina GitHub Pages con istruzioni |
| `README.md` | Questo file |
| `CHANGELOG.md` | Storico versioni |

---

## 📄 Licenza

[GPL-3.0](LICENSE)
