// ==UserScript==
// @name           Cassetto_Utility
// @namespace      https://denvermotel.github.io/Cassetto_Utility/
// @downloadURL    https://raw.githubusercontent.com/denvermotel/Cassetto_Utility/refs/heads/main/Cassetto_Utility.user.js
// @updateURL      https://raw.githubusercontent.com/denvermotel/Cassetto_Utility/refs/heads/main/Cassetto_Utility.user.js
// @version        0.10-alpha
// @description    Toolbox per cassetto.agenziaentrate.gov.it: download massivo F24/F23/CU, Report Excel, supporto cassetto proprio e delegato
// @author         denvermotel
// @match          https://cassetto.agenziaentrate.gov.it/*
// @include        https://cassetto.agenziaentrate.gov.it/*
// @icon           https://www.agenziaentrate.gov.it/portale/documents/20152/0/favicon/249a8c43-e3c2-26e4-3bfb-90d79bff7332
// @grant          GM_setValue
// @grant          GM_getValue
// @grant          unsafeWindow
// @run-at         document-idle
// @noframes
// @license        GPL-3.0-or-later
// @homepageURL    https://denvermotel.github.io/Cassetto_Utility/
// @supportURL     https://github.com/denvermotel/Cassetto_Utility/issues
// ==/UserScript==

/**
 * Cassetto_Utility
 * Toolbox per il portale cassetto.agenziaentrate.gov.it
 *
 * Lo stesso file gira sia come userscript sotto Tampermonkey sia come content
 * script delle estensioni Chrome e Firefox: il blocco di intestazione qui sopra
 * e' fatto di commenti e un browser lo ignora.
 *
 * A differenza del gemello FE-Utility, qui il content script sta nel mondo
 * ISOLATO e non nel principale. FE-Utility deve vivere nel mondo della pagina
 * perche' gli serve `angular`; Cassetto_Utility legge soltanto il DOM e fa
 * `fetch` con i cookie di sessione, quindi `chrome.storage` e' raggiungibile
 * direttamente e il ponte su postMessage che il gemello e' costretto ad avere
 * qui non esiste, insieme alla superficie di attacco che si porta dietro.
 *
 * Sezioni, nell'ordine:
 *   fondamenta    costanti, deposito, contesto di pagina, utility
 *   interfaccia   temi, foglio di stile, barra, impostazioni
 *   flussi        download F24/F23/CU, report Excel, selettore date
 *   avvio         deposito prima di tutto, poi la barra
 */
(function() {
'use strict';

/* ─── ANTI-DOPPIO AVVIO ─────────────────────────────────────── */
var _win = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
if (_win._CassettoUtility) {
    var ex = document.getElementById('CU_Panel');
    if (ex) {
        var vis = ex.style.display;
        ex.style.setProperty('display', vis === 'none' ? 'block' : 'none', 'important');
    }
    return;
}
_win._CassettoUtility = true;

/* ─── COSTANTI ───────────────────────────────────────────────── */
// Forma breve, quella che si legge nella barra. `@version` in testa al file
// resta `0.10-alpha` e i manifest `0.10.0`, che e' la forma pretesa dagli store.
var VERSION = '0.10α';
var PANEL_ID = 'CU_Panel';
var INSTRUCTIONS_URL = 'https://denvermotel.github.io/Cassetto_Utility/';
var BASE_URL = window.location.origin;
var SERVLET = BASE_URL + '/cassfisc-web/CassettoFiscaleServlet';
var CANALE = 'cassetto-utility';

function log(msg) { console.log('[Cassetto_Utility] ' + msg); }

/* ═══════════════════════════════════════════════════════════════
   DEPOSITO

   Lo stesso sorgente gira in tre ambienti che salvano in modi diversi:

     Tampermonkey   GM_setValue / GM_getValue, sincrone
     Estensione     chrome.storage.local, asincrona ma raggiungibile
                    direttamente: il content script sta nel mondo isolato
     Ripiego        localStorage del portale

   Le letture restano sincrone per tutti grazie a una cache in memoria
   idratata una volta all'avvio: il resto del codice non deve diventare tutto
   a promesse per un dettaglio di piattaforma.

   Le scritture sono differite di un secondo e accorpate.
   ═══════════════════════════════════════════════════════════════ */

var deposito = (function() {
    var PREFISSO = 'CU_';
    var CHIAVI = ['tema', 'opzioni'];        // le uniche idratate all'avvio
    var RITARDO_SCRITTURA = 1000;

    var cache = {};
    var modo = null;                          // 'gm' | 'estensione' | 'locale'
    var sporche = {};
    var idRinvio = null;

    /*
     * Sotto Tampermonkey l'oggetto `chrome` puo' esistere senza `storage`:
     * si controlla il ramo che serve davvero, non il solo nome dell'oggetto.
     */
    var api = (typeof browser !== 'undefined' && browser.storage) ? browser
            : ((typeof chrome !== 'undefined' && chrome.storage) ? chrome : null);

    /*
     * Le due famiglie di API non si comportano allo stesso modo: `chrome.*`
     * vuole una callback, `browser.*` di Firefox restituisce una promessa e la
     * callback la ignora. Chiedere nel modo sbagliato non da' errore, semplicemente
     * non risponde mai - e siccome l'avvio aspetta questa lettura prima di
     * disegnare, la barra non comparirebbe affatto.
     *
     * Si passa la callback e si guarda anche il valore restituito, cosi' va bene
     * in entrambi i casi. Il tempo massimo e' l'ultima difesa: meglio partire
     * con le preferenze predefinite che non partire.
     */
    function leggiDaEstensione(chiavi) {
        return new Promise(function(risolvi) {
            var fatto = false;
            function unaVolta(dati) { if (!fatto) { fatto = true; risolvi(dati || {}); } }

            var esito;
            try { esito = api.storage.local.get(chiavi, unaVolta); }
            catch (e) { log('Lettura del deposito fallita: ' + e); unaVolta({}); return; }

            if (esito && typeof esito.then === 'function') {
                esito.then(unaVolta, function(e) { log('Lettura del deposito fallita: ' + e); unaVolta({}); });
            }
            setTimeout(function() {
                if (!fatto) log('Il deposito non ha risposto: si parte con le preferenze predefinite.');
                unaVolta({});
            }, 3000);
        });
    }

    function programmaScrittura() {
        if (idRinvio) return;
        idRinvio = setTimeout(function() { idRinvio = null; scarica(); }, RITARDO_SCRITTURA);
    }

    function scarica() {
        Object.keys(sporche).forEach(function(chiave) {
            delete sporche[chiave];
            var valore = cache[chiave];
            try {
                if (modo === 'gm') {
                    GM_setValue(PREFISSO + chiave, valore);
                } else if (modo === 'estensione') {
                    var voce = {}; voce[PREFISSO + chiave] = valore;
                    api.storage.local.set(voce);
                } else {
                    localStorage.setItem(PREFISSO + chiave, JSON.stringify(valore));
                }
            } catch(e) { log('Scrittura fallita su ' + chiave + ': ' + e); }
        });
    }

    var idratato = null;

    return {
        /**
         * Rileva l'ambiente e carica in memoria le chiavi note.
         *
         * Una volta sola davvero: la promessa viene memorizzata e restituita
         * alle chiamate successive. Una seconda idratazione riscriverebbe la
         * cache dallo storage senza guardare le chiavi ancora da persistere,
         * e una preferenza appena toccata dall'utente sparirebbe.
         */
        avvia: function() {
            if (idratato) return idratato;
            idratato = this._idrata();
            return idratato;
        },

        _idrata: function() {
            if (typeof GM_getValue === 'function' && typeof GM_setValue === 'function') {
                modo = 'gm';
                CHIAVI.forEach(function(c) {
                    var v = GM_getValue(PREFISSO + c);
                    cache[c] = (v === undefined || v === null) ? null : v;
                });
                log('Deposito: Tampermonkey');
                return Promise.resolve();
            }
            if (api) {
                modo = 'estensione';
                log('Deposito: estensione');
                return leggiDaEstensione(CHIAVI.map(function(c) { return PREFISSO + c; }))
                    .then(function(dati) {
                        CHIAVI.forEach(function(c) {
                            var v = dati[PREFISSO + c];
                            cache[c] = (v === undefined) ? null : v;
                        });
                    });
            }
            modo = 'locale';
            log('Deposito: localStorage');
            CHIAVI.forEach(function(c) {
                try {
                    var v = localStorage.getItem(PREFISSO + c);
                    cache[c] = v !== null ? JSON.parse(v) : null;
                } catch(e) { cache[c] = null; }
            });
            return Promise.resolve();
        },

        leggi: function(chiave, predefinito) {
            var v = cache[chiave];
            return (v === undefined || v === null) ? predefinito : v;
        },

        scrivi: function(chiave, valore) {
            cache[chiave] = valore;
            sporche[chiave] = true;
            programmaScrittura();
        },

        /**
         * Allinea la copia in memoria senza riscrivere lo storage. Serve a chi
         * riceve un valore da fuori (il menu dell'estensione) che l'ha gia'
         * persistito per conto proprio: riscriverlo qui sarebbe una scrittura
         * inutile e un'occasione in piu' di sovrascrivere qualcos'altro.
         */
        scriviSenzaPersistere: function(chiave, valore) {
            cache[chiave] = valore;
        },

        /** Persiste subito, senza aspettare il differimento. */
        scaricaOra: function() {
            if (idRinvio) { clearTimeout(idRinvio); idRinvio = null; }
            scarica();
        },

        /** 'gm' | 'estensione' | 'locale'. */
        modo: function() { return modo; }
    };
})();


/* ─── PAGE CONTEXT DETECTION (dinamico) ──────────────────────── */
var isF24List, isF24Detail, isF23List, isF23Detail;
var isCUList, isCUDetail, isListPage, isDetailPage, isVersPage, docType;
var isF24Search, isF24SearchRes, isF24SearchDetail;

function detectContext() {
    var h = window.location.href;
    // F24/F23 standard (escludi F24Sel/DetF24Sel/EleF24Sel)
    isF24List   = /[?&]Ric=F24(&|$)/.test(h);
    isF24Detail = /[?&]Ric=DetF24(&|$)/.test(h);
    isF23List   = /[?&]Ric=F23(&|$)/.test(h);
    isF23Detail = /[?&]Ric=DetF23(&|$)/.test(h);
    // CU
    isCUList    = h.indexOf('Ric=CUK') !== -1 && h.indexOf('Protocollo=') === -1;
    isCUDetail  = h.indexOf('Ric=CUK') !== -1 && h.indexOf('Protocollo=') !== -1;
    // F24 Ricerche tributi
    isF24Search       = /[?&]Ric=F24Sel(&|$)/.test(h);
    isF24SearchDetail = /[?&]Ric=DetF24Sel(&|$)/.test(h);
    // Results: DetF24Sel links in DOM (POST result page, potrebbe non avere Ric nell'URL)
    isF24SearchRes = !isF24Search && !isF24SearchDetail && document.querySelectorAll('a[href*="Ric=DetF24Sel"]').length > 0;
    // Se siamo nella pagina di ricerca E ci sono risultati in pagina, è un ibrido
    if (isF24Search && document.querySelectorAll('a[href*="Ric=DetF24Sel"]').length > 0) {
        isF24SearchRes = true;
    }

    isListPage  = isF24List || isF23List || isCUList;
    isDetailPage = isF24Detail || isF23Detail || isCUDetail || isF24SearchDetail;
    isVersPage  = /[?&]Ric=VERS(&|$)/.test(h) && !isListPage && !isDetailPage;
    docType     = isCUList || isCUDetail ? 'CU'
                : (isF24List || isF24Detail || isF24Search || isF24SearchRes || isF24SearchDetail ? 'F24'
                : (isF23List || isF23Detail ? 'F23' : ''));
}
detectContext();

/* ═══════════════════════════════════════════════════════════════
   DI CHI È IL CASSETTO APERTO

   Il codice che si legge qui finisce nei nomi dei file scaricati e in testa a
   ogni foglio di calcolo, quindi sbagliarlo significa archiviare i documenti
   di un cliente sotto il codice di un altro.

   Il caso da non sbagliare è la delega. Il cassetto lo dichiara in un riquadro
   in cima alla pagina:

       sei nel cassetto delegato di: <strong>SLVGRL92A31D423C - SALVO GABRIELE</strong>

   Fino alla 0.09 lì dentro si cercava solo una partita IVA, undici cifre. Con
   un cliente persona fisica non si trovava niente, si scivolava sul riquadro
   dell'utente connesso e si prendeva **il codice dello studio**: le CU di un
   cliente uscivano col codice fiscale del professionista, e i fogli pure. È il
   difetto peggiore possibile, perché il risultato sembra plausibile.

   Da qui due regole. Nel riquadro della delega si cerca prima il codice
   fiscale e poi la partita IVA - non si possono confondere, hanno forme
   diverse. E se il riquadro c'è ma non si riesce a leggerlo, **non si ripiega
   sull'utente connesso**: si restituisce un codice palesemente sbagliato, che
   si nota, invece di uno plausibile e falso.
   ═══════════════════════════════════════════════════════════════ */

var RE_CF   = /\b([A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z])\b/i;
var RE_PIVA = /\b(\d{11})\b/;

var SEL_DELEGA = 'div.section.border.border-primary.my-1.bg-light.px-3';

function getIdentifier() {
    var delegaEl = document.querySelector(SEL_DELEGA);
    if (delegaEl) {
        // Il codice sta nello <strong>, nella forma "CODICE - NOME". Il testo
        // dell'intero riquadro è il ripiego, se un giorno lo togliessero.
        var forte = delegaEl.querySelector('strong');
        var testo = (forte ? forte.textContent : delegaEl.textContent) || '';

        var cf = testo.match(RE_CF);
        if (cf) return { code: cf[1].toUpperCase(), tipo: 'delegato' };
        var piva = testo.match(RE_PIVA);
        if (piva) return { code: piva[1], tipo: 'delegato' };

        log('Cassetto delegato, ma il codice del delegante non si legge: ' + testo.trim());
        return { code: 'DELEGANTE', tipo: 'delegato' };
    }

    // Cassetto proprio: qui l'utente connesso è davvero l'intestatario
    var ps = document.querySelectorAll('#user-info-data-container p.mb-2, #user-info p.mb-2');
    for (var i = 0; i < ps.length; i++) {
        var t = ps[i].textContent.trim();
        var mP = t.match(RE_PIVA); if (mP) return {code:mP[1], tipo:'piva'};
        var mC = t.match(RE_CF);   if (mC) return {code:mC[1].toUpperCase(), tipo:'cf'};
    }
    var ui = document.getElementById('user-info');
    if (ui) {
        var mf = ui.textContent.match(RE_PIVA); if (mf) return {code:mf[1], tipo:'piva'};
        var mg = ui.textContent.match(RE_CF);   if (mg) return {code:mg[1].toUpperCase(), tipo:'cf'};
    }
    return {code:'CODICE', tipo:'sconosciuto'};
}

function isDelegato() {
    return !!document.querySelector(SEL_DELEGA);
}

/* ─── UTILITY ────────────────────────────────────────────────── */
function parseDate(s) {
    var p = String(s||'').trim().split('/');
    if (p.length === 3) return {g:p[0].padStart(2,'0'), m:p[1].padStart(2,'0'), a:p[2]};
    return {g:'GG', m:'MM', a:'AAAA'};
}
function getParam(n, href) { href = href || location.href; var m = new RegExp('[?&]'+n+'=([^&]*)').exec(href); return m ? decodeURIComponent(m[1]) : ''; }
function safe(s) { return String(s).replace(/[\/\\:*?"<>|]/g,'_').replace(/\s+/g,'_'); }
function sleep(ms) { return new Promise(function(r){setTimeout(r,ms);}); }
/*
 * Escape per XML. Il controllo su undefined e null va fatto per esteso: con
 * `s || ''` lo zero diventa stringa vuota, e uno zero finisce spesso in una
 * cella dichiarata ss:Type="Number" - i contatori dei fogli Riepilogo valgono
 * zero proprio nel caso piu' comune, il report generato senza aver scaricato
 * nulla. Un <Data ss:Type="Number"> vuoto non e' SpreadsheetML valido.
 *
 * Apici e virgolette non servirebbero, perche' oggi nessun dato variabile
 * finisce dentro un attributo XML, ma cosi' l'helper e' sicuro per
 * costruzione invece che per ispezione di tutti i chiamanti.
 */
function esc(s) {
    return String(s === undefined || s === null ? '' : s)
        .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
        .replace(/"/g,'&quot;').replace(/'/g,'&apos;');
}
function pad2(n) { return String(n).padStart(2,'0'); }

/* ═══════════════════════════════════════════════════════════════
   IMPORTI NEI FOGLI DI CALCOLO

   Il cassetto scrive gli importi in forma italiana - `1.234,56 €`, con il
   punto a separare le migliaia, la virgola i decimali, e spesso uno spazio
   unificatore U+00A0 al posto di quello normale. Excel, in una cella
   dichiarata ss:Type="Number", vuole l'esatto contrario: punto decimale,
   niente separatore di migliaia, niente valuta.

   Fino alla 0.09 gli importi uscivano tutti come testo, e per sommare una
   colonna bisognava convertirla a mano. Ora si prova a convertire, ma il
   ripiego resta la cella di testo di prima: un importo che non si riconosce
   viene scritto **così com'è**, senza inventare uno zero. Meglio una colonna
   che non si somma di un totale sbagliato in un foglio che serve a fare
   riscontri fiscali.
   ═══════════════════════════════════════════════════════════════ */

/**
 * Converte un importo italiano in numero, oppure restituisce null se quello
 * che è arrivato non è un importo. Il null è un esito, non un errore: dice al
 * chiamante di lasciare il valore come testo.
 */
function numeroDaImporto(s) {
    if (s === undefined || s === null) return null;
    if (typeof s === 'number') return isFinite(s) ? s : null;

    var t = String(s)
        .replace(/ /g, '')    // spazio unificatore, quello che il cassetto usa davvero
        .replace(/&nbsp;/g, '')
        .replace(/€/g, '')
        .replace(/\s/g, '')
        .trim();
    if (!t) return null;

    // Il segno può stare in coda: certe stampe scrivono `1.234,56-`
    var negativo = false;
    if (/-$/.test(t)) { negativo = true; t = t.slice(0, -1); }
    if (/^-/.test(t)) { negativo = true; t = t.slice(1); }

    /*
     * Si accettano solo le due forme italiane ben formate: con i punti di
     * migliaia in gruppi di tre, o senza alcun punto. Tutto il resto - date,
     * codici tributo, note, un importo scritto in un modo che non conosciamo -
     * non è un numero e resta testo.
     */
    if (!/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(t) && !/^\d+(,\d+)?$/.test(t)) return null;

    var n = Number(t.replace(/\./g, '').replace(',', '.'));
    if (!isFinite(n)) return null;
    return negativo ? -n : n;
}

/** Una cella qualsiasi. `t` è il tipo SpreadsheetML, String se non detto. */
function cella(v, t, sty) {
    return '<Cell' + (sty ? ' ss:StyleID="' + sty + '"' : '') +
           '><Data ss:Type="' + (t || 'String') + '">' + esc(v) + '</Data></Cell>';
}

/*
 * Gli stili con il formato numerico. Servono in coppia con quelli di riga,
 * perché una cella ha un solo StyleID e il colore della riga non si può
 * perdere: `ok` diventa `okn`, e così via. L'ordine degli elementi dentro
 * <Style> non è libero - Interior prima di NumberFormat - o Excel rifiuta il
 * file all'apertura.
 */
var FORMATO_IMPORTO = '<NumberFormat ss:Format="#,##0.00"/>';

var STILI_IMPORTO =
    '<Style ss:ID="num">' + FORMATO_IMPORTO + '</Style>' +
    '<Style ss:ID="okn"><Interior ss:Color="#E8F5E9" ss:Pattern="Solid"/>' + FORMATO_IMPORTO + '</Style>' +
    '<Style ss:ID="ern"><Interior ss:Color="#FFEBEE" ss:Pattern="Solid"/>' + FORMATO_IMPORTO + '</Style>' +
    '<Style ss:ID="wnn"><Interior ss:Color="#FFF9C4" ss:Pattern="Solid"/>' + FORMATO_IMPORTO + '</Style>';

var STILE_IMPORTO_PER_RIGA = { ok: 'okn', er: 'ern', wn: 'wnn' };

/**
 * Una cella d'importo: numero vero se si riesce a leggerlo, altrimenti il
 * testo originale. Il colore della riga si conserva in entrambi i casi.
 */
function cellaImporto(v, sty) {
    var n = numeroDaImporto(v);
    if (n === null) return cella(v, 'String', sty);
    var stile = sty ? (STILE_IMPORTO_PER_RIGA[sty] || sty) : 'num';
    return '<Cell ss:StyleID="' + stile + '"><Data ss:Type="Number">' + n + '</Data></Cell>';
}

function buildFilename(tipo, anno, dateStr, idx) {
    var cod = getIdentifier().code;
    var d = parseDate(dateStr);
    var yr = (d.a !== 'AAAA') ? d.a : anno;
    return safe(cod)+'_'+safe(yr)+'_'+safe(d.m)+'_'+safe(d.g)+'_'+safe(tipo)+'_idx'+safe(idx)+'.pdf';
}

/* ─── MAPPA CAUSALI CU (normativa) ──────────────────────────── */
var CAUSALI_MAP = {
'A':'Lavoro autonomo - arte o professione abituale',
'B':'Utilizzazione economica opere ingegno/brevetti (autore)',
'C':'Utili da contratti di associazione in partecipazione',
'D':'Utili soci promotori/fondatori societ\u00e0 di capitali',
'E':'Levata di protesti cambiari',
'F':'Indennit\u00e0 giudici onorari di pace e vice procuratori',
'G':'Indennit\u00e0 cessazione attivit\u00e0 sportiva professionale',
'H':'Indennit\u00e0 cessazione rapporti di agenzia',
'I':'Indennit\u00e0 cessazione funzioni notarili',
'J':'Compensi raccoglitori occasionali di tartufi',
'K':'Assegni di servizio civile universale',
'L':'Utilizzazione economica opere ingegno/brevetti (gratuito)',
'L1':'Utilizzazione economica opere ingegno/brevetti (oneroso)',
'M':'Lavoro autonomo non esercitato abitualmente',
'M1':'Obblighi di fare, non fare o permettere',
'M2':'Lavoro autonomo non abituale con obbligo ENPAPI',
'N':'Indennit\u00e0 trasferta, premi cori/bande/filodrammatiche',
'O':'Lavoro autonomo non abituale con obbligo ENPALS',
'O1':'Obblighi fare/non fare con obbligo ENPALS',
'P':'Compensi soggetti non residenti per uso attrezzature',
'Q':'Provvigioni agente/rappresentante monomandatario',
'R':'Provvigioni agente/rappresentante plurimandatario',
'S':'Provvigioni commissionario',
'T':'Provvigioni mediatore',
'U':'Provvigioni procacciatore di affari',
'V':'Provvigioni incaricato vendite a domicilio',
'V1':'Redditi attivit\u00e0 commerciali non abituali (provvigioni occasionali)',
'V2':'Prestazioni non abituali incaricati vendita diretta',
'W':'Corrispettivi contratti d\'appalto art.25-ter DPR 600/73',
'ZO':'Titolo diverso dai precedenti'
};

/* ═══════════════════════════════════════════════════════════════
   INTERFACCIA E TEMI

   La barra si appende a documentElement con all:initial e !important su ogni
   proprieta': e' l'unica difesa che regge contro il CSS del portale, che e'
   Bootstrap. I temi cambiano i valori, non la strategia.

   Ogni tema dichiara tre gruppi di colori, perche' servono a tre cose diverse
   e non si ricavano l'uno dall'altro:

     barra    superfici e testi della barra scura, contrasto minimo 4.5
     esito    le tre parole con cui finisce un lavoro: riuscito, avviso,
              errore. Sono tinte piu' chiare, perche' compaiono su ardesia
     chiaro   il selettore date, che si innesta nel form bianco del portale:
              l'accento va scurito, altrimenti come testo non si legge

   Le quattro palette sono le stesse di FE-Utility, cosi' chi usa entrambi gli
   strumenti li riconosce come una cosa sola. Cambia il valore di partenza:
   qui e' l'ottone, di la' la menta, ed e' l'unico modo per distinguere a
   colpo d'occhio quale delle due barre si sta guardando.

   Nessun font esterno: la CSP del portale li escluderebbe comunque. Le cifre
   stanno in monospazio perche' non ballino mentre il contatore sale.
   ═══════════════════════════════════════════════════════════════ */

var TEMI = [
    {
        id: 'ardesia',
        nome: 'Ardesia e ottone',
        nota: 'Fondo freddo, accento caldo. La distanza maggiore dal blu del portale.',
        barra: {
            inchiostro: '#22262F', ardesia: '#2E3540', ardesiaChiara: '#59616F',
            carta: '#DDE1E7', cartaTenue: '#9AA2AF',
            ottone: '#C9962F'
        },
        esito: { riuscito: '#59916B', avviso: '#D9A441', errore: '#D26358' },
        chiaro: { accento: '#B98A2B', accentoTesto: '#956F23' }
    },
    {
        id: 'nordico',
        nome: 'Notte nordica e ottanio',
        nota: 'Tinte desaturate e accento freddo, per le sessioni lunghe.',
        barra: {
            inchiostro: '#1A202C', ardesia: '#2D3748', ardesiaChiara: '#57637A',
            carta: '#EDF2F7', cartaTenue: '#9BA7B8',
            ottone: '#319795'
        },
        esito: { riuscito: '#4FC3BD', avviso: '#E0B252', errore: '#EE7070' },
        chiaro: { accento: '#319795', accentoTesto: '#2A8280' }
    },
    {
        id: 'navy',
        nome: 'Blu notte e ambra',
        nota: 'Vicino ai gestionali contabili: fondo profondo, ambra sugli elementi attivi.',
        barra: {
            inchiostro: '#0F172A', ardesia: '#1E293B', ardesiaChiara: '#4A5A72',
            carta: '#F8FAFC', cartaTenue: '#94A3B8',
            ottone: '#F59E0B'
        },
        esito: { riuscito: '#22C08D', avviso: '#F0B429', errore: '#EF6B6B' },
        chiaro: { accento: '#CE8509', accentoTesto: '#A26807' }
    },
    {
        id: 'grafite',
        nome: 'Grafite e menta',
        nota: 'Quasi neutro, accento verde ad alto contrasto. Il piu’ sobrio, ed e’ quello di FE-Utility.',
        barra: {
            inchiostro: '#18181B', ardesia: '#27272A', ardesiaChiara: '#52525B',
            carta: '#FAFAFA', cartaTenue: '#A1A1AA',
            ottone: '#10B981'
        },
        esito: { riuscito: '#34D07A', avviso: '#E3B341', errore: '#F26981' },
        chiaro: { accento: '#0EA674', accentoTesto: '#0C855D' }
    }
];

var TEMA_PREDEFINITO = 'ardesia';

/* ═══════════════════════════════════════════════════════════════
   OPZIONI

   Preferenze che cambiano il comportamento, non l'aspetto. Restano fra le
   sessioni e si modificano dal pannello impostazioni.
   ═══════════════════════════════════════════════════════════════ */

var OPZIONI_PREDEFINITE = {
    quietanzaSeDisponibile: true,   // per gli F24 quietanzati scarica la quietanza, non la copia
    chiediConferma:         true,   // conferma prima dei lotti oltre la soglia
    apertura:               'menu'  // 'menu' | 'barra', vale solo come estensione
};

// Oltre questi documenti un lotto si chiede, non si avvia: da qui in su
// l'attesa si misura in minuti e l'operazione non si puo' interrompere.
var SOGLIA_CONFERMA = 15;

var opzioni = {};

function caricaOpzioni() {
    var salvate = deposito.leggi('opzioni', null) || {};
    Object.keys(OPZIONI_PREDEFINITE).forEach(function(k) {
        opzioni[k] = (salvate[k] === undefined) ? OPZIONI_PREDEFINITE[k] : salvate[k];
    });
}

function salvaOpzioni() { deposito.scrivi('opzioni', opzioni); }

/* ─── APPLICAZIONE DEL TEMA ─────────────────────────────────── */

function trovaTema(id) {
    for (var i = 0; i < TEMI.length; i++) if (TEMI[i].id === id) return TEMI[i];
    return TEMI[0];
}

/* I tre gruppi in uso. Vengono riempiti da applicaTema(). */
var COL = {};
var COL_ESITO = {};
var COL_CHIARO = {
    fondo: '#FFFFFF',
    bordo: '#D8DCE2',
    bordoCampo: '#C3C8D0',
    testo: '#22262F',
    testoTenue: '#6B7280',
    accento: '#B98A2B',
    accentoTesto: '#956F23'
};

var _temaAttivo = null;

/**
 * Carica i colori di un tema e riscrive il foglio di stile.
 * `salva` a falso serve a chi applica un tema deciso altrove (il menu
 * dell'estensione), che l'ha gia' scritto per conto suo.
 */
function applicaTema(id, salva) {
    var t = trovaTema(id);
    _temaAttivo = t.id;

    Object.keys(t.barra).forEach(function(k) { COL[k] = t.barra[k]; });
    Object.keys(t.esito).forEach(function(k) { COL_ESITO[k] = t.esito[k]; });
    COL_CHIARO.accento = t.chiaro.accento;
    COL_CHIARO.accentoTesto = t.chiaro.accentoTesto;
    COL_CHIARO.testo = t.barra.inchiostro;

    var foglio = document.getElementById('CU_Stile');
    if (foglio) foglio.textContent = foglioStile();

    /*
     * Il selettore del periodo ha gli stili in riga, quindi non basta
     * riscrivere il foglio: va ridisegnato. Si usa la versione silenziosa,
     * perche' un cambio di colori non deve poter cancellare l'avanzamento di
     * uno scarico in corso dalla riga di stato.
     */
    if (document.getElementById('CU_DateSel')) disegnaDateSelector();

    if (salva !== false) deposito.scrivi('tema', t.id);
}

/*
 * Il nome composto va fra virgolette SINGOLE, non doppie: questi due valori
 * finiscono anche dentro attributi style="..." costruiti come stringhe, e con
 * "Segoe UI" fra virgolette doppie l'attributo si chiuderebbe a meta' lasciando
 * applicato il solo `all:initial`, che riporta al serif di sistema.
 */
var FONT_UI    = "system-ui,-apple-system,'Segoe UI',Roboto,sans-serif";
var FONT_CIFRE = 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace';

function foglioStile() {
    return [
        '#CU_Panel{all:initial!important;display:block!important;',
        'position:fixed!important;top:0!important;left:0!important;',
        'width:100vw!important;box-sizing:border-box!important;',
        'z-index:2147483647!important;background:' + COL.inchiostro + '!important;',
        'border-bottom:1px solid ' + COL.ottone + '!important;',
        'box-shadow:0 2px 10px rgba(0,0,0,.45)!important;',
        'font-family:' + FONT_UI + '!important;color:' + COL.carta + '!important;}',

        '#CU_TopRow{all:initial!important;display:flex!important;',
        'flex-direction:row!important;flex-wrap:nowrap!important;align-items:center!important;',
        'gap:6px!important;padding:5px 18px 5px 12px!important;',
        'width:100%!important;box-sizing:border-box!important;overflow-x:auto!important;}',

        '#CU_Logo{all:initial!important;font-family:' + FONT_UI + '!important;',
        'font-size:11px!important;font-weight:600!important;letter-spacing:.10em!important;',
        'color:' + COL.ottone + '!important;white-space:nowrap!important;',
        'flex-shrink:0!important;margin-right:10px!important;}',

        /* Chi sta guardando: identificativo e, se c'e', il fatto di essere in delega */
        '#CU_Badge{all:initial!important;display:inline-block!important;',
        'font-family:' + FONT_CIFRE + '!important;font-size:10px!important;',
        'color:' + COL.cartaTenue + '!important;padding:2px 7px!important;',
        'border:1px solid ' + COL.ardesia + '!important;border-radius:2px!important;',
        'white-space:nowrap!important;flex-shrink:0!important;}',
        '#CU_Badge.delega{color:' + COL.ottone + '!important;',
        'border-color:' + COL.ottone + '!important;}',
        '#CU_DocTag{all:initial!important;display:none!important;}',
        '#CU_DocTag.cu-dtag{all:initial!important;display:inline-block!important;',
        'font-family:' + FONT_UI + '!important;font-size:9px!important;font-weight:700!important;',
        'letter-spacing:.09em!important;text-transform:uppercase!important;',
        'background:' + COL.ardesia + '!important;color:' + COL.carta + '!important;',
        'padding:3px 7px!important;border-radius:2px!important;',
        'white-space:nowrap!important;flex-shrink:0!important;}',

        '#CU_Buttons{all:initial!important;display:flex!important;',
        'align-items:center!important;gap:6px!important;flex-shrink:0!important;}',

        '#CU_BottomRow{all:initial!important;display:none!important;',
        'width:100%!important;box-sizing:border-box!important;padding:0 18px 7px 12px!important;}',
        '#CU_PBar{all:initial!important;display:block!important;height:3px!important;',
        'width:100%!important;background:' + COL.ardesia + '!important;',
        'overflow:hidden!important;margin-bottom:5px!important;}',
        '#CU_PFill{all:initial!important;display:block!important;height:100%!important;',
        'width:0%!important;background:' + COL.ottone + '!important;transition:width .3s!important;}',
        '#CU_RigaStato{all:initial!important;display:flex!important;',
        'align-items:center!important;gap:10px!important;width:100%!important;}',
        '#CU_Status{all:initial!important;display:block!important;flex:1 1 auto!important;',
        'font-family:' + FONT_CIFRE + '!important;font-size:10.5px!important;',
        'color:' + COL.cartaTenue + '!important;font-variant-numeric:tabular-nums!important;',
        'white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important;}',
        /* La × del resoconto: compare a fine lavoro, non durante */
        '#CU_ChiudiReport{all:initial!important;display:none!important;',
        'flex-shrink:0!important;cursor:pointer!important;',
        'font-family:' + FONT_UI + '!important;font-size:12px!important;line-height:1!important;',
        'color:' + COL.cartaTenue + '!important;background:transparent!important;',
        'border:1px solid ' + COL.ardesia + '!important;border-radius:2px!important;',
        'padding:2px 7px!important;}',
        '#CU_ChiudiReport:hover{color:' + COL.carta + '!important;',
        'border-color:' + COL.ottone + '!important;}',
        '#CU_ChiudiReport:focus-visible{outline:2px solid ' + COL.ottone + '!important;',
        'outline-offset:2px!important;}',
        '#CU_Status.riuscito{color:' + COL_ESITO.riuscito + '!important;}',
        '#CU_Status.avviso{color:' + COL_ESITO.avviso + '!important;}',
        '#CU_Status.errore{color:' + COL_ESITO.errore + '!important;}',

        '.cuBtn{all:initial!important;display:inline-block!important;',
        'padding:5px 11px!important;border:1px solid transparent!important;border-radius:2px!important;',
        'cursor:pointer!important;font-family:' + FONT_UI + '!important;',
        'font-size:10px!important;font-weight:600!important;letter-spacing:.07em!important;',
        'text-transform:uppercase!important;white-space:nowrap!important;flex-shrink:0!important;',
        'line-height:1.5!important;transition:background .15s,border-color .15s!important;}',
        '.cuBtn:hover:not(:disabled){border-color:' + COL.ottone + '!important;}',
        '.cuBtn:focus-visible{outline:2px solid ' + COL.ottone + '!important;outline-offset:2px!important;}',
        '.cuBtn:disabled{opacity:.35!important;cursor:default!important;}',
        '.cu-primario{background:' + COL.ottone + '!important;color:' + COL.inchiostro + '!important;}',
        '.cu-azione{background:' + COL.ardesia + '!important;color:' + COL.carta + '!important;}',
        '.cu-quieto{background:transparent!important;color:' + COL.cartaTenue + '!important;',
        'border-color:' + COL.ardesiaChiara + '!important;}',
        /* Variante piena per i dialoghi: sul fondo ardesia .cu-azione sparirebbe */
        '.cu-alternativa{background:' + COL.ardesiaChiara + '!important;color:' + COL.carta + '!important;}',

        '#CU_InfoLink,#CU_X,#CU_Impostazioni{all:initial!important;',
        'display:inline-flex!important;align-items:center!important;justify-content:center!important;',
        'width:24px!important;height:24px!important;flex-shrink:0!important;',
        'font-family:' + FONT_UI + '!important;font-size:12px!important;',
        'color:' + COL.cartaTenue + '!important;text-decoration:none!important;',
        'cursor:pointer!important;border:1px solid ' + COL.ardesia + '!important;',
        'border-radius:2px!important;background:transparent!important;',
        'transition:color .15s,border-color .15s!important;}',
        '#CU_InfoLink:hover,#CU_X:hover,#CU_Impostazioni:hover{color:' + COL.carta + '!important;',
        'border-color:' + COL.ottone + '!important;}',
        '#CU_InfoLink:focus-visible,#CU_X:focus-visible,#CU_Impostazioni:focus-visible{',
        'outline:2px solid ' + COL.ottone + '!important;outline-offset:2px!important;}',
        '#CU_Impostazioni.attivo{color:' + COL.ottone + '!important;',
        'border-color:' + COL.ottone + '!important;}',

        /* Filtro per codice atto: vive nella barra, quindi ne ha i colori */
        '#CU_AttoFilter{all:initial!important;display:inline-flex!important;',
        'align-items:center!important;gap:6px!important;flex-shrink:0!important;',
        'font-family:' + FONT_UI + '!important;font-size:10px!important;font-weight:600!important;',
        'letter-spacing:.07em!important;text-transform:uppercase!important;',
        'color:' + COL.cartaTenue + '!important;white-space:nowrap!important;}',
        '#CU_AttoInput{all:initial!important;display:inline-block!important;width:104px!important;',
        'background:' + COL.ardesia + '!important;color:' + COL.carta + '!important;',
        'border:1px solid ' + COL.ardesiaChiara + '!important;border-radius:2px!important;',
        'padding:3px 6px!important;font-family:' + FONT_CIFRE + '!important;font-size:11px!important;}',
        '#CU_AttoInput:focus-visible{outline:2px solid ' + COL.ottone + '!important;outline-offset:1px!important;}',

        /* Pannello delle impostazioni: si apre sotto la barra */
        '#CU_Pannello{all:initial!important;display:block!important;',
        'width:100%!important;box-sizing:border-box!important;',
        'padding:10px 18px 12px 12px!important;background:' + COL.ardesia + '!important;',
        'border-top:1px solid ' + COL.ardesiaChiara + '!important;}',
        '#CU_Pannello h3{all:initial!important;display:block!important;',
        'font-family:' + FONT_UI + '!important;font-size:10px!important;font-weight:700!important;',
        'letter-spacing:.09em!important;text-transform:uppercase!important;',
        'color:' + COL.ottone + '!important;margin-bottom:8px!important;}',
        '#CU_Opzioni{all:initial!important;display:flex!important;flex-direction:row!important;',
        'flex-wrap:wrap!important;gap:8px!important;margin-bottom:12px!important;}',
        '#CU_Opzioni .cuOpzione{flex:1 1 300px!important;}',
        '#CU_Apertura,#CU_Temi{all:initial!important;display:flex!important;',
        'flex-wrap:wrap!important;gap:8px!important;margin-bottom:12px!important;}',

        /* Lo stato di una spunta si legge in tre modi insieme: il segno dentro
           la casella, il colore della cornice, e la parola si' o no accanto al
           titolo. Uno solo dei tre basta a capirlo. */
        '.cuOpzione{all:initial!important;display:flex!important;align-items:flex-start!important;',
        'gap:10px!important;cursor:pointer!important;text-align:left!important;',
        'padding:8px 11px!important;border-radius:2px!important;',
        'border:1px solid ' + COL.ardesiaChiara + '!important;background:transparent!important;',
        'font-family:' + FONT_UI + '!important;max-width:520px!important;',
        'transition:border-color .15s,background .15s!important;}',
        '.cuOpzione:hover{border-color:' + COL.ottone + '!important;}',
        '.cuOpzione:focus-visible{outline:2px solid ' + COL.ottone + '!important;outline-offset:2px!important;}',
        '.cuOpzione[aria-checked="true"]{border-color:' + COL.ottone + '!important;',
        'background:' + COL.inchiostro + '!important;}',
        '.cuCasella{all:initial!important;display:flex!important;',
        'align-items:center!important;justify-content:center!important;flex-shrink:0!important;',
        'width:17px!important;height:17px!important;border-radius:3px!important;',
        'background:transparent!important;border:2px solid ' + COL.ardesiaChiara + '!important;',
        'margin-top:1px!important;font-family:' + FONT_UI + '!important;',
        'font-size:12px!important;font-weight:700!important;line-height:1!important;',
        'color:transparent!important;transition:background .15s,border-color .15s!important;}',
        '.cuOpzione[aria-checked="true"] .cuCasella{background:' + COL.ottone + '!important;',
        'border-color:' + COL.ottone + '!important;color:' + COL.inchiostro + '!important;}',
        '.cuNome{all:initial!important;display:block!important;',
        'font-family:' + FONT_UI + '!important;font-size:11px!important;',
        'font-weight:600!important;color:' + COL.carta + '!important;}',
        '.cuNota{all:initial!important;display:block!important;',
        'font-family:' + FONT_UI + '!important;font-size:10px!important;',
        'color:' + COL.cartaTenue + '!important;margin-top:2px!important;line-height:1.4!important;',
        'max-width:260px!important;}',
        '.cuStato{all:initial!important;display:inline-block!important;',
        'font-family:' + FONT_UI + '!important;font-size:9px!important;font-weight:700!important;',
        'letter-spacing:.08em!important;text-transform:uppercase!important;',
        'color:' + COL.cartaTenue + '!important;margin-left:6px!important;}',
        '.cuOpzione[aria-checked="true"] .cuStato{color:' + COL.ottone + '!important;}',

        '.cuTema{all:initial!important;display:flex!important;align-items:center!important;',
        'gap:8px!important;cursor:pointer!important;padding:7px 10px!important;',
        'border-radius:2px!important;border:1px solid ' + COL.ardesiaChiara + '!important;',
        'background:transparent!important;font-family:' + FONT_UI + '!important;',
        'font-size:11px!important;color:' + COL.carta + '!important;text-align:left!important;}',
        '.cuTema:hover{border-color:' + COL.ottone + '!important;}',
        '.cuTema:focus-visible{outline:2px solid ' + COL.ottone + '!important;outline-offset:2px!important;}',
        '.cuTema[aria-checked="true"]{border-color:' + COL.ottone + '!important;',
        'background:' + COL.inchiostro + '!important;}',
        /* Il campione mostra i colori veri del tema, non una pastiglia decorativa */
        '.cuCampione{all:initial!important;display:flex!important;',
        'width:44px!important;height:18px!important;flex-shrink:0!important;',
        'border-radius:2px!important;overflow:hidden!important;}',
        '.cuCampione span{all:initial!important;display:block!important;flex:1 1 0!important;',
        'height:100%!important;}',

        '#CU_Linguetta{all:initial!important;position:fixed!important;top:0!important;',
        'right:18px!important;background:' + COL.inchiostro + '!important;',
        'color:' + COL.ottone + '!important;padding:4px 12px!important;',
        'border:1px solid ' + COL.ottone + '!important;border-top:none!important;',
        'font-family:' + FONT_UI + '!important;font-size:10px!important;',
        'font-weight:600!important;letter-spacing:.10em!important;',
        'cursor:pointer!important;z-index:2147483647!important;}',

        /* Il dialogo di conferma: fondo scuro come la barra, perche' e' la
           stessa cosa che parla, ma al centro dello schermo perche' qui si
           decide e la decisione non si prende di sfuggita. */
        '#CU_AlertOverlay{all:initial!important;position:fixed!important;',
        'top:0!important;left:0!important;right:0!important;bottom:0!important;',
        'background:rgba(0,0,0,.55)!important;z-index:2147483647!important;',
        'display:flex!important;align-items:center!important;justify-content:center!important;}',
        '#CU_AlertBox{all:initial!important;display:block!important;',
        'background:' + COL.inchiostro + '!important;',
        'border:1px solid ' + COL.ottone + '!important;border-radius:2px!important;',
        'padding:20px 22px!important;max-width:460px!important;',
        'box-shadow:0 8px 32px rgba(0,0,0,.5)!important;',
        'font-family:' + FONT_UI + '!important;color:' + COL.carta + '!important;}',
        '#CU_AlertBox h3{all:initial!important;display:block!important;',
        'font-family:' + FONT_UI + '!important;font-size:10px!important;font-weight:700!important;',
        'letter-spacing:.09em!important;text-transform:uppercase!important;',
        'color:' + COL.ottone + '!important;margin-bottom:10px!important;}',
        '#CU_AlertBox p{all:initial!important;display:block!important;',
        'font-family:' + FONT_UI + '!important;font-size:12px!important;line-height:1.5!important;',
        'color:' + COL.carta + '!important;margin-bottom:8px!important;}',
        '#CU_AlertAzioni{all:initial!important;display:flex!important;',
        'gap:8px!important;margin-top:16px!important;}',
        '#CU_AlertAzioni .cuBtn{font-size:11px!important;font-weight:700!important;',
        'padding:6px 13px!important;}',

        /* Il selettore date va controcorrente: sta nel pannello bianco del
           portale, e un blocco scuro la' in mezzo si leggerebbe come un errore
           di impaginazione. Qui solo focus e stati; il resto e' in riga. */
        '#CU_DateSel:focus{border-left-width:5px!important;',
        'box-shadow:0 0 0 2px ' + COL_CHIARO.accento + '!important;}',
        '#CU_DateSel .cuBtn:focus-visible{outline:2px solid ' + COL_CHIARO.accentoTesto + '!important;}',
        '#CU_DateSel .cuBtn:hover:not(:disabled){border-color:' + COL_CHIARO.accentoTesto + '!important;}',

        '@media (prefers-reduced-motion:reduce){',
        '#CU_PFill,.cuBtn,.cuOpzione,.cuCasella{transition:none!important;}}'
    ].join('');
}

/* ─── LA BARRA ──────────────────────────────────────────────── */

var pannello = null;
var _barraVisibile = false;
var _osservaAltezza = null;
var summaryVisible = false;

function comeEstensione() { return deposito.modo() === 'estensione'; }

function creaPanel() {
    if (document.getElementById(PANEL_ID)) return;

    // Il foglio ha un id perche' il cambio di tema lo riscriva
    var stile = document.createElement('style');
    stile.id = 'CU_Stile';
    stile.textContent = foglioStile();
    document.head.appendChild(stile);

    var p = document.createElement('div');
    p.id = PANEL_ID;
    /*
     * innerHTML riceve solo markup letterale con gli id degli elementi che
     * cambieranno: i valori si assegnano subito dopo come proprieta' DOM.
     * VERSION e INSTRUCTIONS_URL sono costanti interne e non dati esterni, ma
     * un revisore non deve doverlo verificare leggendo il codice.
     */
    p.innerHTML =
        '<div id="CU_TopRow">' +
            '<span id="CU_Logo"></span>' +
            '<span id="CU_Badge"></span>' +
            '<span id="CU_DocTag"></span>' +
            '<span id="CU_Buttons"></span>' +
            '<span style="all:initial!important;flex:1 1 auto!important;min-width:10px!important;"></span>' +
            '<button id="CU_Impostazioni" title="Impostazioni"' +
                ' aria-label="Impostazioni" aria-expanded="false">&#9881;</button>' +
            '<a id="CU_InfoLink" target="_blank" rel="noopener noreferrer" title="Istruzioni">?</a>' +
            '<button id="CU_X" title="Chiudi la barra" aria-label="Chiudi la barra">&times;</button>' +
        '</div>' +
        '<div id="CU_BottomRow">' +
            '<div id="CU_PBar"><span id="CU_PFill"></span></div>' +
            '<div id="CU_RigaStato">' +
                '<span id="CU_Status" role="status" aria-live="polite"></span>' +
                '<button id="CU_ChiudiReport" title="Chiudi il resoconto"' +
                    ' aria-label="Chiudi il resoconto">&times;</button>' +
            '</div>' +
        '</div>';

    p.querySelector('#CU_Logo').textContent = 'CASSETTO·UTILITY ' + VERSION;
    p.querySelector('#CU_InfoLink').href = INSTRUCTIONS_URL;

    // Appesa a <html> e non a <body>: Bootstrap non ci arriva.
    // Nasce nascosta: e' mostraBarra() a deciderne la comparsa, perche' come
    // estensione la barra si apre solo dall'icona del browser.
    p.style.setProperty('display', 'none', 'important');
    document.documentElement.appendChild(p);
    pannello = p;

    p.querySelector('#CU_X').onclick = chiudiBarra;
    p.querySelector('#CU_Impostazioni').onclick = apriImpostazioni;
    p.querySelector('#CU_ChiudiReport').onclick = chiudiReport;

    // Se si sta leggendo il resoconto, la chiusura automatica aspetta
    p.querySelector('#CU_BottomRow').addEventListener('mouseenter', annullaChiusuraProgrammata);

    /*
     * L'altezza cambia quando compare l'avanzamento o si apre un pannello.
     * Fino alla 0.08 la si ricontrollava ogni 600ms, il che vuol dire un
     * lavoro inutile per tutta la sessione. Ora la chiamata sta nei quattro
     * punti che l'altezza la cambiano davvero, e l'osservatore resta come rete
     * di sicurezza per quello che dovesse sfuggire: non e' l'unica via, cosi'
     * dove ResizeObserver non c'e' o non scatta la pagina non resta coperta.
     */
    if (typeof ResizeObserver === 'function') {
        _osservaAltezza = new ResizeObserver(function() { aggiornaPadding(); });
    }
}

/** La barra copre l'inizio della pagina: il body va scostato di altrettanto. */
function aggiornaPadding() {
    if (!_barraVisibile || !pannello) return;
    document.body.style.setProperty('padding-top', (pannello.offsetHeight || 34) + 'px', 'important');
}

function mostraBarra() {
    if (!pannello || _barraVisibile) return;
    _barraVisibile = true;

    var linguetta = document.getElementById('CU_Linguetta');
    if (linguetta) linguetta.remove();

    pannello.style.setProperty('display', 'block', 'important');
    aggiornaPadding();
    if (_osservaAltezza) _osservaAltezza.observe(pannello);
}

/*
 * Sotto Tampermonkey la barra c'e' sempre e la x la richiude lasciando una
 * linguetta per riaprirla: non c'e' altro appiglio. Come estensione l'appiglio
 * esiste ed e' l'icona nella barra degli strumenti, quindi la linguetta non
 * compare: sarebbe un secondo interruttore per la stessa cosa, e uno dei due
 * finirebbe per essere quello sbagliato.
 */
function chiudiBarra() {
    if (!pannello || !_barraVisibile) return;
    _barraVisibile = false;

    chiudiImpostazioni();
    pannello.style.setProperty('display', 'none', 'important');
    document.body.style.removeProperty('padding-top');
    if (_osservaAltezza) _osservaAltezza.disconnect();

    if (comeEstensione()) return;

    var linguetta = document.createElement('button');
    linguetta.id = 'CU_Linguetta';
    linguetta.textContent = 'CASSETTO·UTILITY';
    linguetta.title = 'Riapri la barra';
    linguetta.onclick = mostraBarra;
    document.documentElement.appendChild(linguetta);
}

function commutaBarra() { if (_barraVisibile) chiudiBarra(); else mostraBarra(); }

/* ─── I COMANDI DELLA BARRA ─────────────────────────────────────
   Quali pulsanti compaiono dipende dalla pagina aperta: il cassetto e' un
   sito a pagine vere, non un'applicazione a vista singola, e ogni pagina
   offre cose diverse. La tabella qui sotto e' l'unico punto in cui e' scritto
   cosa si puo' fare dove.

   I pulsanti sono tre soli per tinta: ottone per l'azione principale della
   pagina, ardesia per quelle di contorno, contorno vuoto per la navigazione.
   Fino alla 0.08 erano sette colori diversi, che e' un colore per pulsante:
   non distinguevano niente, decoravano soltanto.
─────────────────────────────────────────────────────────────── */

function rebuildButtons() {
    detectContext();
    var idInfo = getIdentifier();
    var delega = isDelegato();

    var badgeEl = document.getElementById('CU_Badge');
    if (badgeEl) {
        badgeEl.textContent = (delega ? 'delega ' : '') + idInfo.code;
        badgeEl.className = delega ? 'delega' : '';
        badgeEl.title = delega ? 'Cassetto delegato'
                      : (idInfo.tipo === 'cf' ? 'Codice fiscale' : 'Partita IVA');
    }

    var docTagEl = document.getElementById('CU_DocTag');
    if (docTagEl) {
        if (isListPage || isDetailPage || isF24Search || isF24SearchRes) {
            docTagEl.className = 'cu-dtag'; docTagEl.textContent = docType || 'F24';
        } else if (isVersPage) {
            docTagEl.className = 'cu-dtag'; docTagEl.textContent = 'Versamenti';
        } else { docTagEl.className = ''; docTagEl.textContent = ''; }
    }

    var container = document.getElementById('CU_Buttons');
    if (!container) return;
    var h = '';

    if (isF24List) {
        h = '<button class="cuBtn cu-primario" data-action="downloadAll">Scarica F24</button>' +
            '<button class="cuBtn cu-azione" data-action="reportExcel">Report Excel</button>' +
            '<button class="cuBtn cu-azione" data-action="reportTributiF24">Dettaglio tributi</button>' +
            '<button class="cuBtn cu-quieto" data-action="copyProto">Protocolli</button>' +
            '<button class="cuBtn cu-quieto" data-action="summary">Riepilogo</button>';
    } else if (isF23List) {
        h = '<button class="cuBtn cu-primario" data-action="downloadAllF23">Scarica F23</button>' +
            '<button class="cuBtn cu-azione" data-action="reportExcel">Report Excel</button>' +
            '<button class="cuBtn cu-quieto" data-action="summary">Riepilogo</button>';
    } else if (isCUList) {
        h = '<button class="cuBtn cu-primario" data-action="downloadAllCU">Scarica CU</button>' +
            '<button class="cuBtn cu-azione" data-action="reportExcelCU">Report Excel CU</button>' +
            '<button class="cuBtn cu-quieto" data-action="summary">Riepilogo</button>';
    } else if (isF24SearchRes) {
        h = '<button class="cuBtn cu-primario" data-action="downloadF24Sel">Scarica F24</button>' +
            '<button class="cuBtn cu-azione" data-action="reportExcelSel">Report Excel</button>' +
            '<button class="cuBtn cu-quieto" data-action="summarySel">Riepilogo</button>' +
            '<span id="CU_AttoFilter"><label for="CU_AttoInput">Cod. atto</label>' +
            '<input id="CU_AttoInput" type="text" placeholder="tutti"' +
            ' title="Filtra download e report per codice atto. Vuoto: tutti."></span>';
        if (document.getElementById('tabf-1')) {
            h += '<button class="cuBtn cu-quieto" data-action="dateSelector">Periodo</button>';
        }
    } else if (isF24Search) {
        h = '<button class="cuBtn cu-primario" data-action="dateSelector">Periodo</button>';
    } else if (isF24Detail) {
        h = '<button class="cuBtn cu-primario" data-action="downloadDetailPDF">Copia F24</button>' +
            '<button class="cuBtn cu-azione" data-action="downloadQuietanza">Quietanza</button>';
    } else if (isF23Detail) {
        h = '<button class="cuBtn cu-primario" data-action="downloadDetailPDF">Copia F23</button>';
    } else if (isCUDetail) {
        h = '<button class="cuBtn cu-primario" data-action="downloadCUPdf">Genera PDF CU</button>';
    } else if (isF24SearchDetail) {
        // Dalle ricerche tributi il portale non espone la quietanza, solo la copia
        h = '<button class="cuBtn cu-primario" data-action="downloadDetailPDF">Copia F24</button>';
    } else if (isVersPage) {
        h = '<button class="cuBtn cu-quieto" data-action="goToF24">Modello F24</button>' +
            '<button class="cuBtn cu-quieto" data-action="goToF23">Modello F23</button>';
    } else {
        h = '<button class="cuBtn cu-quieto" data-action="goToVers">Versamenti</button>' +
            '<button class="cuBtn cu-quieto" data-action="goToCU">Certificazioni uniche</button>';
    }

    container.innerHTML = h;
    container.querySelectorAll('.cuBtn').forEach(function(btn) {
        btn.addEventListener('click', handleAction);
    });
    hideSt();
    summaryVisible = false;
    aggiornaPadding();
}

/* ─── AVANZAMENTO ───────────────────────────────────────────────
   L'esito non sta piu' in un'emoji davanti al testo: sta nel colore della
   riga, che si legge anche di sfuggita, e nelle parole, che si leggono anche
   senza distinguere i colori.
─────────────────────────────────────────────────────────────── */

function showSt(msg, pct, esito) {
    var row = document.getElementById('CU_BottomRow');
    var fill = document.getElementById('CU_PFill');
    var st = document.getElementById('CU_Status');
    if (row) row.style.setProperty('display', 'block', 'important');
    if (st) { st.textContent = msg; st.className = esito || ''; }
    if (fill && pct !== undefined) fill.style.setProperty('width', Math.min(100, pct) + '%', 'important');
    aggiornaPadding();
}

function hideSt() {
    var row = document.getElementById('CU_BottomRow');
    if (row) row.style.setProperty('display', 'none', 'important');
    aggiornaPadding();
}

/* ─── IL RESOCONTO ──────────────────────────────────────────────
   La riga di avanzamento compare quando parte un lavoro e alla fine resta,
   perché quello che c'è scritto - quanti scaricati, quanti no - è il
   resoconto di ciò che è appena successo.

   Restare per sempre però è un'altra cosa: occupava spazio fino al
   ricaricamento della pagina, e il testo veniva poi riscritto da messaggi
   che con quel lavoro non c'entravano niente. Da qui la ×, e una chiusura
   automatica che scatta solo quando non c'è nulla di storto da leggere.
─────────────────────────────────────────────────────────────── */

var _timerChiusura = null;
var ATTESA_CHIUSURA = 20000;

function annullaChiusuraProgrammata() {
    if (_timerChiusura) { clearTimeout(_timerChiusura); _timerChiusura = null; }
}

function chiudiReport() {
    annullaChiusuraProgrammata();
    hideSt();
    var chiudi = document.getElementById('CU_ChiudiReport');
    if (chiudi) chiudi.style.setProperty('display', 'none', 'important');
    var st = document.getElementById('CU_Status');
    if (st) { st.textContent = ''; st.className = ''; }
    var fill = document.getElementById('CU_PFill');
    if (fill) fill.style.setProperty('width', '0%', 'important');

    /*
     * Col menu la barra era comparsa solo per mostrare l'avanzamento: chiuso
     * il resoconto non ha più niente da dire e se ne va, lasciando la pagina
     * com'era prima del comando.
     */
    if (comeEstensione() && opzioni.apertura === 'menu') chiudiBarra();
}

/**
 * A fine lavoro mostra la × e, se non c'è niente di storto, chiude da sé dopo
 * venti secondi. Con degli errori resta finché non la si chiude a mano: è
 * proprio quello che si vuole leggere, e sparirebbe mentre lo si legge.
 */
function concludiReport(conErrori) {
    var chiudi = document.getElementById('CU_ChiudiReport');
    if (chiudi) chiudi.style.setProperty('display', 'inline-block', 'important');
    aggiornaPadding();

    annullaChiusuraProgrammata();
    if (conErrori) return;
    _timerChiusura = setTimeout(chiudiReport, ATTESA_CHIUSURA);
}

/**
 * Blocca la barra mentre un lotto è in corso.
 *
 * Non solo i pulsanti dei comandi: anche la × e l'ingranaggio. Un lotto
 * avviato non si può interrompere, e chiudere la barra a metà di duecento
 * documenti non fermerebbe niente - toglierebbe solo il modo di vedere a che
 * punto è arrivato, mentre il browser continua a ricevere file.
 */
function setDis(val) {
    document.querySelectorAll('#CU_Buttons .cuBtn').forEach(function(b) { b.disabled = val; });
    ['CU_X', 'CU_Impostazioni'].forEach(function(id) {
        var b = document.getElementById(id);
        if (b) b.disabled = val;
    });

    /*
     * setDis(true) è il gesto che apre ogni lavoro lungo, e quindi è il punto
     * giusto per togliere di mezzo il resoconto di quello precedente: la × non
     * deve poter chiudere una riga che sta per essere riscritta, e la chiusura
     * automatica non deve scattare a metà di un nuovo scarico.
     */
    if (val) {
        annullaChiusuraProgrammata();
        var chiudi = document.getElementById('CU_ChiudiReport');
        if (chiudi) chiudi.style.setProperty('display', 'none', 'important');
    }
}

/**
 * Rete di sicurezza attorno a un'azione.
 *
 * I flussi lunghi bloccano la barra all'inizio e la sbloccano alla fine, ma
 * un'eccezione a metà salterebbe lo sblocco e lascerebbe la barra inerte fino
 * al ricaricamento della pagina, senza dire niente. Per uno strumento che
 * archivia documenti fiscali è il guasto peggiore, perché somiglia a un lavoro
 * finito. Qui si riporta la barra in uno stato usabile e si dice cosa è
 * successo, invece di lasciare una promessa rifiutata che nessuno raccoglie.
 */
function eseguiAzioneProtetta(action) {
    return Promise.resolve()
        .then(function() { return eseguiAzione(action); })
        .catch(function(e) {
            var motivo = (e && e.message) ? e.message : String(e);
            log('Azione "' + action + '" interrotta: ' + motivo);
            showSt('Operazione interrotta da un errore: ' + motivo, 100, 'errore');
            setDis(false);
            concludiReport(true);
        });
}

/* ─── DIALOGO DI CONFERMA ───────────────────────────────────────
   Riceve righe di testo, non markup: il messaggio contiene conteggi e stringhe
   digitate dall'utente, e passarle a innerHTML sarebbe un modo per farsi
   iniettare markup nella propria interfaccia.
─────────────────────────────────────────────────────────────── */

function showAlert(titolo, righe, okText, cancelText) {
    return new Promise(function(resolve) {
        var overlay = document.createElement('div');
        overlay.id = 'CU_AlertOverlay';
        var box = document.createElement('div');
        box.id = 'CU_AlertBox';
        box.setAttribute('role', 'dialog');
        box.setAttribute('aria-modal', 'true');
        box.innerHTML = '<h3></h3><div id="CU_AlertTesto"></div><div id="CU_AlertAzioni"></div>';

        box.querySelector('h3').textContent = titolo;
        var testo = box.querySelector('#CU_AlertTesto');
        righe.forEach(function(r) {
            var pEl = document.createElement('p');
            pEl.textContent = r;
            testo.appendChild(pEl);
        });

        // Chi aveva il fuoco prima se lo ritrova alla chiusura
        var fuocoPrecedente = document.activeElement;

        function chiudi(esito) {
            document.removeEventListener('keydown', suTasto, true);
            overlay.remove();
            if (fuocoPrecedente && fuocoPrecedente.focus) fuocoPrecedente.focus();
            resolve(esito);
        }

        /*
         * Il dialogo si dichiara aria-modal, quindi il fuoco non deve poterne
         * uscire con Tab: sono due soli pulsanti, e si girano in tondo. Senza
         * questo la dichiarazione sarebbe una promessa non mantenuta.
         */
        function suTasto(e) {
            if (e.key === 'Escape') { chiudi(false); return; }
            if (e.key !== 'Tab') return;
            var fuocabili = box.querySelectorAll('button');
            if (!fuocabili.length) return;
            var primo = fuocabili[0], ultimo = fuocabili[fuocabili.length - 1];
            if (e.shiftKey && document.activeElement === primo) { e.preventDefault(); ultimo.focus(); }
            else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primo.focus(); }
            else if (!box.contains(document.activeElement)) { e.preventDefault(); primo.focus(); }
        }

        var azioni = box.querySelector('#CU_AlertAzioni');
        var btnOk = document.createElement('button');
        btnOk.className = 'cuBtn cu-primario';
        btnOk.textContent = okText || 'OK';
        btnOk.onclick = function() { chiudi(true); };
        var btnAnnulla = document.createElement('button');
        btnAnnulla.className = 'cuBtn cu-alternativa';
        btnAnnulla.textContent = cancelText || 'Annulla';
        btnAnnulla.onclick = function() { chiudi(false); };
        azioni.appendChild(btnOk);
        azioni.appendChild(btnAnnulla);

        overlay.appendChild(box);
        // Su documentElement come la barra: dentro <body> il CSS del portale
        // e i suoi z-index tornerebbero a contare
        document.documentElement.appendChild(overlay);
        document.addEventListener('keydown', suTasto, true);
        btnOk.focus();
    });
}

/**
 * Chiede conferma prima di un lotto lungo. Restituisce sempre una promessa di
 * booleano, cosi' i chiamanti non devono sapere se la domanda e' stata posta.
 */
function confermaLotto(quanti, cosa) {
    if (!opzioni.chiediConferma || quanti <= SOGLIA_CONFERMA) return Promise.resolve(true);
    return showAlert(
        'Lotto di ' + quanti + ' documenti',
        ['Stai per scaricare ' + quanti + ' ' + cosa + ' in formato PDF.',
         'Una volta avviata, la procedura non puo’ essere interrotta: il browser ' +
         'ricevera’ un file dopo l’altro finche’ non finisce.',
         'Vuoi procedere?'],
        'Procedi', 'Annulla'
    );
}

/* ─── IMPOSTAZIONI ──────────────────────────────────────────────
   Un pannello sotto la barra. Raccoglie tutto cio' che e' preferenza e non
   azione: come si comporta lo scarico, come si apre lo strumento, che colori
   usare.
─────────────────────────────────────────────────────────────── */

var PANNELLO = 'CU_Pannello';

function creaInterruttore(chiave, titolo, nota) {
    var b = document.createElement('button');
    b.className = 'cuOpzione';
    b.setAttribute('role', 'checkbox');
    b.innerHTML = '<span class="cuCasella" aria-hidden="true">✓</span>' +
                  '<span><span class="cuNome"></span><span class="cuNota"></span></span>';

    var nome = b.querySelector('.cuNome');
    var stato = document.createElement('span');
    stato.className = 'cuStato';

    function aggiorna() {
        var acceso = !!opzioni[chiave];
        b.setAttribute('aria-checked', String(acceso));
        nome.textContent = titolo;
        stato.textContent = acceso ? 'sì' : 'no';
        nome.appendChild(stato);
    }

    b.querySelector('.cuNota').textContent = nota;
    aggiorna();

    b.onclick = function() {
        opzioni[chiave] = !opzioni[chiave];
        aggiorna();
        salvaOpzioni();
    };
    return b;
}

/** Un bottone con titolo e spiegazione, usato per le scelte a gruppo. */
function creaScelta(titolo, nota, selezionato, alClic) {
    var b = document.createElement('button');
    b.className = 'cuTema';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(selezionato));
    var nome = document.createElement('span');
    nome.className = 'cuNome';
    nome.textContent = titolo;
    var notaEl = document.createElement('span');
    notaEl.className = 'cuNota';
    notaEl.textContent = nota;
    var involucro = document.createElement('span');
    involucro.appendChild(nome);
    involucro.appendChild(notaEl);
    b.appendChild(involucro);
    b.onclick = alClic;
    return b;
}

function apriImpostazioni() {
    if (document.getElementById(PANNELLO)) { chiudiImpostazioni(); return; }
    if (!pannello) return;

    var box = document.createElement('div');
    box.id = PANNELLO;
    box.innerHTML =
        '<h3>Come scaricare</h3><div id="CU_Opzioni"></div>' +
        '<h3>Come aprire lo strumento</h3><div id="CU_Apertura"' +
            ' role="radiogroup" aria-label="Come aprire lo strumento"></div>' +
        '<h3>Tema</h3><div id="CU_Temi" role="radiogroup" aria-label="Tema"></div>';
    pannello.appendChild(box);

    var opz = box.querySelector('#CU_Opzioni');
    opz.appendChild(creaInterruttore(
        'quietanzaSeDisponibile',
        'Preferisci la quietanza alla copia',
        'Per gli F24 quietanzati scarica la ricevuta di pagamento. Spento, scarica sempre la copia del modello.'));
    opz.appendChild(creaInterruttore(
        'chiediConferma',
        'Chiedi conferma oltre i ' + SOGLIA_CONFERMA + ' documenti',
        'Un lotto lungo occupa il browser per minuti e non si puo’ interrompere.'));

    /* Come si apre: la domanda ha senso solo dove esiste un'icona nel browser */
    var apertura = box.querySelector('#CU_Apertura');
    if (!comeEstensione()) {
        var titoloApertura = apertura.previousElementSibling;
        if (titoloApertura) titoloApertura.remove();
        apertura.remove();
        apertura = null;
    }
    if (apertura) {
        [['menu',  'Menu sull’icona', 'I comandi stanno nel menu del browser. La barra compare quando serve.'],
         ['barra', 'Barra nella pagina', 'L’icona apre e chiude la barra, come sotto Tampermonkey.']
        ].forEach(function(v) {
            apertura.appendChild(creaScelta(v[1], v[2], opzioni.apertura === v[0], function() {
                opzioni.apertura = v[0];
                salvaOpzioni();
                apertura.querySelectorAll('.cuTema').forEach(function(x, i) {
                    x.setAttribute('aria-checked', String(['menu', 'barra'][i] === opzioni.apertura));
                });
            }));
        });
    }

    var elenco = box.querySelector('#CU_Temi');
    TEMI.forEach(function(t) {
        var b = creaScelta(t.nome, t.nota, t.id === _temaAttivo, function() {
            applicaTema(t.id, true);
            aggiornaSceltaTema();
        });
        // Il campione mostra i colori veri del tema: fondo, accento, esito
        var campione = document.createElement('span');
        campione.className = 'cuCampione';
        [t.barra.inchiostro, t.barra.ottone, t.esito.riuscito, t.esito.errore].forEach(function(colore) {
            var tacca = document.createElement('span');
            tacca.style.setProperty('background', colore, 'important');
            campione.appendChild(tacca);
        });
        b.insertBefore(campione, b.firstChild);
        elenco.appendChild(b);
    });

    var bottone = document.getElementById('CU_Impostazioni');
    if (bottone) { bottone.classList.add('attivo'); bottone.setAttribute('aria-expanded', 'true'); }

    box.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') chiudiImpostazioni();
    });
    aggiornaPadding();
    var primo = box.querySelector('.cuOpzione');
    if (primo) primo.focus();
}

function aggiornaSceltaTema() {
    var elenco = document.getElementById('CU_Temi');
    if (!elenco) return;
    var bottoni = elenco.querySelectorAll('.cuTema');
    for (var i = 0; i < bottoni.length; i++) {
        bottoni[i].setAttribute('aria-checked', String(TEMI[i].id === _temaAttivo));
    }
}

function chiudiImpostazioni() {
    var box = document.getElementById(PANNELLO);
    if (box) box.remove();
    var bottone = document.getElementById('CU_Impostazioni');
    if (bottone) { bottone.classList.remove('attivo'); bottone.setAttribute('aria-expanded', 'false'); }
    aggiornaPadding();
}


/* ═══════════════════════════════════════════════════════════════
   F24/F23 — COLLECT & DOWNLOAD
   ═══════════════════════════════════════════════════════════════ */

function collectF24() {
    var rows = [];
    document.querySelectorAll('a.btn[href*="Ric=DetF24"]').forEach(function(a) {
        if (a.href.indexOf('DetF24Sel') !== -1) return; // skip search result links
        var row = a.closest('tr'); if (!row) return;
        var dateEl = row.querySelector('th');
        var impEl = row.querySelector('td[headers="importo"]');
        var proEl = row.querySelector('td[headers="protocollo"]');
        var qLink = row.querySelector('a[href*="stampa=Q"]');
        rows.push({
            detHref:row.querySelector('a.btn').href, qHref:qLink?qLink.href:null,
            date:dateEl?dateEl.textContent.trim():'', importo:impEl?impEl.textContent.trim().replace(/\s+/g,' '):'',
            proto:proEl?proEl.textContent.trim():'', hasQuietanza:!!qLink, docType:'F24'
        });
    });
    return rows;
}

function collectF23() {
    var rows = [];
    document.querySelectorAll('a[href*="Ric=DetF23"]').forEach(function(a) {
        var row = a.closest('tr'); if (!row) return;
        var dateEl = row.querySelector('th[headers="dataversamento"]') || row.querySelector('th');
        var impEl = row.querySelector('td[headers="saldo"]') || row.querySelector('td');
        rows.push({
            detHref:a.href, qHref:null, date:dateEl?dateEl.textContent.trim():'',
            importo:impEl?impEl.textContent.trim().replace(/\s+/g,' '):'', proto:'', hasQuietanza:false, docType:'F23'
        });
    });
    return rows;
}

/* Collect F24 da risultati ricerca (DetF24Sel) */
function collectF24Sel() {
    var rows = [];
    document.querySelectorAll('a[href*="Ric=DetF24Sel"]').forEach(function(a) {
        var row = a.closest('tr'); if (!row) return;
        var dateEl = row.querySelector('td[headers="data"]');
        var tribEl = row.querySelector('th[headers="tributo"]');
        var descEl = row.querySelector('td[headers="tributo"]');
        var debEl  = row.querySelector('td[headers="debito"]');
        var credEl = row.querySelector('td[headers="credito"]');
        var annoEl = row.querySelector('td[headers="anno"]');
        rows.push({
            detHref: a.href,
            qHref: null,
            date: dateEl ? dateEl.textContent.trim() : '',
            tributo: tribEl ? tribEl.textContent.trim() : '',
            descrizione: descEl ? descEl.textContent.trim() : '',
            importo: debEl ? debEl.textContent.trim().replace(/\s+/g,' ') : '',
            credito: credEl ? credEl.textContent.trim().replace(/\s+/g,' ') : '',
            annoRif: annoEl ? annoEl.textContent.trim() : '',
            proto: '', hasQuietanza: false, docType: 'F24'
        });
    });
    return rows;
}

/* ─── DOWNLOAD INVISIBILE ─────────────────────────────────────
   Usa fetch() con cookies di sessione per scaricare il PDF come blob,
   poi salva tramite <a download> nascosto.
   Nessuna tab viene aperta — tutto avviene in background.
   ─────────────────────────────────────────────────────────────── */

/* Salva un blob come file — crea un <a download> nascosto e lo clicca */
function saveBlob(blob, filename) {
    var bu = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = bu; a.download = filename; a.style.display = 'none';
    document.body.appendChild(a); a.click();
    // rimuovi dopo un breve delay per dare al browser il tempo di avviare il download
    setTimeout(function(){ document.body.removeChild(a); URL.revokeObjectURL(bu); }, 10000);
}

/**
 * Vero solo per le URL del cassetto.
 *
 * Gli indirizzi che passiamo a fetch vengono da href letti nella pagina, e la
 * pagina in teoria potrebbe portarne altrove. I cookie sono per origine,
 * quindi non ci sarebbe esfiltrazione di sessione, ma mandare una richiesta
 * autenticata a un indirizzo che non abbiamo scelto noi non deve dipendere da
 * un ragionamento: costa una riga escluderlo.
 */
function sulCassetto(url) {
    try { return new URL(url, BASE_URL).origin === BASE_URL; }
    catch (e) { return false; }
}

/**
 * Vero se il blob è davvero un PDF.
 *
 * La misura da sola non basta: una pagina di sessione scaduta supera
 * abbondantemente qualunque soglia in byte e verrebbe salvata con estensione
 * .pdf, contata come riuscita e riportata «Scaricato» nel foglio. Si guardano
 * i primi quattro byte, che in un PDF sono sempre %PDF.
 */
function eUnPdf(blob) {
    if (blob.size < 500) return Promise.resolve(false);
    return blob.slice(0, 4).arrayBuffer().then(function(inizio) {
        var b = new Uint8Array(inizio);
        return b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46;
    }).catch(function() { return false; });
}

/* Download PDF via GET — fetch invisibile */
function dlPdf(url, filename) {
    if (!sulCassetto(url)) { log('Indirizzo fuori dal cassetto, ignorato: ' + url); return Promise.resolve(false); }
    return fetch(url, {credentials:'include'})
        .then(function(r){ return r.blob(); })
        .then(function(blob) {
            return eUnPdf(blob).then(function(ok) {
                if (!ok) return false;
                saveBlob(blob, filename);
                return true;
            });
        })
        .catch(function(err){ log('Download non riuscito: ' + err); return false; });
}

var dlLog = [];

async function runBatch(rows) {
    if (!rows.length) { showSt('Nessun versamento trovato.', 0, 'avviso'); concludiReport(true); return; }
    if (!await confermaLotto(rows.length, 'versamenti')) { showSt('Download annullato.', 0, 'avviso'); setTimeout(hideSt, 3000); return; }
    setDis(true); dlLog = [];
    var ok_n = 0, fail_n = 0;
    for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        var anno = getParam('Anno', row.detHref) || 'XXXX';
        var idx = getParam('indice', row.detHref) || String(i);
        var dlUrl, tipo;
        if (row.docType === 'F24') {
            // La quietanza e' la prova del pagamento, la copia e' il modello:
            // chi archivia per il cliente vuole la prima, chi ricontrolla i
            // tributi la seconda. Sceglie l'utente, dalle impostazioni.
            if (row.hasQuietanza && opzioni.quietanzaSeDisponibile) { dlUrl = row.qHref; tipo = 'QuietanzaF24'; }
            else { dlUrl = row.detHref+'&stampa=P'; tipo = 'CopiaF24'; }
        } else { dlUrl = row.detHref+'&stampa=P'; tipo = 'CopiaF23'; }
        var fname = buildFilename(tipo, anno, row.date, idx);
        showSt('('+(i+1)+'/'+rows.length+') '+fname, Math.round(i/rows.length*100));
        var ok = await dlPdf(dlUrl, fname);
        dlLog.push({date:row.date, importo:row.importo, proto:row.proto, docType:row.docType, tipo:tipo, filename:fname, ok:ok});
        if (ok) ok_n++; else fail_n++;
        await sleep(600);
    }
    document.getElementById('CU_PFill').style.setProperty('width','100%','important');
    showSt('Completato: '+ok_n+' scaricati'+(fail_n>0?', '+fail_n+' non riusciti':'')+'. Il report Excel mette a confronto elenco e file.', 100, fail_n>0?'avviso':'riuscito');
    setDis(false);
    concludiReport(fail_n > 0);
}

/* Batch download F24 da ricerca — con filtro codice atto opzionale
   NOTA: l'URL per stampa=P deve essere costruito con solo i parametri essenziali
   (Ric=DetF24Sel, Anno, indice, stampa=P) — senza TIPORICERCAF24 e altri parametri
   extra che sono presenti nel link della lista ma NON nel link PDF del dettaglio.
*/
async function runBatchF24Sel(rows) {
    if (!rows.length) { showSt('Nessun versamento trovato.', 0, 'avviso'); concludiReport(true); return; }
    var filtroAtto = '';
    var attoInput = document.getElementById('CU_AttoInput');
    if (attoInput) filtroAtto = attoInput.value.trim();

    setDis(true); dlLog = [];
    var ok_n = 0, fail_n = 0;

    // Se c'è filtro atto, pre-fetch tutti i dettagli per estrarre il codice atto
    if (filtroAtto) {
        showSt('Lettura dei codici atto per il filtro\u2026', 5);
        for (var p = 0; p < rows.length; p++) {
            var ca = await fetchCodiceAtto(rows[p].detHref);
            rows[p].codiceAtto = ca;
            showSt('Codici atto ('+(p+1)+'/'+rows.length+')\u2026', Math.round(p/rows.length*30));
            await sleep(300);
        }
        var filtrate = rows.filter(function(r) { return r.codiceAtto && r.codiceAtto.indexOf(filtroAtto) !== -1; });
        if (!filtrate.length) {
            showSt('Nessun F24 con codice atto "'+filtroAtto+'" fra i '+rows.length+' risultati.', 0, 'avviso');
            setDis(false); concludiReport(true); return;
        }
        var conferma = await showAlert(
            'Filtro per codice atto',
            [filtrate.length + ' F24 su ' + rows.length + ' hanno un codice atto che contiene "' + filtroAtto + '".',
             'Vuoi scaricare solo questi?'],
            'Scarica ' + filtrate.length, 'Annulla'
        );
        if (!conferma) { showSt('Download annullato.', 0, 'avviso'); setTimeout(hideSt, 3000); setDis(false); return; }
        rows = filtrate;
    } else if (!await confermaLotto(rows.length, 'versamenti')) {
        showSt('Download annullato.', 0, 'avviso'); setTimeout(hideSt, 3000); setDis(false); return;
    }

    for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        var anno = getParam('Anno', row.detHref) || row.annoRif || 'XXXX';
        var idx = getParam('indice', row.detHref) || String(i);
        // Costruisci l'URL PDF con solo i parametri essenziali
        var dlUrl = SERVLET + '?Ric=DetF24Sel&Anno=' + encodeURIComponent(anno) + '&indice=' + encodeURIComponent(idx) + '&stampa=P';
        var tipo = 'CopiaF24';
        var fname = buildFilename(tipo, anno, row.date, idx);
        showSt('('+(i+1)+'/'+rows.length+') '+fname, 30 + Math.round(i/rows.length*70));
        var ok = await dlPdf(dlUrl, fname);
        dlLog.push({date:row.date, importo:row.importo, tributo:row.tributo||'', codiceAtto:row.codiceAtto||'', proto:'', docType:'F24', tipo:tipo, filename:fname, ok:ok});
        if (ok) ok_n++; else fail_n++;
        await sleep(600);
    }
    document.getElementById('CU_PFill').style.setProperty('width','100%','important');
    var msg = 'Completato: '+ok_n+' scaricati';
    if (fail_n>0) msg += ', '+fail_n+' non riusciti';
    if (filtroAtto) msg += ' (filtro atto: '+filtroAtto+')';
    msg += '. Il report Excel ne tiene conto.';
    showSt(msg, 100, fail_n>0?'avviso':'riuscito');
    setDis(false);
    concludiReport(fail_n > 0);
}

/* ═══════════════════════════════════════════════════════════════
   CU — COLLECT, DOWNLOAD, EXCEL
   ═══════════════════════════════════════════════════════════════ */

function collectCU() {
    var items = [];
    document.querySelectorAll('a[href*="Ric=CUK"][href*="Protocollo="]').forEach(function(a) {
        var li = a.closest('li'); if (!li) return;
        var href = a.getAttribute('href');
        var protocollo = getParam('Protocollo', href);
        var anno = getParam('Anno', href);
        var linkText = a.textContent.trim();
        var dateMatch = linkText.match(/del\s+(\d{1,2}\/\d{1,2}\/\d{4})/);
        var dataCU = dateMatch ? dateMatch[1] : '';
        var numCert = linkText.replace(/\s*del\s+\d.*/, '').trim();
        var corrSpan = li.querySelector('span.correlato');
        var sostituto = '';
        if (corrSpan) { sostituto = corrSpan.childNodes[0] ? corrSpan.childNodes[0].textContent.trim() : corrSpan.textContent.trim(); }
        items.push({ href:href, protocollo:protocollo, anno:anno, numCert:numCert, data:dataCU, sostituto:sostituto, denominazione:'' });
    });
    return items;
}

/* Download singolo PDF CU via POST — fetch invisibile + saveBlob */
function dlCUPdf(anno, protocollo, filename) {
    var body = new URLSearchParams();
    body.append('Ric','CUK'); body.append('Anno',anno);
    body.append('Protocollo',protocollo); body.append('stampa','P');
    body.append('Fascicoli','SI'); body.append('TipoStampa','C');
    return fetch(SERVLET, {method:'POST', credentials:'include', body:body,
                           headers:{'Content-Type':'application/x-www-form-urlencoded'}})
        .then(function(r){ return r.blob(); })
        .then(function(blob) {
            return eUnPdf(blob).then(function(ok) {
                if (!ok) return false;
                saveBlob(blob, filename);
                return true;
            });
        })
        .catch(function(err){ log('Generazione del PDF CU non riuscita: ' + err); return false; });
}

/* 2) Fetch denominazione sostituto dal Quadro DA (DA001 002 + 003) */
function fetchDADenominazione(anno, protocollo) {
    var url = SERVLET+'?Ric=CUK&Anno='+encodeURIComponent(anno)+'&Protocollo='+encodeURIComponent(protocollo)+'&Quadro=DA&Modulo=1';
    return fetch(url, {credentials:'include'}).then(function(r){return r.text();}).then(function(html) {
        var doc = new DOMParser().parseFromString(html, 'text/html');
        var cognome = '', nome = '';
        var rows = doc.querySelectorAll('tbody tr');
        var inDA001 = false;
        for (var i = 0; i < rows.length; i++) {
            var thEl = rows[i].querySelector('th');
            if (thEl) {
                var txt = thEl.textContent.trim();
                if (txt === 'DA001') inDA001 = true;
                else if (/^DA\d/.test(txt) && txt !== 'DA001') inDA001 = false;
                var sr = thEl.querySelector('span.sr-only');
                if (sr && sr.textContent.trim() === 'DA001') inDA001 = true;
            }
            if (!inDA001) continue;
            var tds = rows[i].querySelectorAll('td');
            if (tds.length >= 3) {
                var num = tds[0].textContent.trim();
                var val = tds[2].textContent.trim();
                if (num === '002') cognome = val;
                if (num === '003') nome = val;
            }
        }
        var denom = cognome;
        if (nome) denom += ' ' + nome;
        return denom.trim();
    }).catch(function() { return ''; });
}

/* Fetch importi dal Quadro AU — singolo modulo */
function fetchAUSingleModule(anno, protocollo, modulo) {
    var url = SERVLET+'?Ric=CUK&Anno='+encodeURIComponent(anno)+'&Protocollo='+encodeURIComponent(protocollo)+'&Quadro=AU&Modulo='+modulo;
    return fetch(url, {credentials:'include'}).then(function(r){return r.text();}).then(function(html) {
        var doc = new DOMParser().parseFromString(html, 'text/html');
        var result = {causale:'', ammontareLordo:'', imponibile:'', ritenute:'', hasData:false};
        doc.querySelectorAll('table.table tr').forEach(function(tr) {
            var tds = tr.querySelectorAll('td');
            if (tds.length >= 3) {
                var campo = tds[1] ? tds[1].textContent.trim() : '';
                var valore = tds[2] ? tds[2].textContent.trim() : '';
                if (campo.indexOf('Causale') !== -1 && valore) { result.causale = valore; result.hasData = true; }
                if (campo.indexOf('Ammontare lordo') !== -1 && valore) { result.ammontareLordo = valore; result.hasData = true; }
                if (campo.indexOf('Imponibile') !== -1 && valore) { result.imponibile = valore; result.hasData = true; }
                if (campo.indexOf('Ritenute') !== -1 && campo.indexOf('acconto') !== -1 && valore) { result.ritenute = valore; result.hasData = true; }
            }
        });
        // Verifica che la pagina contenga effettivamente il quadro AU (non una pagina di errore/vuota)
        if (!result.hasData && doc.querySelectorAll('table.table tr').length < 2) result.hasData = false;
        return result;
    }).catch(function() { return {causale:'', ammontareLordo:'', imponibile:'', ritenute:'', hasData:false}; });
}

/* Fetch importi AU multi-modulo — itera Modulo 1…N finché trova dati */
async function fetchAUDataMultiModulo(anno, protocollo) {
    var moduli = [];
    for (var m = 1; m <= 20; m++) { // safety cap a 20 moduli
        var au = await fetchAUSingleModule(anno, protocollo, m);
        if (!au.hasData && m > 1) break; // nessun dato dal modulo 2 in poi → fine
        if (au.hasData) moduli.push({modulo:m, causale:au.causale, ammontareLordo:au.ammontareLordo, imponibile:au.imponibile, ritenute:au.ritenute});
        if (!au.hasData && m === 1) break; // neanche modulo 1 ha dati AU
        await sleep(200);
    }
    return moduli; // array di {modulo, causale, ammontareLordo, imponibile, ritenute}
}

/* Fetch dati Quadro DB (lavoro dipendente) — singolo modulo
   Campi chiave nel Quadro DB:
   - DB001 campo 001 = Redditi di lavoro dipendente e assimilati
   - DB002 = vari campi ritenute
   Approccio generico: cerca etichette note nella tabella */
function fetchDBSingleModule(anno, protocollo, modulo) {
    var url = SERVLET+'?Ric=CUK&Anno='+encodeURIComponent(anno)+'&Protocollo='+encodeURIComponent(protocollo)+'&Quadro=DB&Modulo='+modulo;
    return fetch(url, {credentials:'include'}).then(function(r){return r.text();}).then(function(html) {
        var doc = new DOMParser().parseFromString(html, 'text/html');
        var result = {redditiLavDip:'', ritenuteIrpef:'', addRegionale:'', addComunale:'', hasData:false};
        var allRows = doc.querySelectorAll('table.table tr');
        allRows.forEach(function(tr) {
            var tds = tr.querySelectorAll('td');
            if (tds.length >= 3) {
                var campo = tds[1] ? tds[1].textContent.trim() : '';
                var valore = tds[2] ? tds[2].textContent.trim() : '';
                // Redditi lavoro dipendente
                if ((campo.indexOf('Redditi di lavoro dipendente') !== -1 || campo.indexOf('redditi di lavoro dipendente') !== -1) && valore) {
                    result.redditiLavDip = valore; result.hasData = true;
                }
                // Ritenute IRPEF
                if (campo.indexOf('Ritenute') !== -1 && campo.indexOf('Irpef') !== -1 && valore) {
                    result.ritenuteIrpef = valore; result.hasData = true;
                }
                // Addizionale regionale
                if (campo.indexOf('Addizionale regionale') !== -1 && valore) {
                    result.addRegionale = valore; result.hasData = true;
                }
                // Addizionale comunale — acconto + saldo (prendi il primo trovato)
                if (campo.indexOf('Addizionale comunale') !== -1 && valore && !result.addComunale) {
                    result.addComunale = valore; result.hasData = true;
                }
            }
        });
        if (!result.hasData && allRows.length < 2) result.hasData = false;
        return result;
    }).catch(function() { return {redditiLavDip:'', ritenuteIrpef:'', addRegionale:'', addComunale:'', hasData:false}; });
}

/* Fetch dati DB multi-modulo */
async function fetchDBDataMultiModulo(anno, protocollo) {
    var moduli = [];
    for (var m = 1; m <= 20; m++) {
        var db = await fetchDBSingleModule(anno, protocollo, m);
        if (!db.hasData && m > 1) break;
        if (db.hasData) moduli.push({modulo:m, redditiLavDip:db.redditiLavDip, ritenuteIrpef:db.ritenuteIrpef, addRegionale:db.addRegionale, addComunale:db.addComunale});
        if (!db.hasData && m === 1) break;
        await sleep(200);
    }
    return moduli;
}

/* Fetch codice atto da pagina dettaglio F24 (DetF24Sel o DetF24)
   Il codice atto si trova nel HTML come: codice atto <b>VALORE</b> */
function fetchCodiceAtto(detHref) {
    if (!sulCassetto(detHref)) return Promise.resolve('');
    return fetch(detHref, {credentials:'include'}).then(function(r){return r.text();}).then(function(html) {
        var m = html.match(/codice\s+atto\s*<b>\s*([^<]*?)\s*<\/b>/i);
        if (m && m[1] && m[1].trim() && m[1].trim().toLowerCase() !== 'assente') return m[1].trim();
        return '';
    }).catch(function() { return ''; });
}

/* Fetch + parsing del dettaglio F24 (Ric=DetF24…): estrae codice atto e una riga per
   ogni codice tributo/causale di tutte le sezioni (Erario, INPS, INAIL, Regioni, IMU…).
   Le colonne variano per sezione, ma td[headers="debito"]/td[headers="credito"] sono
   ancore costanti; il codice (tributo/causale/pos.ass.) è sempre nel <th> del rigo,
   la descrizione (quando presente) in td[headers="tributo"].
   Su errore di rete restituisce {codiceAtto:'', righi:[]}. */
function fetchF24Tributi(detHref) {
    if (!sulCassetto(detHref)) return Promise.resolve({ codiceAtto: '', righi: [] });
    return fetch(detHref, {credentials:'include'}).then(function(r){return r.text();}).then(function(html) {
        var codiceAtto = '';
        var ma = html.match(/codice\s+atto\s*<b>\s*([^<]*?)\s*<\/b>/i);
        if (ma && ma[1] && ma[1].trim() && ma[1].trim().toLowerCase() !== 'assente') codiceAtto = ma[1].trim();

        var doc = new DOMParser().parseFromString(html, 'text/html');
        var righi = [];
        function clean(el) { return el ? el.textContent.trim().replace(/\s+/g,' ') : ''; }

        doc.querySelectorAll('h4').forEach(function(h4) {
            var titolo = h4.textContent.trim().replace(/\s+/g,' ');
            if (!/Sezione/i.test(titolo)) return;
            var sezione = titolo.replace(/^Sezione\s*/i, '').trim();
            var box = h4.closest('div.border') || h4.parentElement;
            var table = box ? box.querySelector('table') : null;
            if (!table) return;
            table.querySelectorAll('tbody > tr').forEach(function(tr) {
                var deb = tr.querySelector('td[headers="debito"]');
                var cred = tr.querySelector('td[headers="credito"]');
                if (!deb && !cred) return; // salta righe non-dato
                righi.push({
                    sezione: sezione,
                    codice: clean(tr.querySelector('th[headers]')),
                    descrizione: clean(tr.querySelector('td[headers="tributo"]')),
                    rateazione: clean(tr.querySelector('td[headers="rateazione"]')),
                    anno: clean(tr.querySelector('td[headers="anno"]')),
                    debito: clean(deb),
                    credito: clean(cred)
                });
            });
        });
        return { codiceAtto: codiceAtto, righi: righi };
    }).catch(function() { return { codiceAtto: '', righi: [] }; });
}

var cuDlLog = [];

async function runBatchCU(items) {
    if (!items.length) { showSt('Nessuna CU trovata.', 0, 'avviso'); concludiReport(true); return; }
    if (!await confermaLotto(items.length, 'certificazioni uniche')) {
        showSt('Download annullato.', 0, 'avviso'); setTimeout(hideSt, 3000); return;
    }
    setDis(true); cuDlLog = [];
    var ok_n = 0, fail_n = 0;
    for (var i = 0; i < items.length; i++) {
        var cu = items[i];
        var d = parseDate(cu.data);
        var fname = safe(getIdentifier().code)+'_'+safe(cu.anno)+'_'+safe(d.m)+'_'+safe(d.g)+'_CU_'+safe(cu.sostituto)+'_idx'+i+'.pdf';
        showSt('('+(i+1)+'/'+items.length+') '+fname, Math.round(i/items.length*100));
        var ok = await dlCUPdf(cu.anno, cu.protocollo, fname);
        cuDlLog.push({numCert:cu.numCert, data:cu.data, sostituto:cu.sostituto, protocollo:cu.protocollo, filename:fname, ok:ok});
        if (ok) ok_n++; else fail_n++;
        await sleep(800);
    }
    document.getElementById('CU_PFill').style.setProperty('width','100%','important');
    showSt('Completato: '+ok_n+' scaricate'+(fail_n>0?', '+fail_n+' non riuscite':'')+'. Il report Excel CU ne fa il riepilogo.', 100, fail_n>0?'avviso':'riuscito');
    setDis(false);
    concludiReport(fail_n > 0);
}

/* Report Excel CU — Multi-tipo (Autonomo/Dipendente/Altro) + Multi-modulo
   Per ogni CU:
   1) Fetch Quadro AU (lavoro autonomo) multi-modulo
   2) Se AU vuoto, fetch Quadro DB (lavoro dipendente) multi-modulo
   3) Una riga Excel per ogni modulo trovato
   4) Colonne: Tipo CU, Descrizione Causale (da CAUSALI_MAP), denominazione sostituto */
async function reportExcelCU() {
    var items = collectCU();
    if (!items.length) { showSt('Nessuna CU trovata.', 0, 'avviso'); concludiReport(true); return; }
    setDis(true);
    var data = []; // una riga per ogni modulo di ogni CU
    var rowN = 0;
    for (var i = 0; i < items.length; i++) {
        var cu = items[i];
        showSt('Lettura dati CU ('+(i+1)+'/'+items.length+')\u2026', Math.round(i/items.length*100));
        var denom = await fetchDADenominazione(cu.anno, cu.protocollo);
        var logEntry = cuDlLog.find(function(l){return l.protocollo === cu.protocollo;});
        var fname = logEntry ? logEntry.filename : '';
        var stato = logEntry ? (logEntry.ok ? 'Scaricato' : 'Errore') : 'Non scaricato';

        // 1) Prova Quadro AU (lavoro autonomo) — multi-modulo
        var auModuli = await fetchAUDataMultiModulo(cu.anno, cu.protocollo);
        if (auModuli.length > 0) {
            for (var j = 0; j < auModuli.length; j++) {
                rowN++;
                var am = auModuli[j];
                var descrCausale = CAUSALI_MAP[am.causale] || am.causale;
                data.push({
                    n: rowN, numCert: cu.numCert, data: cu.data, sostituto: cu.sostituto,
                    denominazione: denom, tipoCU: 'Autonomo', modulo: am.modulo,
                    causale: am.causale, descrCausale: descrCausale,
                    col1Label: 'Ammontare Lordo', col1: am.ammontareLordo,
                    col2Label: 'Imponibile', col2: am.imponibile,
                    col3Label: 'Ritenute Acconto', col3: am.ritenute,
                    col4Label: '', col4: '',
                    filename: fname, stato: stato
                });
            }
        } else {
            // 2) Prova Quadro DB (lavoro dipendente) — multi-modulo
            var dbModuli = await fetchDBDataMultiModulo(cu.anno, cu.protocollo);
            if (dbModuli.length > 0) {
                for (var k = 0; k < dbModuli.length; k++) {
                    rowN++;
                    var dm = dbModuli[k];
                    data.push({
                        n: rowN, numCert: cu.numCert, data: cu.data, sostituto: cu.sostituto,
                        denominazione: denom, tipoCU: 'Dipendente', modulo: dm.modulo,
                        causale: '', descrCausale: 'Lavoro dipendente e assimilati',
                        col1Label: 'Redditi Lav.Dip.', col1: dm.redditiLavDip,
                        col2Label: 'Ritenute IRPEF', col2: dm.ritenuteIrpef,
                        col3Label: 'Add.Regionale', col3: dm.addRegionale,
                        col4Label: 'Add.Comunale', col4: dm.addComunale,
                        filename: fname, stato: stato
                    });
                }
            } else {
                // 3) Nessun dato AU n\u00e9 DB — riga con tipo "Altro"
                rowN++;
                data.push({
                    n: rowN, numCert: cu.numCert, data: cu.data, sostituto: cu.sostituto,
                    denominazione: denom, tipoCU: 'Altro', modulo: 1,
                    causale: '', descrCausale: '',
                    col1Label: '', col1: '', col2Label: '', col2: '',
                    col3Label: '', col3: '', col4Label: '', col4: '',
                    filename: fname, stato: stato
                });
            }
        }
        await sleep(200);
    }
    var cod = getIdentifier().code;
    var anno = getParam('Anno') || (items[0] && items[0].anno) || 'ANNO';
    var tipoCod = isDelegato() ? 'Cassetto Delegato' : (getIdentifier().tipo === 'cf' ? 'Cassetto Proprio (CF)' : 'Cassetto Proprio (PIVA)');
    var now = new Date();
    var nowStr = now.toLocaleDateString('it-IT')+' '+now.toLocaleTimeString('it-IT');
    var totOK = data.filter(function(d){return d.stato === 'Scaricato';}).length;
    var totERR = data.filter(function(d){return d.stato === 'Errore';}).length;
    var totNS = data.filter(function(d){return d.stato === 'Non scaricato';}).length;
    var totAut = data.filter(function(d){return d.tipoCU === 'Autonomo';}).length;
    var totDip = data.filter(function(d){return d.tipoCU === 'Dipendente';}).length;
    var totAltro = data.filter(function(d){return d.tipoCU === 'Altro';}).length;

    var S = '<Style ss:ID="', E = '</Style>';
    var styles = S+'hdr"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#1a3a2a" ss:Pattern="Solid"/>'+E
        +S+'ttl"><Font ss:Bold="1" ss:Size="14"/>'+E+S+'bld"><Font ss:Bold="1"/>'+E
        +S+'ok"><Interior ss:Color="#E8F5E9" ss:Pattern="Solid"/>'+E
        +S+'er"><Interior ss:Color="#FFEBEE" ss:Pattern="Solid"/>'+E
        +S+'wn"><Interior ss:Color="#FFF9C4" ss:Pattern="Solid"/>'+E
        +S+'aut"><Interior ss:Color="#E3F2FD" ss:Pattern="Solid"/>'+E
        +S+'dip"><Interior ss:Color="#FFF3E0" ss:Pattern="Solid"/>'+E
        +STILI_IMPORTO;

    // Foglio 1: ELENCO CU (dettaglio) — con Tipo CU, Desc Causale, multi-modulo
    var hdrs = ['N\u00B0','N. Certificazione','Data','CF Sostituto','Denominazione Sostituto',
        'Tipo CU','Modulo','Causale','Descrizione Causale',
        'Importo 1 (Lordo/Reddito)','Importo 2 (Impon./Rit.IRPEF)','Importo 3 (Rit.Acc./Add.Reg.)','Importo 4 (Add.Com.)',
        'Nome File','Stato'];
    var hrow = hdrs.map(function(h){return cella(h,'String','hdr');}).join('');
    var widths = [35,180,80,130,200,80,55,55,260,130,130,130,100,260,90];
    var cols = widths.map(function(w){return '<Column ss:Width="'+w+'"/>';}).join('');
    var drows = data.map(function(d) {
        var sty = d.stato === 'Scaricato' ? 'ok' : (d.stato === 'Errore' ? 'er' : 'wn');
        return '<Row>'+cella(d.n,'Number',sty)+cella(d.numCert,'String',sty)+cella(d.data,'String',sty)
            +cella(d.sostituto,'String',sty)+cella(d.denominazione,'String',sty)
            +cella(d.tipoCU,'String',sty)+cella(d.modulo,'Number',sty)+cella(d.causale,'String',sty)+cella(d.descrCausale,'String',sty)
            +cellaImporto(d.col1,sty)+cellaImporto(d.col2,sty)+cellaImporto(d.col3,sty)+cellaImporto(d.col4,sty)
            +cella(d.filename,'String',sty)+cella(d.stato,'String',sty)+'</Row>';
    }).join('');
    var sh1 = '<Worksheet ss:Name="Elenco CU"><Table>'+cols+'<Row>'+hrow+'</Row>'+drows+'</Table></Worksheet>';

    // Foglio 2: RIEPILOGO CU
    var sh2 = '<Worksheet ss:Name="Riepilogo CU">'
        +'<Table><Column ss:Width="220"/><Column ss:Width="180"/>'
        +'<Row>'+cella('Cassetto_Utility v'+VERSION+' \u2014 Report CU','String','ttl')+'</Row>'
        +'<Row>'+cella('Identificativo:')+cella(cod)+'</Row>'
        +'<Row>'+cella('Modalit\u00e0:')+cella(tipoCod)+'</Row>'
        +'<Row>'+cella('Anno imposta:')+cella(anno)+'</Row>'
        +'<Row>'+cella('Data report:')+cella(nowStr)+'</Row>'
        +'<Row/>'+
        '<Row>'+cella('CU trovate (certificazioni):','String','bld')+cella(items.length,'Number')+'</Row>'
        +'<Row>'+cella('Righe totali (con moduli):','String','bld')+cella(data.length,'Number')+'</Row>'
        +'<Row/>'+
        '<Row>'+cella('Tipo Autonomo:','String','bld')+cella(totAut,'Number','aut')+'</Row>'
        +'<Row>'+cella('Tipo Dipendente:','String','bld')+cella(totDip,'Number','dip')+'</Row>'
        +'<Row>'+cella('Tipo Altro:','String','bld')+cella(totAltro,'Number','wn')+'</Row>'
        +'<Row/>'+
        '<Row>'+cella('Scaricate:','String','bld')+cella(totOK,'Number','ok')+'</Row>'
        +'<Row>'+cella('Errori:','String','bld')+cella(totERR,'Number','er')+'</Row>'
        +'<Row>'+cella('Non scaricate:','String','bld')+cella(totNS,'Number','wn')+'</Row>'
        +'</Table></Worksheet>';

    var xls = '<?xml version="1.0" encoding="UTF-8"?><?mso-application progid="Excel.Sheet"?>'
        +'<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">'
        +'<Styles>'+styles+'</Styles>'+sh1+sh2+'</Workbook>';
    dlXLS(xls, safe(cod)+'_'+safe(anno)+'_ReportCU_CassettoUtility.xls');
    showSt('Report Excel CU generato: ' + data.length + ' righe da ' + items.length + ' CU.', 100, 'riuscito');
    setDis(false); concludiReport(false);
}

/* ═══════════════════════════════════════════════════════════════
   F24/F23 — BUILD XLS REPORT
   1) Foglio 1 = Elenco (dettaglio), Foglio 2 = Riepilogo
   ═══════════════════════════════════════════════════════════════ */

function buildXLS(rows, log) {
    var idInfo = getIdentifier(), cod = idInfo.code;
    var tipoCod = isDelegato() ? 'Cassetto Delegato' : (idInfo.tipo === 'cf' ? 'Cassetto Proprio (CF)' : 'Cassetto Proprio (PIVA)');
    var anno = getParam('Anno') || '', now = new Date();
    var nowStr = now.toLocaleDateString('it-IT')+' '+now.toLocaleTimeString('it-IT');
    var dt = isF24List ? 'F24' : 'F23';
    var logMap = {}; log.forEach(function(l){if(l.proto) logMap[l.proto] = l;}); var logArr = log.slice();
    var totQ = rows.filter(function(r){return r.hasQuietanza;}).length, totC = rows.length - totQ;
    var totOK = log.filter(function(l){return l.ok;}).length;
    var totERR = log.filter(function(l){return !l.ok;}).length;
    var totNS = rows.length - log.length;
    var S = '<Style ss:ID="', E = '</Style>';
    var styles = S+'hdr"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#1a3a2a" ss:Pattern="Solid"/>'+E
        +S+'ttl"><Font ss:Bold="1" ss:Size="14"/>'+E+S+'bld"><Font ss:Bold="1"/>'+E
        +S+'ok"><Interior ss:Color="#E8F5E9" ss:Pattern="Solid"/>'+E
        +S+'er"><Interior ss:Color="#FFEBEE" ss:Pattern="Solid"/>'+E
        +S+'wn"><Interior ss:Color="#FFF9C4" ss:Pattern="Solid"/>'+E
        +STILI_IMPORTO;

    // Foglio 1: ELENCO (dettaglio) — era foglio 2
    var hdrs = dt === 'F24' ? ['N\u00B0','Data','Saldo','Protocollo','Disponibile','Nome File','Stato'] : ['N\u00B0','Data','Importo','Nome File','Stato'];
    var hrow = hdrs.map(function(h){return cella(h,'String','hdr');}).join('');
    var widths = dt === 'F24' ? [40,100,100,180,100,280,110] : [40,100,100,280,110];
    var cols = widths.map(function(w){return '<Column ss:Width="'+w+'"/>';}).join('');
    var drows = rows.map(function(r,i) {
        var l = r.proto ? logMap[r.proto] : (logArr[i]||null);
        var fname = l ? l.filename : '', stato = l ? (l.ok?'Scaricato':'Errore') : 'Non scaricato';
        var sty = l ? (l.ok?'ok':'er') : 'wn';
        var tipoDisp = r.hasQuietanza ? 'Quietanza' : (dt==='F24'?'Copia F24':'Copia F23');
        if (dt === 'F24') return '<Row>'+cella(i+1,'Number',sty)+cella(r.date,'String',sty)+cellaImporto(r.importo,sty)+cella(r.proto,'String',sty)+cella(tipoDisp,'String',sty)+cella(fname,'String',sty)+cella(stato,'String',sty)+'</Row>';
        return '<Row>'+cella(i+1,'Number',sty)+cella(r.date,'String',sty)+cellaImporto(r.importo,sty)+cella(fname,'String',sty)+cella(stato,'String',sty)+'</Row>';
    }).join('');
    var sh1 = '<Worksheet ss:Name="Elenco '+dt+'"><Table>'+cols+'<Row>'+hrow+'</Row>'+drows+'</Table></Worksheet>';

    // Foglio 2: RIEPILOGO — era foglio 1
    var sh2 = '<Worksheet ss:Name="Riepilogo '+dt+'"><Table><Column ss:Width="220"/><Column ss:Width="180"/>'
        +'<Row>'+cella('Cassetto_Utility v'+VERSION+' \u2014 Report '+dt,'String','ttl')+'</Row>'
        +'<Row>'+cella('Identificativo (PIVA/CF):')+cella(cod)+'</Row>'
        +'<Row>'+cella('Modalit\u00e0:')+cella(tipoCod)+'</Row>'
        +'<Row>'+cella('Anno selezionato:')+cella(anno)+'</Row>'
        +'<Row>'+cella('Tipo modello:')+cella(dt)+'</Row>'
        +'<Row>'+cella('Data report:')+cella(nowStr)+'</Row><Row/>'
        +'<Row>'+cella('Versamenti sul sito:','String','bld')+cella(rows.length,'Number')+'</Row>';
    if (dt === 'F24') sh2 += '<Row>'+cella('  con Quietanza:','String','bld')+cella(totQ,'Number')+'</Row><Row>'+cella('  solo Copia F24:','String','bld')+cella(totC,'Number')+'</Row>';
    sh2 += '<Row/><Row>'+cella('Scaricati:','String','bld')+cella(totOK,'Number','ok')+'</Row>'
        +'<Row>'+cella('Errori:','String','bld')+cella(totERR,'Number','er')+'</Row>'
        +'<Row>'+cella('Non scaricati:','String','bld')+cella(totNS,'Number','wn')+'</Row></Table></Worksheet>';

    return '<?xml version="1.0" encoding="UTF-8"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Styles>'+styles+'</Styles>'+sh1+sh2+'</Workbook>';
}

/* XLS per risultati ricerca F24 — con colonna Codice Atto e filtro opzionale */
function buildXLSSel(rows, log, filtroAtto) {
    var idInfo = getIdentifier(), cod = idInfo.code;
    var tipoCod = isDelegato() ? 'Cassetto Delegato' : (idInfo.tipo === 'cf' ? 'Cassetto Proprio (CF)' : 'Cassetto Proprio (PIVA)');
    var now = new Date(), nowStr = now.toLocaleDateString('it-IT')+' '+now.toLocaleTimeString('it-IT');
    var totOK = log.filter(function(l){return l.ok;}).length;
    var totERR = log.filter(function(l){return !l.ok;}).length;
    var totNS = rows.length - log.length;
    var S = '<Style ss:ID="', E = '</Style>';
    var styles = S+'hdr"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#1a3a2a" ss:Pattern="Solid"/>'+E
        +S+'ttl"><Font ss:Bold="1" ss:Size="14"/>'+E+S+'bld"><Font ss:Bold="1"/>'+E
        +S+'ok"><Interior ss:Color="#E8F5E9" ss:Pattern="Solid"/>'+E
        +S+'er"><Interior ss:Color="#FFEBEE" ss:Pattern="Solid"/>'+E
        +S+'wn"><Interior ss:Color="#FFF9C4" ss:Pattern="Solid"/>'+E
        +STILI_IMPORTO;

    var hdrs = ['N\u00B0','Data','Tributo','Descrizione','Anno Rif.','Importo Debito','Importo Credito','Codice Atto','Nome File','Stato'];
    var hrow = hdrs.map(function(h){return cella(h,'String','hdr');}).join('');
    var widths = [40,100,60,250,80,120,120,120,280,110];
    var cols = widths.map(function(w){return '<Column ss:Width="'+w+'"/>';}).join('');
    var logMap = {}; log.forEach(function(l,idx){logMap[idx]=l;});
    var drows = rows.map(function(r,i) {
        var l = logMap[i]||null;
        var fname = l?l.filename:'', stato = l?(l.ok?'Scaricato':'Errore'):'Non scaricato';
        var sty = l?(l.ok?'ok':'er'):'wn';
        return '<Row>'+cella(i+1,'Number',sty)+cella(r.date,'String',sty)+cella(r.tributo||'','String',sty)+cella(r.descrizione||'','String',sty)+cella(r.annoRif||'','String',sty)+cellaImporto(r.importo,sty)+cellaImporto(r.credito||'',sty)+cella(r.codiceAtto||'','String',sty)+cella(fname,'String',sty)+cella(stato,'String',sty)+'</Row>';
    }).join('');
    var sh1 = '<Worksheet ss:Name="Elenco F24 Ricerca"><Table>'+cols+'<Row>'+hrow+'</Row>'+drows+'</Table></Worksheet>';
    var sh2 = '<Worksheet ss:Name="Riepilogo"><Table><Column ss:Width="220"/><Column ss:Width="180"/>'
        +'<Row>'+cella('Cassetto_Utility v'+VERSION+' \u2014 Report F24 Ricerca','String','ttl')+'</Row>'
        +'<Row>'+cella('Identificativo:')+cella(cod)+'</Row>'
        +'<Row>'+cella('Modalit\u00e0:')+cella(tipoCod)+'</Row>'
        +'<Row>'+cella('Data report:')+cella(nowStr)+'</Row>';
    if (filtroAtto) sh2 += '<Row>'+cella('Filtro Codice Atto:')+cella(filtroAtto)+'</Row>';
    sh2 += '<Row/>'
        +'<Row>'+cella('Tributi trovati:','String','bld')+cella(rows.length,'Number')+'</Row><Row/>'
        +'<Row>'+cella('Scaricati:','String','bld')+cella(totOK,'Number','ok')+'</Row>'
        +'<Row>'+cella('Errori:','String','bld')+cella(totERR,'Number','er')+'</Row>'
        +'<Row>'+cella('Non scaricati:','String','bld')+cella(totNS,'Number','wn')+'</Row></Table></Worksheet>';
    return '<?xml version="1.0" encoding="UTF-8"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Styles>'+styles+'</Styles>'+sh1+sh2+'</Workbook>';
}

/* XLS "Dettaglio Tributi F24" — una riga per ogni codice tributo/causale, con sezione,
   descrizione, codice atto e importi a credito/debito separati. */
function buildXLSTributi(tribRows, nF24, errLetture) {
    var idInfo = getIdentifier(), cod = idInfo.code;
    var tipoCod = isDelegato() ? 'Cassetto Delegato' : (idInfo.tipo === 'cf' ? 'Cassetto Proprio (CF)' : 'Cassetto Proprio (PIVA)');
    var anno = getParam('Anno') || '', now = new Date();
    var nowStr = now.toLocaleDateString('it-IT')+' '+now.toLocaleTimeString('it-IT');
    var S = '<Style ss:ID="', E = '</Style>';
    var styles = S+'hdr"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#1a3a2a" ss:Pattern="Solid"/>'+E
        +S+'ttl"><Font ss:Bold="1" ss:Size="14"/>'+E+S+'bld"><Font ss:Bold="1"/>'+E
        +STILI_IMPORTO;

    var hdrs = ['Data versamento','Protocollo','Sezione','Codice tributo','Descrizione','Rateazione, regione/provincia, mese rif.','Anno di riferimento','Codice atto','Importo a credito','Importo a debito'];
    var hrow = hdrs.map(function(h){return cella(h,'String','hdr');}).join('');
    var widths = [110,200,180,90,300,200,110,110,120,120];
    var cols = widths.map(function(w){return '<Column ss:Width="'+w+'"/>';}).join('');
    var drows = tribRows.map(function(r) {
        return '<Row>'+cella(r.data,'String')+cella(r.protocollo,'String')+cella(r.sezione,'String')
            +cella(r.codice,'String')+cella(r.descrizione,'String')+cella(r.rateazione,'String')+cella(r.anno,'String')
            +cella(r.codiceAtto,'String')+cellaImporto(r.credito)+cellaImporto(r.debito)+'</Row>';
    }).join('');
    var sh1 = '<Worksheet ss:Name="Dettaglio Tributi"><Table>'+cols+'<Row>'+hrow+'</Row>'+drows+'</Table></Worksheet>';

    var sh2 = '<Worksheet ss:Name="Riepilogo"><Table><Column ss:Width="220"/><Column ss:Width="180"/>'
        +'<Row>'+cella('Cassetto_Utility v'+VERSION+' — Dettaglio Tributi F24','String','ttl')+'</Row>'
        +'<Row>'+cella('Identificativo (PIVA/CF):')+cella(cod)+'</Row>'
        +'<Row>'+cella('Modalità:')+cella(tipoCod)+'</Row>'
        +'<Row>'+cella('Anno selezionato:')+cella(anno)+'</Row>'
        +'<Row>'+cella('Data report:')+cella(nowStr)+'</Row><Row/>'
        +'<Row>'+cella('F24 letti:','String','bld')+cella(nF24,'Number')+'</Row>'
        +'<Row>'+cella('Righi tributo totali:','String','bld')+cella(tribRows.length,'Number')+'</Row>'
        +'<Row>'+cella('F24 non letti (errore):','String','bld')+cella(errLetture,'Number')+'</Row>'
        +'</Table></Worksheet>';

    return '<?xml version="1.0" encoding="UTF-8"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Styles>'+styles+'</Styles>'+sh1+sh2+'</Workbook>';
}

function dlXLS(content, fname) {
    var blob = new Blob([content],{type:'application/vnd.ms-excel;charset=UTF-8'});
    saveBlob(blob, fname);
}

/* ═══════════════════════════════════════════════════════════════
   SELETTORE DEL PERIODO — Ricerche tributi F24 (#tabf-1)

   Va controcorrente rispetto al resto: e' chiaro. Non sta sopra la pagina
   come la barra, ma dentro il pannello di ricerca del portale, che e' bianco,
   e un blocco scuro la' in mezzo si legge come un errore di impaginazione.

   Ha una palette propria in COL_CHIARO, con l'accento scurito: la tinta piena
   della barra, su fondo bianco, come testo non reggerebbe il contrasto. Il
   pulsante Applica invece tiene l'accento pieno come fondo, con l'inchiostro
   sopra, che e' la coppia giusta nel verso opposto.

   Gli stili stanno in riga e con 'important' perche' qui si e' dentro il CSS
   di Bootstrap del portale, e le regole del nostro foglio userebbero i colori
   della barra: sarebbero scure sul bianco.
   ═══════════════════════════════════════════════════════════════ */

var CU_DS_PERIODI = [
    ['', 'Scegli un periodo'],
    ['T1', 'I trimestre (gen-mar)'], ['T2', 'II trimestre (apr-giu)'],
    ['T3', 'III trimestre (lug-set)'], ['T4', 'IV trimestre (ott-dic)'],
    ['M1', 'Gennaio'], ['M2', 'Febbraio'], ['M3', 'Marzo'],
    ['M4', 'Aprile'], ['M5', 'Maggio'], ['M6', 'Giugno'],
    ['M7', 'Luglio'], ['M8', 'Agosto'], ['M9', 'Settembre'],
    ['M10', 'Ottobre'], ['M11', 'Novembre'], ['M12', 'Dicembre'],
    ['anno', 'Anno intero']
];

/**
 * Il pulsante Periodo: se il selettore c'è lo toglie, se non c'è lo mette.
 * È l'unica porta che parla all'utente, quindi è l'unica che scrive nella
 * riga di stato.
 */
function commutaDateSelector() {
    var esistente = document.getElementById('CU_DateSel');
    if (esistente) {
        esistente.remove();
        showSt('Selettore del periodo rimosso.', 100);
        setTimeout(hideSt, 2000);
        return;
    }
    var esito = disegnaDateSelector();
    if (esito === true) {
        showSt('Selettore del periodo attivo nel tab "Ricerca per data versamento".', 100);
        setTimeout(hideSt, 3000);
    } else if (esito) {
        showSt(esito, 0, 'avviso');
    }
}

/**
 * Disegna il selettore, in silenzio e senza toccare la riga di stato.
 *
 * Separata dalla commutazione perché la chiama anche il cambio di tema, che
 * deve ridisegnare e basta: gli stili del selettore stanno in riga e vanno
 * rifatti, ma un cambio di colori non è una cosa da annunciare, e soprattutto
 * non deve poter cancellare l'avanzamento di uno scarico in corso.
 *
 * È idempotente: se il selettore c'è già lo rifà conservando quello che
 * l'utente aveva scelto.
 *
 * Restituisce `true` se ha disegnato, altrimenti il motivo per cui non ha
 * potuto: sta al chiamante decidere se dirlo.
 */
function disegnaDateSelector() {
    var tabf1 = document.getElementById('tabf-1');
    if (!tabf1) return 'Tab "Ricerca per data versamento" non trovato.';
    var dalInput = document.getElementById('dataDal_1');
    var alInput  = document.getElementById('dataAl_1');
    if (!dalInput || !alInput) return 'Campi data non trovati.';

    // Quello che l'utente aveva scelto non si perde a ogni ridisegno
    var precedente = document.getElementById('CU_DateSel');
    var annoScelto = '', periodoScelto = '';
    if (precedente) {
        var vecchioAnno = precedente.querySelector('#CU_DS_Anno');
        var vecchioPeriodo = precedente.querySelector('#CU_DS_Period');
        if (vecchioAnno) annoScelto = vecchioAnno.value;
        if (vecchioPeriodo) periodoScelto = vecchioPeriodo.value;
        precedente.remove();
    }

    var oggi = new Date();
    var annoCorrente = oggi.getFullYear();

    var sel = document.createElement('div');
    sel.id = 'CU_DateSel';
    sel.style.cssText =
        'margin:10px 0!important;padding:9px 12px!important;' +
        'background:' + COL_CHIARO.fondo + '!important;' +
        'border:1px solid ' + COL_CHIARO.bordo + '!important;' +
        'border-left:3px solid ' + COL_CHIARO.accento + '!important;' +
        'border-radius:2px!important;' +
        'font-family:' + FONT_UI + '!important;font-size:12px!important;' +
        'color:' + COL_CHIARO.testo + '!important;' +
        'display:flex!important;align-items:center!important;' +
        'flex-wrap:wrap!important;gap:8px!important;';

    /*
     * innerHTML riceve solo markup letterale: l'anno e le voci del menu si
     * mettono dopo come proprieta' DOM. Gli elementi si cercano dentro il
     * contenitore e non con getElementById, perche' finche' non e' nel documento
     * getElementById non lo trova e si otterrebbe un'eccezione muta.
     */
    sel.innerHTML =
        '<span id="CU_DS_Marchio"></span>' +
        '<label id="CU_DS_LabelAnno" for="CU_DS_Anno">Anno</label>' +
        '<input type="number" id="CU_DS_Anno" min="2010">' +
        '<select id="CU_DS_Period" aria-label="Periodo"></select>' +
        '<button type="button" class="cuBtn" id="CU_DS_Applica">Applica</button>';

    var marchio = sel.querySelector('#CU_DS_Marchio');
    marchio.textContent = 'PERIODO';
    var campoAnno = sel.querySelector('#CU_DS_Anno');
    campoAnno.max = String(annoCorrente);
    campoAnno.value = annoScelto || String(annoCorrente);
    var campoPeriodo = sel.querySelector('#CU_DS_Period');
    CU_DS_PERIODI.forEach(function(v) {
        var o = document.createElement('option');
        o.value = v[0];
        o.textContent = v[1];
        campoPeriodo.appendChild(o);
    });
    if (periodoScelto) campoPeriodo.value = periodoScelto;
    var bottone = sel.querySelector('#CU_DS_Applica');

    function stile(el, dichiarazioni) {
        Object.keys(dichiarazioni).forEach(function(k) {
            el.style.setProperty(k, dichiarazioni[k], 'important');
        });
    }

    stile(marchio, {
        'font-size': '9px', 'font-weight': '700', 'letter-spacing': '.09em',
        'text-transform': 'uppercase', 'color': COL_CHIARO.accentoTesto,
        'margin-right': '2px'
    });
    stile(sel.querySelector('#CU_DS_LabelAnno'), {
        'font-size': '11px', 'color': COL_CHIARO.testoTenue, 'margin': '0'
    });
    [campoAnno, campoPeriodo].forEach(function(el) {
        stile(el, {
            'font-family': el === campoAnno ? FONT_CIFRE : FONT_UI,
            'font-size': '12px', 'padding': '3px 5px',
            'border': '1px solid ' + COL_CHIARO.bordoCampo,
            'border-radius': '2px', 'background': COL_CHIARO.fondo,
            'color': COL_CHIARO.testo, 'height': 'auto'
        });
    });
    stile(campoAnno, { 'width': '68px' });
    // Il pulsante tiene l'accento pieno: qui il testo ci sta sopra, non accanto
    stile(bottone, {
        'background': COL_CHIARO.accento, 'color': '#FFFFFF',
        'border-color': COL_CHIARO.accento
    });

    // Inserisci dopo il primo fieldset (quello delle date) dentro il tab
    var legend = tabf1.querySelector('legend');
    var fieldset = legend ? legend.closest('fieldset') : null;
    if (fieldset) fieldset.parentNode.insertBefore(sel, fieldset.nextSibling);
    else tabf1.appendChild(sel);

    bottone.addEventListener('click', function() {
        var anno = parseInt(campoAnno.value, 10);
        var period = campoPeriodo.value;
        if (!period || !anno) return;
        function ultimoG(m) { return pad2(new Date(anno, m, 0).getDate())+'/'+pad2(m)+'/'+anno; }
        function capOggi(s) { var pp=s.split('/'); var d=new Date(+pp[2],+pp[1]-1,+pp[0]); if(d>oggi) return pad2(oggi.getDate())+'/'+pad2(oggi.getMonth()+1)+'/'+oggi.getFullYear(); return s; }
        var dalV, alV;
        if (period === 'anno') { dalV = '01/01/'+anno; alV = '31/12/'+anno; }
        else if (period.charAt(0) === 'T') { var t=parseInt(period.charAt(1), 10); var mm=[[1,3],[4,6],[7,9],[10,12]][t-1]; dalV='01/'+pad2(mm[0])+'/'+anno; alV=ultimoG(mm[1]); }
        else { var m=parseInt(period.substring(1), 10); dalV='01/'+pad2(m)+'/'+anno; alV=ultimoG(m); }
        alV = capOggi(alV);
        dalInput.value = dalV; dalInput.dispatchEvent(new Event('change', {bubbles:true}));
        alInput.value = alV; alInput.dispatchEvent(new Event('change', {bubbles:true}));
        showSt('Periodo impostato: '+dalV+' \u2014 '+alV, 100, 'riuscito'); setTimeout(hideSt, 3000);
    });

    return true;
}

/* ═══════════════════════════════════════════════════════════════
   AZIONI

   Un nome di azione, un effetto. I pulsanti della barra lo prendono dal
   proprio `data-action`, il menu dell'estensione lo manda per messaggio: in
   entrambi i casi si finisce qui, e cosa lo strumento sa fare resta scritto
   in un posto solo.
   ═══════════════════════════════════════════════════════════════ */

function handleAction(e) { return eseguiAzioneProtetta(e.currentTarget.dataset.action); }

async function eseguiAzione(action) {
    // Navigazione
    if (action === 'goToVers') { location.href = SERVLET+'?Ric=VERS'; return; }
    if (action === 'goToCU')  { location.href = SERVLET+'?Ric=CUK'; return; }
    if (action === 'goToF24') { var l24 = document.querySelector('a[href*="Ric=F24"]'); if (l24) l24.click(); else location.href = SERVLET+'?Ric=F24'; return; }
    if (action === 'goToF23') { var l23 = document.querySelector('a[href*="Ric=F23"]'); if (l23) l23.click(); else location.href = SERVLET+'?Ric=F23'; return; }

    // Selettore date per ricerca F24
    if (action === 'dateSelector') { commutaDateSelector(); return; }

    // F24 Protocolli
    if (action === 'copyProto') {
        var rows = collectF24();
        /*
         * La Clipboard API rifiuta quando il documento non ha il fuoco o il
         * permesso e' negato. Senza il catch l'utente crederebbe di avere i
         * protocolli negli appunti senza averli: e' l'unico punto in cui un
         * fallimento potrebbe restare del tutto muto.
         */
        navigator.clipboard.writeText(rows.map(function(r){return r.date+'\t'+r.proto;}).join('\n')).then(function(){
            showSt(rows.length+' protocolli copiati negli appunti.', 100, 'riuscito'); setTimeout(hideSt, 3000);
        }).catch(function() {
            showSt('Copia negli appunti non riuscita: la pagina deve avere il fuoco.', 0, 'errore');
            concludiReport(true);
        });
        return;
    }

    // Riepilogo (F24/F23/CU)
    if (action === 'summary') {
        if (summaryVisible) { hideSt(); summaryVisible = false; return; }
        if (isCUList) {
            var cuItems = collectCU();
            showSt('CU \u2014 totale: '+cuItems.length+(cuDlLog.length ? ' | Scaricate: '+cuDlLog.filter(function(l){return l.ok;}).length : ''), 100);
        } else {
            var rows2 = isF24List ? collectF24() : collectF23();
            var conQ = rows2.filter(function(r){return r.hasQuietanza;}).length;
            var msg = docType+' \u2014 totale: '+rows2.length;
            if (isF24List) msg += ' | Quietanza: '+conQ+' | Solo copia: '+(rows2.length-conQ);
            if (dlLog.length) msg += ' | Scaricati: '+dlLog.filter(function(l){return l.ok;}).length;
            showSt(msg, 100);
        }
        summaryVisible = true; return;
    }

    // Riepilogo ricerca F24
    if (action === 'summarySel') {
        if (summaryVisible) { hideSt(); summaryVisible = false; return; }
        var selRows = collectF24Sel();
        showSt('Ricerca F24 \u2014 tributi: '+selRows.length+(dlLog.length ? ' | Scaricati: '+dlLog.filter(function(l){return l.ok;}).length : ''), 100);
        summaryVisible = true; return;
    }

    // Batch download F24/F23
    if (action === 'downloadAll') { await runBatch(collectF24()); return; }
    if (action === 'downloadAllF23') { await runBatch(collectF23()); return; }

    // Batch download F24 ricerca
    if (action === 'downloadF24Sel') { await runBatchF24Sel(collectF24Sel()); return; }

    // Report Excel F24/F23
    if (action === 'reportExcel') {
        summaryVisible = false;
        var rows3 = isF24List ? collectF24() : collectF23();
        if (!rows3.length) { showSt('Nessun versamento trovato.', 0, 'avviso'); concludiReport(true); return; }
        var cod = getIdentifier().code, anno = getParam('Anno') || 'ANNO';
        dlXLS(buildXLS(rows3, dlLog), safe(cod)+'_'+safe(anno)+'_Report'+docType+'_CassettoUtility.xls');
        showSt('Report Excel generato.', 100, 'riuscito'); concludiReport(false); return;
    }

    // Report Excel "Dettaglio Tributi F24" \u2014 legge il dettaglio di ogni F24 e ribalta i righi tributo
    if (action === 'reportTributiF24') {
        summaryVisible = false;
        var rowsT = collectF24();
        if (!rowsT.length) { showSt('Nessun F24 trovato.', 0, 'avviso'); concludiReport(true); return; }
        setDis(true);
        var trib = [], errLetture = 0;
        for (var it = 0; it < rowsT.length; it++) {
            showSt('Dettaglio F24 ('+(it+1)+'/'+rowsT.length+')\u2026', Math.round(it/rowsT.length*100));
            var det = await fetchF24Tributi(rowsT[it].detHref);
            if (!det.righi.length) errLetture++;
            det.righi.forEach(function(r) {
                trib.push({
                    data: rowsT[it].date, protocollo: rowsT[it].proto,
                    sezione: r.sezione, codice: r.codice, descrizione: r.descrizione,
                    rateazione: r.rateazione, anno: r.anno,
                    codiceAtto: det.codiceAtto, credito: r.credito, debito: r.debito
                });
            });
            await sleep(600);
        }
        var codT = getIdentifier().code, annoT = getParam('Anno') || 'ANNO';
        dlXLS(buildXLSTributi(trib, rowsT.length, errLetture), safe(codT)+'_'+safe(annoT)+'_DettaglioTributiF24_CassettoUtility.xls');
        showSt('Dettaglio tributi generato: '+trib.length+' righi da '+rowsT.length+' F24'+(errLetture?', '+errLetture+' non letti':'')+'.', 100, errLetture?'avviso':'riuscito');
        setDis(false); concludiReport(errLetture > 0); return;
    }

    // Report Excel ricerca F24 — con fetch codice atto per ogni riga
    if (action === 'reportExcelSel') {
        summaryVisible = false;
        var selR = collectF24Sel();
        if (!selR.length) { showSt('Nessun tributo trovato.', 0, 'avviso'); concludiReport(true); return; }
        setDis(true);
        // Fetch codice atto per ogni riga
        for (var ra = 0; ra < selR.length; ra++) {
            showSt('Codice atto ('+(ra+1)+'/'+selR.length+')\u2026', Math.round(ra/selR.length*100));
            selR[ra].codiceAtto = await fetchCodiceAtto(selR[ra].detHref);
            await sleep(300);
        }
        // Applica filtro codice atto se presente
        var filtroAttoXls = '';
        var attoInputXls = document.getElementById('CU_AttoInput');
        if (attoInputXls) filtroAttoXls = attoInputXls.value.trim();
        dlXLS(buildXLSSel(selR, dlLog, filtroAttoXls), safe(getIdentifier().code)+'_RicercaF24_CassettoUtility.xls');
        showSt('Report Excel della ricerca F24 generato.', 100, 'riuscito'); setDis(false); concludiReport(false); return;
    }

    // Batch download CU
    if (action === 'downloadAllCU') { await runBatchCU(collectCU()); return; }

    // Report Excel CU
    if (action === 'reportExcelCU') { await reportExcelCU(); return; }

    // Dettaglio F24/F23 (anche da ricerca: DetF24Sel)
    if (action === 'downloadDetailPDF' || action === 'downloadQuietanza') {
        var curUrl = location.href, anno2 = getParam('Anno', curUrl), idx = getParam('indice', curUrl);
        var h3 = document.querySelector('#print h3, h3'), dStr = '';
        if (h3) { var dm = h3.textContent.match(/(\d{1,2}\/\d{1,2}\/\d{4})/); if (dm) dStr = dm[1]; }
        var isQ = (action === 'downloadQuietanza');
        var tipo = isQ ? 'QuietanzaF24' : ((isF24Detail || isF24SearchDetail) ? 'CopiaF24' : 'CopiaF23');
        var pdfU;
        if (isF24SearchDetail) {
            // Per DetF24Sel: usa URL pulita con solo i parametri essenziali
            // (il link "Formato stampabile" sulla pagina usa esattamente questo formato)
            pdfU = SERVLET + '?Ric=DetF24Sel&Anno=' + encodeURIComponent(anno2) + '&indice=' + encodeURIComponent(idx) + '&stampa=P';
        } else {
            pdfU = curUrl.replace(/[?&]stampa=[^&]*/g,'').replace(/[?&]+$/,'') + '&stampa=' + (isQ?'Q':'P');
        }
        var fn = buildFilename(tipo, anno2, dStr, idx);
        showSt(tipo+'\u2026', 50); setDis(true);
        var ok = await dlPdf(pdfU, fn);
        if (!ok && isQ) {
            showSt('Riprovo il download\u2026', 70, 'avviso');
            await sleep(500);
            ok = await dlPdf(pdfU, fn);
        }
        showSt(ok ? fn+' scaricato.' : 'Download non riuscito.', 100, ok?'riuscito':'errore');
        setDis(false); concludiReport(!ok); return;
    }

    // Dettaglio CU — Genera PDF
    if (action === 'downloadCUPdf') {
        var curUrl2 = location.href;
        var annoCU = getParam('Anno', curUrl2), protCU = getParam('Protocollo', curUrl2);
        var h2 = document.querySelector('#tab-3 h2, #tab-2 h2');
        var dStr2 = '';
        if (h2) { var dm2 = h2.textContent.match(/del\s+(\d{1,2}\/\d{1,2}\/\d{4})/); if (dm2) dStr2 = dm2[1]; }
        var d = parseDate(dStr2);
        var fname2 = safe(getIdentifier().code)+'_'+safe(annoCU)+'_'+safe(d.m)+'_'+safe(d.g)+'_CU_'+safe(protCU.slice(-7))+'.pdf';
        showSt('Generazione del PDF CU\u2026', 50); setDis(true);
        var ok2 = await dlCUPdf(annoCU, protCU, fname2);
        showSt(ok2 ? fname2+' generato.' : 'Generazione del PDF non riuscita.', 100, ok2?'riuscito':'errore');
        setDis(false); concludiReport(!ok2); return;
    }
}

/* ═══════════════════════════════════════════════════════════════
   COMANDI DALL'ESTENSIONE

   Il menu del browser e' il punto di comando, non di esecuzione: manda un
   nome e qui si decide cosa significa, cosi' l'elenco di cio' che e'
   eseguibile dall'esterno resta scritto in un posto solo.

   Le azioni contestuali (scarica, report) non stanno nel menu: dipendono da
   quale pagina del cassetto e' aperta, e un popup non lo sa. Nel menu ci sono
   solo i salti e le preferenze; il resto vive nella barra, dove il contesto
   si vede.
   ═══════════════════════════════════════════════════════════════ */

var COMANDI_MENU = ['mostraBarra', 'goToVers', 'goToF24', 'goToF23', 'goToCU'];

function eseguiDaEstensione(msg) {
    if (!msg || msg.canale !== CANALE) return;

    if (msg.tipo === 'commuta') { commutaBarra(); return; }

    if (msg.tipo === 'tema') { applicaTema(msg.valore, false); return; }

    /*
     * Il menu ha cambiato una preferenza e qui se ne teneva una copia. Il
     * valore arriva dentro il messaggio, e non si rilegge lo storage: la
     * scrittura del menu e' asincrona e non attesa, quindi una rilettura
     * potrebbe arrivare prima che sia stata committata e riportare indietro
     * proprio il valore che il messaggio doveva aggiornare. Peggio: una
     * reidratazione sovrascriverebbe le preferenze cambiate qui in pagina e
     * non ancora persistite, facendole sparire senza un errore.
     */
    if (msg.tipo === 'opzioni') {
        var arrivate = msg.valore || {};
        Object.keys(OPZIONI_PREDEFINITE).forEach(function(k) {
            if (arrivate[k] !== undefined) opzioni[k] = arrivate[k];
        });
        // Il menu ha gia' scritto: qui si allinea solo la copia in memoria
        deposito.scriviSenzaPersistere('opzioni', opzioni);
        return;
    }

    if (msg.tipo !== 'comando') return;
    if (COMANDI_MENU.indexOf(msg.comando) === -1) {
        log('Comando sconosciuto dal menu: ' + msg.comando);
        return;
    }

    // Il menu si e' chiuso: quello che succede deve vedersi nella pagina
    mostraBarra();
    if (msg.comando === 'mostraBarra') return;
    eseguiAzioneProtetta(msg.comando);
}

/* ═══════════════════════════════════════════════════════════════
   AVVIO
   ═══════════════════════════════════════════════════════════════ */

var _ultimaUrl = location.href;

function avvia() {
    /*
     * Il deposito viene interrogato per primo perche' decide due cose: quali
     * colori usare e se la barra debba comparire da sola. Come estensione
     * parte nascosta e la apre l'icona del browser, quindi disegnarla prima di
     * saperlo la farebbe lampeggiare.
     */
    deposito.avvia().then(function() {
        caricaOpzioni();
        applicaTema(deposito.leggi('tema', TEMA_PREDEFINITO), false);
        creaPanel();
        rebuildButtons();

        if (!comeEstensione() || opzioni.apertura === 'barra') mostraBarra();

        /*
         * Il cassetto e' un sito a pagine vere: quasi ogni comando ricarica, e
         * a ogni ricaricamento lo script riparte da capo. Restano pero' i
         * cambi di URL che non ricaricano - i passaggi fra i tab della ricerca
         * F24, che spostano la query - e quelli sono l'unica cosa che questo
         * controllo intercetta: confronta `location.href` e nient'altro. I
         * risultati che arrivano via POST sulla stessa URL non passano di qui,
         * ma non serve, perche' anche quella e' una navigazione.
         */
        setInterval(function() {
            var c = location.href;
            if (c !== _ultimaUrl) { _ultimaUrl = c; rebuildButtons(); }
        }, 500);

        log('v' + VERSION + ' avviato - ' + new Date().toLocaleString());
    });

    // Se la finestra si chiude mentre una preferenza attende di essere scritta
    window.addEventListener('beforeunload', function() { deposito.scaricaOra(); });

    /*
     * Solo come estensione: il content script sta nel mondo isolato, quindi
     * riceve direttamente i messaggi del service worker e del menu.
     */
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
        chrome.runtime.onMessage.addListener(function(msg, mittente) {
            /*
             * Senza `externally_connectable` solo il nostro service worker e il
             * nostro menu possono arrivare fin qui, e `msg.canale` fa gia' da
             * secondo filtro. Il controllo sull'id e' difesa in profondita' e
             * costa una riga.
             */
            if (mittente && mittente.id && mittente.id !== chrome.runtime.id) return;
            eseguiDaEstensione(msg);
            // Nessun sendResponse: non si restituisce niente e non si tiene aperto il canale
        });
    }
}

avvia();

})();
