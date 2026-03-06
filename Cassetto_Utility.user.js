// ==UserScript==
// @name           Cassetto_Utility
// @namespace      https://denvermotel.github.io/Cassetto_Utility/
// @downloadURL    https://raw.githubusercontent.com/denvermotel/Cassetto_Utility/refs/heads/main/Cassetto_Utility.user.js
// @updateURL      https://raw.githubusercontent.com/denvermotel/Cassetto_Utility/refs/heads/main/Cassetto_Utility.user.js
// @version        0.06-beta
// @description    Toolbox per cassetto.agenziaentrate.gov.it: download massivo F24/F23/CU, Report Excel, supporto cassetto proprio e delegato
// @author         denvermotel
// @match          https://cassetto.agenziaentrate.gov.it/*
// @icon           https://www.agenziaentrate.gov.it/portale/documents/20152/0/favicon/249a8c43-e3c2-26e4-3bfb-90d79bff7332
// @grant          GM_setValue
// @grant          GM_getValue
// @grant          GM_info
// @grant          unsafeWindow
// @run-at         document-idle
// @noframes
// @license        GPL-3.0-or-later
// @homepageURL    https://denvermotel.github.io/Cassetto_Utility/
// @supportURL     https://github.com/denvermotel/Cassetto_Utility/issues
// ==/UserScript==

/**
 * Cassetto_Utility - v0.06 beta
 * Userscript per il portale cassetto.agenziaentrate.gov.it
 *
 * Changelog 0.06b (aggiornamento):
 *   - CHG: Excel F24/F23/CU: foglio 1 = Elenco (dettaglio), foglio 2 = Riepilogo
 *   - NEW: Excel CU — colonna "Denominazione Sostituto" da quadro DA (DA001 002 + 003)
 *   - NEW: Pagine generiche — link "Vai a CU" + "Vai a Versamenti"
 *   - NEW: Download CU > 15 — alert conferma prima dell'avvio
 *   - NEW: Ricerche tributi F24 (Ric=F24Sel) — download, report, selettore date
 *   - FIX: F24Sel dettaglio — solo Copia F24, niente quietanza
 *   - FIX: Download invisibile puro fetch+blob (niente tab aperte)
 *   - FIX: URL stampa F24 ricerca — costruita dai parametri essenziali
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
var VERSION = '0.06\u03B2';
var PANEL_ID = 'CU_Panel';
var INSTRUCTIONS_URL = 'https://denvermotel.github.io/Cassetto_Utility/';
var BASE_URL = window.location.origin;
var SERVLET = BASE_URL + '/cassfisc-web/CassettoFiscaleServlet';

/* ─── STORAGE ────────────────────────────────────────────────── */
var STORAGE_PREFIX = 'CU_';
var _useGM = (typeof GM_setValue === 'function' && typeof GM_getValue === 'function');

function storageGet(key, def) {
    try {
        if (_useGM) { var v = GM_getValue(STORAGE_PREFIX + key); return (v !== undefined && v !== null) ? v : def; }
        var v2 = localStorage.getItem(STORAGE_PREFIX + key);
        return v2 !== null ? JSON.parse(v2) : def;
    } catch(e) { return def; }
}

function storageSet(key, val) {
    try {
        if (_useGM) { GM_setValue(STORAGE_PREFIX + key, val); return; }
        localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(val));
    } catch(e) {}
}

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

/* ─── IDENTIFIER EXTRACTION ──────────────────────────────────── */
function getIdentifier() {
    var delegaEl = document.querySelector('div.section.border.border-primary.my-1.bg-light.px-3');
    if (delegaEl) { var m = delegaEl.textContent.match(/\b(\d{11})\b/); if (m) return {code:m[1], tipo:'delegato'}; }
    var ps = document.querySelectorAll('#user-info-data-container p.mb-2, #user-info p.mb-2');
    for (var i = 0; i < ps.length; i++) {
        var t = ps[i].textContent.trim();
        var mP = t.match(/\b(\d{11})\b/); if (mP) return {code:mP[1], tipo:'piva'};
        var mC = t.match(/\b([A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z])\b/); if (mC) return {code:mC[1], tipo:'cf'};
    }
    var ui = document.getElementById('user-info');
    if (ui) { var mf = ui.textContent.match(/\b(\d{11})\b/); if (mf) return {code:mf[1], tipo:'piva'}; }
    return {code:'CODICE', tipo:'sconosciuto'};
}

function isDelegato() {
    return !!document.querySelector('div.section.border.border-primary.my-1.bg-light.px-3');
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
function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function pad2(n) { return String(n).padStart(2,'0'); }

function buildFilename(tipo, anno, dateStr, idx) {
    var cod = getIdentifier().code;
    var d = parseDate(dateStr);
    var yr = (d.a !== 'AAAA') ? d.a : anno;
    return safe(cod)+'_'+safe(yr)+'_'+safe(d.m)+'_'+safe(d.g)+'_'+safe(tipo)+'_idx'+safe(idx)+'.pdf';
}

/* ─── CSS ────────────────────────────────────────────────────── */
var stile = document.createElement('style');
stile.textContent =
'#'+PANEL_ID+'{all:initial!important;display:block!important;position:fixed!important;top:0!important;left:0!important;width:100vw!important;box-sizing:border-box!important;z-index:2147483647!important;background:#1b3a2b!important;border-bottom:2px solid #2e7d32!important;box-shadow:0 3px 12px rgba(0,0,0,.6)!important;font-family:Arial,Helvetica,sans-serif!important;font-size:12px!important;color:#e8f5e9!important;}'+
'#CU_TopRow{all:initial!important;display:flex!important;flex-direction:row!important;flex-wrap:nowrap!important;align-items:center!important;gap:5px!important;padding:5px 20px 5px 10px!important;width:100%!important;box-sizing:border-box!important;overflow-x:auto!important;}'+
'#CU_Logo{all:initial!important;font-family:Arial,sans-serif!important;font-size:13px!important;font-weight:bold!important;color:#a5d6a7!important;white-space:nowrap!important;flex-shrink:0!important;margin-right:4px!important;}'+
'#CU_BottomRow{all:initial!important;display:none!important;width:100%!important;box-sizing:border-box!important;padding:2px 10px 5px!important;}'+
'#CU_PBar{all:initial!important;display:inline-block!important;width:180px!important;height:8px!important;background:#263238!important;border-radius:4px!important;overflow:hidden!important;vertical-align:middle!important;margin-right:8px!important;}'+
'#CU_PFill{all:initial!important;display:block!important;height:100%!important;background:#43a047!important;width:0%!important;transition:width .4s!important;}'+
'#CU_Status{all:initial!important;display:inline!important;font-family:Arial,sans-serif!important;font-size:11px!important;color:#80cbc4!important;vertical-align:middle!important;}'+
'.cuBtn{all:initial!important;display:inline-block!important;padding:5px 10px!important;border:none!important;border-radius:4px!important;cursor:pointer!important;font-size:11px!important;font-weight:bold!important;white-space:nowrap!important;flex-shrink:0!important;font-family:Arial,sans-serif!important;line-height:1.4!important;transition:filter .15s!important;}'+
'.cuBtn:hover{filter:brightness(1.2)!important;}.cuBtn:disabled{opacity:.4!important;cursor:not-allowed!important;}'+
'.cu-green{background:#2e7d32!important;color:#fff!important;}.cu-blue{background:#1565c0!important;color:#fff!important;}.cu-teal{background:#00695c!important;color:#fff!important;}.cu-orange{background:#e65100!important;color:#fff!important;}.cu-purple{background:#6a1b9a!important;color:#fff!important;}.cu-grey{background:#37474f!important;color:#fff!important;}.cu-red{background:#b71c1c!important;color:#fff!important;}'+
'.cu-badge{all:initial!important;display:inline-block!important;font-family:Arial,sans-serif!important;font-size:11px!important;color:#80cbc4!important;padding:2px 7px!important;border:1px solid #2e7d32!important;border-radius:3px!important;white-space:nowrap!important;flex-shrink:0!important;}'+
'.cu-dtag{all:initial!important;display:inline-block!important;font-family:Arial,sans-serif!important;font-size:11px!important;background:#2e7d32!important;color:#fff!important;padding:2px 7px!important;border-radius:3px!important;border:1px solid #2e7d32!important;white-space:nowrap!important;flex-shrink:0!important;}'+
'#CU_InfoLink{all:initial!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;width:26px!important;height:26px!important;font-size:14px!important;text-decoration:none!important;cursor:pointer!important;border-radius:4px!important;background:rgba(255,255,255,0.1)!important;flex-shrink:0!important;transition:background .15s!important;margin-left:4px!important;}'+
'#CU_InfoLink:hover{background:rgba(255,255,255,0.25)!important;}'+
'#CU_DateSel{background:#e8f5e9!important;border:1px solid #2e7d32!important;border-radius:6px!important;padding:10px!important;margin-top:8px!important;font-family:Arial,sans-serif!important;font-size:12px!important;color:#1b3a2b!important;}'+
'#CU_DateSel select,#CU_DateSel input[type=number]{padding:3px 4px!important;border:1px solid #999!important;border-radius:3px!important;font-size:12px!important;}'+
'#CU_DateSel .cu-ds-btn{font-size:11px!important;padding:4px 10px!important;background:#2e7d32!important;color:white!important;border:none!important;border-radius:3px!important;cursor:pointer!important;font-weight:bold!important;}'+
'#CU_DateSel .cu-ds-btn:hover{background:#388e3c!important;}'+
'#CU_AlertOverlay{position:fixed!important;top:0!important;left:0!important;right:0!important;bottom:0!important;background:rgba(0,0,0,.5)!important;z-index:2147483648!important;display:flex!important;align-items:center!important;justify-content:center!important;}'+
'#CU_AlertBox{background:#fff!important;border-radius:10px!important;padding:24px!important;max-width:440px!important;box-shadow:0 8px 32px rgba(0,0,0,.3)!important;font-family:Arial,sans-serif!important;font-size:14px!important;color:#333!important;text-align:center!important;}'+
'#CU_AlertBox h3{margin:0 0 12px!important;font-size:16px!important;color:#e65100!important;}'+
'#CU_AlertBox p{margin:0 0 16px!important;line-height:1.5!important;}'+
'#CU_AlertBox button{padding:8px 20px!important;border:none!important;border-radius:5px!important;font-size:13px!important;font-weight:bold!important;cursor:pointer!important;margin:0 6px!important;}';
document.head.appendChild(stile);

/* ─── BUILD PANEL (shell fissa) ──────────────────────────────── */
var p = document.createElement('div');
p.id = PANEL_ID;
p.innerHTML =
'<div id="CU_TopRow">'+
'<span id="CU_Logo">\uD83E\uDDF3 Cassetto_Utility v'+VERSION+'</span>'+
'<span id="CU_Badge" class="cu-badge"></span>'+
'<span id="CU_DocTag"></span>'+
'<span id="CU_Buttons" style="all:initial!important;display:contents!important;"></span>'+
'<span style="all:initial!important;flex:1 1 auto!important;min-width:10px!important;"></span>'+
'<a id="CU_InfoLink" href="'+INSTRUCTIONS_URL+'" target="_blank" rel="noopener noreferrer" title="Istruzioni">\u2139\uFE0F</a>'+
'<button id="CU_X" style="all:initial;display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;margin-left:4px;background:#b71c1c;border:none;border-radius:4px;color:#fff;font-size:14px;font-weight:bold;cursor:pointer;flex-shrink:0;line-height:1;" title="Chiudi">\u2715</button>'+
'</div>'+
'<div id="CU_BottomRow">'+
'<div id="CU_PBar"><div id="CU_PFill"></div></div>'+
'<span id="CU_Status"></span>'+
'</div>';
document.documentElement.appendChild(p);

/* ─── REBUILD BUTTONS ────────────────────────────────────────── */
function rebuildButtons() {
    detectContext();
    var idInfo = getIdentifier();
    var icon = isDelegato() ? '\uD83D\uDC65' : (idInfo.tipo === 'cf' ? '\uD83D\uDC64' : '\uD83C\uDFE2');
    var badgeEl = document.getElementById('CU_Badge');
    if (badgeEl) { badgeEl.textContent = icon+' '+idInfo.code; badgeEl.title = isDelegato() ? 'Cassetto delegato' : (idInfo.tipo === 'cf' ? 'Codice Fiscale' : 'Partita IVA'); }

    var docTagEl = document.getElementById('CU_DocTag');
    if (docTagEl) {
        if (isListPage || isDetailPage || isF24Search || isF24SearchRes) { docTagEl.className = 'cu-dtag'; docTagEl.textContent = docType || 'F24'; }
        else if (isVersPage) { docTagEl.className = 'cu-dtag'; docTagEl.textContent = 'Versamenti'; }
        else { docTagEl.className = ''; docTagEl.textContent = ''; }
    }

    var container = document.getElementById('CU_Buttons');
    if (!container) return;
    var h = '';

    if (isF24List) {
        h = '<button class="cuBtn cu-green" data-action="downloadAll">\uD83E\uDDC3\u2B07 Scarica F24</button>'+
            '<button class="cuBtn cu-blue" data-action="copyProto">\uD83D\uDCCB Protocolli</button>'+
            '<button class="cuBtn cu-purple" data-action="reportExcel">\uD83D\uDCCA Report Excel</button>'+
            '<button class="cuBtn cu-orange" data-action="summary">\uD83D\uDD0D Riepilogo</button>';
    } else if (isF23List) {
        h = '<button class="cuBtn cu-green" data-action="downloadAllF23">\uD83E\uDDC3\u2B07 Scarica F23</button>'+
            '<button class="cuBtn cu-purple" data-action="reportExcel">\uD83D\uDCCA Report Excel</button>'+
            '<button class="cuBtn cu-orange" data-action="summary">\uD83D\uDD0D Riepilogo</button>';
    } else if (isCUList) {
        h = '<button class="cuBtn cu-green" data-action="downloadAllCU">\uD83E\uDDC3\u2B07 Scarica CU</button>'+
            '<button class="cuBtn cu-purple" data-action="reportExcelCU">\uD83D\uDCCA Report Excel CU</button>'+
            '<button class="cuBtn cu-orange" data-action="summary">\uD83D\uDD0D Riepilogo</button>';
    } else if (isF24SearchRes) {
        // Pagina risultati ricerca F24 — download + report + date selector (il form è in pagina)
        h = '<button class="cuBtn cu-green" data-action="downloadF24Sel">\uD83E\uDDC3\u2B07 Scarica F24</button>'+
            '<button class="cuBtn cu-purple" data-action="reportExcelSel">\uD83D\uDCCA Report Excel</button>'+
            '<button class="cuBtn cu-orange" data-action="summarySel">\uD83D\uDD0D Riepilogo</button>';
        if (document.getElementById('tabf-1')) h += '<button class="cuBtn cu-blue" data-action="dateSelector">\uD83D\uDCC5 Selettore Date</button>';
    } else if (isF24Search) {
        // Pagina form ricerca F24 (senza risultati)
        h = '<button class="cuBtn cu-blue" data-action="dateSelector">\uD83D\uDCC5 Selettore Date</button>';
    } else if (isF24Detail) {
        h = '<button class="cuBtn cu-green" data-action="downloadDetailPDF">\uD83E\uDDC3\u2B07 Copia F24 (PDF)</button>'+
            '<button class="cuBtn cu-teal" data-action="downloadQuietanza">\uD83E\uDDF3\u2B07 Quietanza (PDF)</button>';
    } else if (isF23Detail) {
        h = '<button class="cuBtn cu-green" data-action="downloadDetailPDF">\uD83E\uDDC3\u2B07 Copia F23 (PDF)</button>';
    } else if (isCUDetail) {
        h = '<button class="cuBtn cu-green" data-action="downloadCUPdf">\uD83E\uDDC3\u2B07 Genera PDF CU</button>';
    } else if (isF24SearchDetail) {
        // Da Ricerche tributi F24 non è possibile scaricare le quietanze, solo Copia F24
        h = '<button class="cuBtn cu-green" data-action="downloadDetailPDF">\uD83E\uDDC3\u2B07 Copia F24 (PDF)</button>';
    } else if (isVersPage) {
        h = '<button class="cuBtn cu-green" data-action="goToF24">\uD83D\uDCC4 Modello F24</button>'+
            '<button class="cuBtn cu-teal" data-action="goToF23">\uD83D\uDCC4 Modello F23</button>';
    } else {
        // 3) Pagina generica: "Vai a CU" + "Vai a Versamenti"
        h = '<button class="cuBtn cu-teal" data-action="goToCU">\uD83D\uDCC4 Vai a CU</button>'+
            '<button class="cuBtn cu-orange" data-action="goToVers">\u26A0 Vai a Versamenti</button>';
    }
    container.innerHTML = h;
    container.querySelectorAll('.cuBtn').forEach(function(btn) { btn.addEventListener('click', handleAction); });
    hideSt(); summaryVisible = false;
    aggiornaPadding();
}
rebuildButtons();

/* ─── URL MONITOR ────────────────────────────────────────────── */
var _lastUrl = location.href;
setInterval(function() { var c = location.href; if (c !== _lastUrl) { _lastUrl = c; rebuildButtons(); } }, 500);

/* ─── PADDING ────────────────────────────────────────────────── */
var _padTimer;
function aggiornaPadding() { document.body.style.setProperty('padding-top', (p.offsetHeight||40)+'px', 'important'); }
aggiornaPadding();
_padTimer = setInterval(aggiornaPadding, 600);

/* ─── CLOSE / REOPEN ─────────────────────────────────────────── */
document.getElementById('CU_X').onclick = function() {
    p.style.setProperty('display','none','important');
    document.body.style.removeProperty('padding-top');
    clearInterval(_padTimer);
    var tab = document.createElement('div');
    tab.id = 'CU_ReopenTab';
    tab.style.cssText = 'all:initial!important;position:fixed!important;top:0!important;right:20px!important;background:#1b3a2b!important;color:#a5d6a7!important;padding:4px 12px!important;border-radius:0 0 6px 6px!important;font-family:Arial,sans-serif!important;font-size:12px!important;cursor:pointer!important;z-index:2147483647!important;box-shadow:0 2px 6px rgba(0,0,0,0.3)!important;font-weight:bold!important;';
    tab.textContent = '\uD83E\uDDF3 Cassetto_Utility';
    tab.title = 'Riapri la barra';
    tab.onclick = function() { tab.remove(); p.style.setProperty('display','block','important'); aggiornaPadding(); _padTimer = setInterval(aggiornaPadding, 600); };
    document.documentElement.appendChild(tab);
};

/* ─── STATUS / PROGRESS ──────────────────────────────────────── */
var summaryVisible = false;
function showSt(msg, pct) {
    var row = document.getElementById('CU_BottomRow'), fill = document.getElementById('CU_PFill'), st = document.getElementById('CU_Status');
    if (row) row.style.setProperty('display','block','important');
    if (st) st.textContent = msg;
    if (fill && pct !== undefined) fill.style.setProperty('width', Math.min(100,pct)+'%', 'important');
    aggiornaPadding();
}
function hideSt() { var row = document.getElementById('CU_BottomRow'); if (row) row.style.setProperty('display','none','important'); aggiornaPadding(); }
function setDis(val) { document.querySelectorAll('#CU_Buttons .cuBtn').forEach(function(b){b.disabled=val;}); }

/* ─── ALERT DIALOG (promise<boolean>) ────────────────────────── */
function showAlert(title, message, okText, cancelText) {
    return new Promise(function(resolve) {
        var overlay = document.createElement('div'); overlay.id = 'CU_AlertOverlay';
        var box = document.createElement('div'); box.id = 'CU_AlertBox';
        box.innerHTML = '<h3>'+title+'</h3><p>'+message+'</p>';
        var btnOk = document.createElement('button');
        btnOk.textContent = okText || 'OK';
        btnOk.style.cssText = 'background:#2e7d32!important;color:#fff!important;';
        btnOk.onclick = function() { overlay.remove(); resolve(true); };
        var btnCancel = document.createElement('button');
        btnCancel.textContent = cancelText || 'Annulla';
        btnCancel.style.cssText = 'background:#b71c1c!important;color:#fff!important;';
        btnCancel.onclick = function() { overlay.remove(); resolve(false); };
        box.appendChild(btnOk); box.appendChild(btnCancel);
        overlay.appendChild(box); document.body.appendChild(overlay);
    });
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

/* Download PDF via GET — fetch invisibile */
function dlPdf(url, filename) {
    return new Promise(function(resolve) {
        fetch(url, {credentials:'include'}).then(function(r){ return r.blob(); }).then(function(blob) {
            // Verifica che sia effettivamente un PDF (o almeno un file binario)
            if (blob.size < 500) { resolve(false); return; }
            saveBlob(blob, filename);
            resolve(true);
        }).catch(function(err){ console.warn('[CU] dlPdf error:', err); resolve(false); });
    });
}

var dlLog = [];

async function runBatch(rows) {
    if (!rows.length) { showSt('\u26A0\uFE0F Nessun versamento trovato.', 0); return; }
    setDis(true); dlLog = [];
    var ok_n = 0, fail_n = 0;
    for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        var anno = getParam('Anno', row.detHref) || 'XXXX';
        var idx = getParam('indice', row.detHref) || String(i);
        var dlUrl, tipo;
        if (row.docType === 'F24') {
            if (row.hasQuietanza) { dlUrl = row.qHref; tipo = 'QuietanzaF24'; }
            else { dlUrl = row.detHref+'&stampa=P'; tipo = 'CopiaF24'; }
        } else { dlUrl = row.detHref+'&stampa=P'; tipo = 'CopiaF23'; }
        var fname = buildFilename(tipo, anno, row.date, idx);
        showSt('\uD83E\uDDF3\u2B07 ('+(i+1)+'/'+rows.length+') '+fname, Math.round(i/rows.length*100));
        var ok = await dlPdf(dlUrl, fname);
        dlLog.push({date:row.date, importo:row.importo, proto:row.proto, docType:row.docType, tipo:tipo, filename:fname, ok:ok});
        if (ok) ok_n++; else fail_n++;
        await sleep(600);
    }
    document.getElementById('CU_PFill').style.setProperty('width','100%','important');
    showSt('\u2705 Completato: '+ok_n+' scaricati'+(fail_n>0?', \u26A0\uFE0F '+fail_n+' errori':'')+' \u2014 usa \uD83D\uDCCA Report Excel per il raffronto.', 100);
    setDis(false);
    storageSet('dlLog_'+getIdentifier().code+'_'+(getParam('Anno')||'ANNO'), dlLog);
}

/* Batch download F24 da ricerca
   NOTA: l'URL per stampa=P deve essere costruito con solo i parametri essenziali
   (Ric=DetF24Sel, Anno, indice, stampa=P) — senza TIPORICERCAF24 e altri parametri
   extra che sono presenti nel link della lista ma NON nel link PDF del dettaglio.
*/
async function runBatchF24Sel(rows) {
    if (!rows.length) { showSt('\u26A0\uFE0F Nessun versamento trovato.', 0); return; }
    setDis(true); dlLog = [];
    var ok_n = 0, fail_n = 0;
    for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        var anno = getParam('Anno', row.detHref) || row.annoRif || 'XXXX';
        var idx = getParam('indice', row.detHref) || String(i);
        // Costruisci l'URL PDF con solo i parametri essenziali
        var dlUrl = SERVLET + '?Ric=DetF24Sel&Anno=' + encodeURIComponent(anno) + '&indice=' + encodeURIComponent(idx) + '&stampa=P';
        var tipo = 'CopiaF24';
        var fname = buildFilename(tipo, anno, row.date, idx);
        showSt('\uD83E\uDDF3\u2B07 ('+(i+1)+'/'+rows.length+') '+fname, Math.round(i/rows.length*100));
        var ok = await dlPdf(dlUrl, fname);
        dlLog.push({date:row.date, importo:row.importo, tributo:row.tributo||'', proto:'', docType:'F24', tipo:tipo, filename:fname, ok:ok});
        if (ok) ok_n++; else fail_n++;
        await sleep(600);
    }
    document.getElementById('CU_PFill').style.setProperty('width','100%','important');
    showSt('\u2705 Completato: '+ok_n+' scaricati'+(fail_n>0?', \u26A0\uFE0F '+fail_n+' errori':'')+' \u2014 usa \uD83D\uDCCA Report Excel.', 100);
    setDis(false);
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
    return new Promise(function(resolve) {
        var body = new URLSearchParams();
        body.append('Ric','CUK'); body.append('Anno',anno);
        body.append('Protocollo',protocollo); body.append('stampa','P');
        body.append('Fascicoli','SI'); body.append('TipoStampa','C');
        fetch(SERVLET, {method:'POST', credentials:'include', body:body, headers:{'Content-Type':'application/x-www-form-urlencoded'}})
        .then(function(r){return r.blob();}).then(function(blob) {
            if (blob.type && blob.type.indexOf('pdf') === -1 && blob.size < 1000) { resolve(false); return; }
            saveBlob(blob, filename);
            resolve(true);
        }).catch(function(err){console.warn('[CU]',err); resolve(false);});
    });
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

/* Fetch importi dal Quadro AU */
function fetchAUData(anno, protocollo) {
    var url = SERVLET+'?Ric=CUK&Anno='+encodeURIComponent(anno)+'&Protocollo='+encodeURIComponent(protocollo)+'&Quadro=AU&Modulo=1';
    return fetch(url, {credentials:'include'}).then(function(r){return r.text();}).then(function(html) {
        var doc = new DOMParser().parseFromString(html, 'text/html');
        var result = {causale:'', ammontareLordo:'', imponibile:'', ritenute:''};
        doc.querySelectorAll('table.table tr').forEach(function(tr) {
            var tds = tr.querySelectorAll('td');
            if (tds.length >= 3) {
                var campo = tds[1] ? tds[1].textContent.trim() : '';
                var valore = tds[2] ? tds[2].textContent.trim() : '';
                if (campo.indexOf('Causale') !== -1) result.causale = valore;
                if (campo.indexOf('Ammontare lordo') !== -1) result.ammontareLordo = valore;
                if (campo.indexOf('Imponibile') !== -1) result.imponibile = valore;
                if (campo.indexOf('Ritenute') !== -1 && campo.indexOf('acconto') !== -1) result.ritenute = valore;
            }
        });
        return result;
    }).catch(function() { return {causale:'', ammontareLordo:'', imponibile:'', ritenute:''}; });
}

/* Batch download CU — 4) alert se > 15 */
var cuDlLog = [];

async function runBatchCU(items) {
    if (!items.length) { showSt('\u26A0\uFE0F Nessuna CU trovata.', 0); return; }
    // 4) Alert se CU > 15
    if (items.length > 15) {
        var conferma = await showAlert(
            '\u26A0\uFE0F Download di ' + items.length + ' CU',
            'Stai per scaricare <b>' + items.length + '</b> certificazioni uniche in formato PDF.<br><br>'+
            'Una volta avviata, la procedura di download <b>non pu\u00F2 essere interrotta</b>.<br><br>'+
            'Vuoi procedere?',
            'Procedi', 'Annulla'
        );
        if (!conferma) { showSt('\u274C Download annullato.', 0); setTimeout(hideSt, 3000); return; }
    }
    setDis(true); cuDlLog = [];
    var ok_n = 0, fail_n = 0;
    for (var i = 0; i < items.length; i++) {
        var cu = items[i];
        var d = parseDate(cu.data);
        var fname = safe(getIdentifier().code)+'_'+safe(cu.anno)+'_'+safe(d.m)+'_'+safe(d.g)+'_CU_'+safe(cu.sostituto)+'_idx'+i+'.pdf';
        showSt('\uD83E\uDDF3\u2B07 ('+(i+1)+'/'+items.length+') '+fname, Math.round(i/items.length*100));
        var ok = await dlCUPdf(cu.anno, cu.protocollo, fname);
        cuDlLog.push({numCert:cu.numCert, data:cu.data, sostituto:cu.sostituto, protocollo:cu.protocollo, filename:fname, ok:ok});
        if (ok) ok_n++; else fail_n++;
        await sleep(800);
    }
    document.getElementById('CU_PFill').style.setProperty('width','100%','important');
    showSt('\u2705 Completato: '+ok_n+' scaricati'+(fail_n>0?', \u26A0\uFE0F '+fail_n+' errori':'')+' \u2014 usa \uD83D\uDCCA Report Excel CU per il riepilogo.', 100);
    setDis(false);
}

/* Report Excel CU — 1) Dettaglio come foglio 1, Riepilogo come foglio 2
                       2) colonna Denominazione Sostituto da quadro DA */
async function reportExcelCU() {
    var items = collectCU();
    if (!items.length) { showSt('\u26A0\uFE0F Nessuna CU trovata.', 0); return; }
    setDis(true);
    var data = [];
    for (var i = 0; i < items.length; i++) {
        var cu = items[i];
        showSt('\uD83D\uDCCA Lettura dati CU ('+(i+1)+'/'+items.length+')\u2026', Math.round(i/items.length*100));
        var au = await fetchAUData(cu.anno, cu.protocollo);
        var denom = await fetchDADenominazione(cu.anno, cu.protocollo);
        var logEntry = cuDlLog.find(function(l){return l.protocollo === cu.protocollo;});
        data.push({
            n: i+1, numCert: cu.numCert, data: cu.data, sostituto: cu.sostituto,
            denominazione: denom,
            causale: au.causale, ammontareLordo: au.ammontareLordo,
            imponibile: au.imponibile, ritenute: au.ritenute,
            filename: logEntry ? logEntry.filename : '', stato: logEntry ? (logEntry.ok ? 'Scaricato' : 'Errore') : 'Non scaricato'
        });
        await sleep(300);
    }
    var cod = getIdentifier().code;
    var anno = getParam('Anno') || (items[0] && items[0].anno) || 'ANNO';
    var tipoCod = isDelegato() ? 'Cassetto Delegato' : (getIdentifier().tipo === 'cf' ? 'Cassetto Proprio (CF)' : 'Cassetto Proprio (PIVA)');
    var now = new Date();
    var nowStr = now.toLocaleDateString('it-IT')+' '+now.toLocaleTimeString('it-IT');
    var totOK = data.filter(function(d){return d.stato === 'Scaricato';}).length;
    var totERR = data.filter(function(d){return d.stato === 'Errore';}).length;
    var totNS = data.filter(function(d){return d.stato === 'Non scaricato';}).length;

    var S = '<Style ss:ID="', E = '</Style>';
    var styles = S+'hdr"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#1a3a2a" ss:Pattern="Solid"/>'+E
        +S+'ttl"><Font ss:Bold="1" ss:Size="14"/>'+E+S+'bld"><Font ss:Bold="1"/>'+E
        +S+'ok"><Interior ss:Color="#E8F5E9" ss:Pattern="Solid"/>'+E
        +S+'er"><Interior ss:Color="#FFEBEE" ss:Pattern="Solid"/>'+E
        +S+'wn"><Interior ss:Color="#FFF9C4" ss:Pattern="Solid"/>'+E;
    function cell(v,t,sty) { return '<Cell'+(sty?' ss:StyleID="'+sty+'"':'')+'><Data ss:Type="'+(t||'String')+'">'+esc(v)+'</Data></Cell>'; }

    // Foglio 1: ELENCO CU (dettaglio) — con Denominazione Sostituto
    var hdrs = ['N\u00B0','N. Certificazione','Data','CF Sostituto','Denominazione Sostituto','Causale','Ammontare Lordo','Imponibile','Ritenute Acconto','Nome File','Stato'];
    var hrow = hdrs.map(function(h){return cell(h,'String','hdr');}).join('');
    var widths = [35,180,80,130,200,60,120,120,120,260,90];
    var cols = widths.map(function(w){return '<Column ss:Width="'+w+'"/>';}).join('');
    var drows = data.map(function(d) {
        var sty = d.stato === 'Scaricato' ? 'ok' : (d.stato === 'Errore' ? 'er' : 'wn');
        return '<Row>'+cell(d.n,'Number',sty)+cell(d.numCert,'String',sty)+cell(d.data,'String',sty)
            +cell(d.sostituto,'String',sty)+cell(d.denominazione,'String',sty)
            +cell(d.causale,'String',sty)+cell(d.ammontareLordo,'String',sty)
            +cell(d.imponibile,'String',sty)+cell(d.ritenute,'String',sty)
            +cell(d.filename,'String',sty)+cell(d.stato,'String',sty)+'</Row>';
    }).join('');
    var sh1 = '<Worksheet ss:Name="Elenco CU"><Table>'+cols+'<Row>'+hrow+'</Row>'+drows+'</Table></Worksheet>';

    // Foglio 2: RIEPILOGO CU
    var sh2 = '<Worksheet ss:Name="Riepilogo CU">'
        +'<Table><Column ss:Width="220"/><Column ss:Width="180"/>'
        +'<Row>'+cell('Cassetto_Utility v'+VERSION+' \u2014 Report CU','String','ttl')+'</Row>'
        +'<Row>'+cell('Identificativo:')+cell(cod)+'</Row>'
        +'<Row>'+cell('Modalit\u00e0:')+cell(tipoCod)+'</Row>'
        +'<Row>'+cell('Anno imposta:')+cell(anno)+'</Row>'
        +'<Row>'+cell('Data report:')+cell(nowStr)+'</Row>'
        +'<Row/>'+
        '<Row>'+cell('CU trovate:','String','bld')+cell(items.length,'Number')+'</Row>'
        +'<Row>'+cell('Scaricate:','String','bld')+cell(totOK,'Number','ok')+'</Row>'
        +'<Row>'+cell('Errori:','String','bld')+cell(totERR,'Number','er')+'</Row>'
        +'<Row>'+cell('Non scaricate:','String','bld')+cell(totNS,'Number','wn')+'</Row>'
        +'</Table></Worksheet>';

    var xls = '<?xml version="1.0" encoding="UTF-8"?><?mso-application progid="Excel.Sheet"?>'
        +'<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">'
        +'<Styles>'+styles+'</Styles>'+sh1+sh2+'</Workbook>';
    dlXLS(xls, safe(cod)+'_'+safe(anno)+'_ReportCU_CassettoUtility.xls');
    showSt('\u2705 Report Excel CU generato.', 100);
    setDis(false); setTimeout(hideSt, 4000);
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
        +S+'wn"><Interior ss:Color="#FFF9C4" ss:Pattern="Solid"/>'+E;
    function cell(v,t,sty) { return '<Cell'+(sty?' ss:StyleID="'+sty+'"':'')+'><Data ss:Type="'+(t||'String')+'">'+esc(v)+'</Data></Cell>'; }

    // Foglio 1: ELENCO (dettaglio) — era foglio 2
    var hdrs = dt === 'F24' ? ['N\u00B0','Data','Saldo','Protocollo','Disponibile','Nome File','Stato'] : ['N\u00B0','Data','Importo','Nome File','Stato'];
    var hrow = hdrs.map(function(h){return cell(h,'String','hdr');}).join('');
    var widths = dt === 'F24' ? [40,100,100,180,100,280,110] : [40,100,100,280,110];
    var cols = widths.map(function(w){return '<Column ss:Width="'+w+'"/>';}).join('');
    var drows = rows.map(function(r,i) {
        var l = r.proto ? logMap[r.proto] : (logArr[i]||null);
        var fname = l ? l.filename : '', stato = l ? (l.ok?'Scaricato':'Errore') : 'Non scaricato';
        var sty = l ? (l.ok?'ok':'er') : 'wn';
        var tipoDisp = r.hasQuietanza ? 'Quietanza' : (dt==='F24'?'Copia F24':'Copia F23');
        if (dt === 'F24') return '<Row>'+cell(i+1,'Number',sty)+cell(r.date,'String',sty)+cell(r.importo,'String',sty)+cell(r.proto,'String',sty)+cell(tipoDisp,'String',sty)+cell(fname,'String',sty)+cell(stato,'String',sty)+'</Row>';
        return '<Row>'+cell(i+1,'Number',sty)+cell(r.date,'String',sty)+cell(r.importo,'String',sty)+cell(fname,'String',sty)+cell(stato,'String',sty)+'</Row>';
    }).join('');
    var sh1 = '<Worksheet ss:Name="Elenco '+dt+'"><Table>'+cols+'<Row>'+hrow+'</Row>'+drows+'</Table></Worksheet>';

    // Foglio 2: RIEPILOGO — era foglio 1
    var sh2 = '<Worksheet ss:Name="Riepilogo '+dt+'"><Table><Column ss:Width="220"/><Column ss:Width="180"/>'
        +'<Row>'+cell('Cassetto_Utility v'+VERSION+' \u2014 Report '+dt,'String','ttl')+'</Row>'
        +'<Row>'+cell('Identificativo (PIVA/CF):')+cell(cod)+'</Row>'
        +'<Row>'+cell('Modalit\u00e0:')+cell(tipoCod)+'</Row>'
        +'<Row>'+cell('Anno selezionato:')+cell(anno)+'</Row>'
        +'<Row>'+cell('Tipo modello:')+cell(dt)+'</Row>'
        +'<Row>'+cell('Data report:')+cell(nowStr)+'</Row><Row/>'
        +'<Row>'+cell('Versamenti sul sito:','String','bld')+cell(rows.length,'Number')+'</Row>';
    if (dt === 'F24') sh2 += '<Row>'+cell('  con Quietanza:','String','bld')+cell(totQ,'Number')+'</Row><Row>'+cell('  solo Copia F24:','String','bld')+cell(totC,'Number')+'</Row>';
    sh2 += '<Row/><Row>'+cell('Scaricati:','String','bld')+cell(totOK,'Number','ok')+'</Row>'
        +'<Row>'+cell('Errori:','String','bld')+cell(totERR,'Number','er')+'</Row>'
        +'<Row>'+cell('Non scaricati:','String','bld')+cell(totNS,'Number','wn')+'</Row></Table></Worksheet>';

    return '<?xml version="1.0" encoding="UTF-8"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Styles>'+styles+'</Styles>'+sh1+sh2+'</Workbook>';
}

/* XLS per risultati ricerca F24 — 1) Elenco primo, Riepilogo secondo */
function buildXLSSel(rows, log) {
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
        +S+'wn"><Interior ss:Color="#FFF9C4" ss:Pattern="Solid"/>'+E;
    function cell(v,t,sty) { return '<Cell'+(sty?' ss:StyleID="'+sty+'"':'')+'><Data ss:Type="'+(t||'String')+'">'+esc(v)+'</Data></Cell>'; }

    var hdrs = ['N\u00B0','Data','Tributo','Descrizione','Anno Rif.','Importo Debito','Importo Credito','Nome File','Stato'];
    var hrow = hdrs.map(function(h){return cell(h,'String','hdr');}).join('');
    var widths = [40,100,60,250,80,120,120,280,110];
    var cols = widths.map(function(w){return '<Column ss:Width="'+w+'"/>';}).join('');
    var logMap = {}; log.forEach(function(l,idx){logMap[idx]=l;});
    var drows = rows.map(function(r,i) {
        var l = logMap[i]||null;
        var fname = l?l.filename:'', stato = l?(l.ok?'Scaricato':'Errore'):'Non scaricato';
        var sty = l?(l.ok?'ok':'er'):'wn';
        return '<Row>'+cell(i+1,'Number',sty)+cell(r.date,'String',sty)+cell(r.tributo||'','String',sty)+cell(r.descrizione||'','String',sty)+cell(r.annoRif||'','String',sty)+cell(r.importo,'String',sty)+cell(r.credito||'','String',sty)+cell(fname,'String',sty)+cell(stato,'String',sty)+'</Row>';
    }).join('');
    var sh1 = '<Worksheet ss:Name="Elenco F24 Ricerca"><Table>'+cols+'<Row>'+hrow+'</Row>'+drows+'</Table></Worksheet>';
    var sh2 = '<Worksheet ss:Name="Riepilogo"><Table><Column ss:Width="220"/><Column ss:Width="180"/>'
        +'<Row>'+cell('Cassetto_Utility v'+VERSION+' \u2014 Report F24 Ricerca','String','ttl')+'</Row>'
        +'<Row>'+cell('Identificativo:')+cell(cod)+'</Row>'
        +'<Row>'+cell('Modalit\u00e0:')+cell(tipoCod)+'</Row>'
        +'<Row>'+cell('Data report:')+cell(nowStr)+'</Row><Row/>'
        +'<Row>'+cell('Tributi trovati:','String','bld')+cell(rows.length,'Number')+'</Row><Row/>'
        +'<Row>'+cell('Scaricati:','String','bld')+cell(totOK,'Number','ok')+'</Row>'
        +'<Row>'+cell('Errori:','String','bld')+cell(totERR,'Number','er')+'</Row>'
        +'<Row>'+cell('Non scaricati:','String','bld')+cell(totNS,'Number','wn')+'</Row></Table></Worksheet>';
    return '<?xml version="1.0" encoding="UTF-8"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Styles>'+styles+'</Styles>'+sh1+sh2+'</Workbook>';
}

function dlXLS(content, fname) {
    var blob = new Blob([content],{type:'application/vnd.ms-excel;charset=UTF-8'});
    saveBlob(blob, fname);
}

/* ═══════════════════════════════════════════════════════════════
   5) SELETTORE DATE — Ricerche tributi F24 (#tabf-1)
   ═══════════════════════════════════════════════════════════════ */

function injectDateSelector() {
    if (document.getElementById('CU_DateSel')) { document.getElementById('CU_DateSel').remove(); showSt('\uD83D\uDCC5 Selettore date rimosso.', 100); setTimeout(hideSt, 2000); return; }
    var tabf1 = document.getElementById('tabf-1');
    if (!tabf1) { showSt('\u26A0\uFE0F Tab "Ricerca per data versamento" non trovato.', 0); return; }
    var dalInput = document.getElementById('dataDal_1');
    var alInput  = document.getElementById('dataAl_1');
    if (!dalInput || !alInput) { showSt('\u26A0\uFE0F Campi data non trovati.', 0); return; }

    var oggi = new Date();
    var annoCorrente = oggi.getFullYear();

    var sel = document.createElement('div'); sel.id = 'CU_DateSel';
    sel.innerHTML = '<b>\uD83D\uDCC5 Cassetto_Utility: Selettore date</b><br><br>'+
        '<span style="margin-right:6px">Anno:</span>'+
        '<input type="number" id="CU_DS_Anno" value="'+annoCorrente+'" min="2010" max="'+annoCorrente+'" style="width:65px">'+
        '&nbsp;&nbsp;'+
        '<select id="CU_DS_Period">'+
        '<option value="">-- Seleziona periodo --</option>'+
        '<option value="T1">I trimestre (Gen-Mar)</option><option value="T2">II trimestre (Apr-Giu)</option>'+
        '<option value="T3">III trimestre (Lug-Set)</option><option value="T4">IV trimestre (Ott-Dic)</option>'+
        '<option value="M1">Gennaio</option><option value="M2">Febbraio</option><option value="M3">Marzo</option>'+
        '<option value="M4">Aprile</option><option value="M5">Maggio</option><option value="M6">Giugno</option>'+
        '<option value="M7">Luglio</option><option value="M8">Agosto</option><option value="M9">Settembre</option>'+
        '<option value="M10">Ottobre</option><option value="M11">Novembre</option><option value="M12">Dicembre</option>'+
        '<option value="anno">Anno intero</option>'+
        '</select>&nbsp;&nbsp;'+
        '<button class="cu-ds-btn" id="CU_DS_Applica">Applica</button>';

    // Inserisci dopo il primo fieldset (data) nel tabf-1
    var legend = tabf1.querySelector('legend');
    var fieldset = legend ? legend.closest('fieldset') : null;
    if (fieldset) fieldset.parentNode.insertBefore(sel, fieldset.nextSibling);
    else tabf1.appendChild(sel);

    document.getElementById('CU_DS_Applica').addEventListener('click', function() {
        var anno = parseInt(document.getElementById('CU_DS_Anno').value);
        var period = document.getElementById('CU_DS_Period').value;
        if (!period) return;
        function ultimoG(m) { return pad2(new Date(anno, m, 0).getDate())+'/'+pad2(m)+'/'+anno; }
        function capOggi(s) { var pp=s.split('/'); var d=new Date(+pp[2],+pp[1]-1,+pp[0]); if(d>oggi) return pad2(oggi.getDate())+'/'+pad2(oggi.getMonth()+1)+'/'+oggi.getFullYear(); return s; }
        var dalV, alV;
        if (period === 'anno') { dalV = '01/01/'+anno; alV = '31/12/'+anno; }
        else if (period.charAt(0) === 'T') { var t=parseInt(period.charAt(1)); var mm=[[1,3],[4,6],[7,9],[10,12]][t-1]; dalV='01/'+pad2(mm[0])+'/'+anno; alV=ultimoG(mm[1]); }
        else { var m=parseInt(period.substring(1)); dalV='01/'+pad2(m)+'/'+anno; alV=ultimoG(m); }
        alV = capOggi(alV);
        dalInput.value = dalV; dalInput.dispatchEvent(new Event('change', {bubbles:true}));
        alInput.value = alV; alInput.dispatchEvent(new Event('change', {bubbles:true}));
        showSt('\uD83D\uDCC5 Date impostate: '+dalV+' \u2014 '+alV, 100); setTimeout(hideSt, 3000);
    });
    showSt('\uD83D\uDCC5 Selettore date attivo nel tab "Ricerca per data versamento".', 100); setTimeout(hideSt, 3000);
}

/* ═══════════════════════════════════════════════════════════════
   ACTION HANDLER
   ═══════════════════════════════════════════════════════════════ */

async function handleAction(e) {
    var action = e.currentTarget.dataset.action;

    // Navigazione
    if (action === 'goToVers') { location.href = SERVLET+'?Ric=VERS'; return; }
    if (action === 'goToCU')  { location.href = 'https://cassetto.agenziaentrate.gov.it/cassfisc-web/CassettoFiscaleServlet?Ric=CUK'; return; }
    if (action === 'goToF24') { var l24 = document.querySelector('a[href*="Ric=F24"]'); if (l24) l24.click(); else location.href = SERVLET+'?Ric=F24'; return; }
    if (action === 'goToF23') { var l23 = document.querySelector('a[href*="Ric=F23"]'); if (l23) l23.click(); else location.href = SERVLET+'?Ric=F23'; return; }

    // Selettore date per ricerca F24
    if (action === 'dateSelector') { injectDateSelector(); return; }

    // F24 Protocolli
    if (action === 'copyProto') {
        var rows = collectF24();
        navigator.clipboard.writeText(rows.map(function(r){return r.date+'\t'+r.proto;}).join('\n')).then(function(){
            showSt('\u2705 '+rows.length+' protocolli copiati!', 100); setTimeout(hideSt, 3000);
        });
        return;
    }

    // Riepilogo (F24/F23/CU)
    if (action === 'summary') {
        if (summaryVisible) { hideSt(); summaryVisible = false; return; }
        if (isCUList) {
            var cuItems = collectCU();
            showSt('\uD83D\uDCCA CU \u2014 Totale: '+cuItems.length+(cuDlLog.length ? ' | Scaricate: '+cuDlLog.filter(function(l){return l.ok;}).length : ''), 100);
        } else {
            var rows2 = isF24List ? collectF24() : collectF23();
            var conQ = rows2.filter(function(r){return r.hasQuietanza;}).length;
            var msg = '\uD83D\uDCCA '+docType+' \u2014 Totale: '+rows2.length;
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
        showSt('\uD83D\uDCCA F24 Ricerca \u2014 Tributi: '+selRows.length+(dlLog.length ? ' | Scaricati: '+dlLog.filter(function(l){return l.ok;}).length : ''), 100);
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
        if (!rows3.length) { showSt('\u26A0\uFE0F Nessun versamento trovato.', 0); return; }
        var cod = getIdentifier().code, anno = getParam('Anno') || 'ANNO';
        dlXLS(buildXLS(rows3, dlLog), safe(cod)+'_'+safe(anno)+'_Report'+docType+'_CassettoUtility.xls');
        showSt('\u2705 Report Excel generato.', 100); setTimeout(hideSt, 4000); return;
    }

    // Report Excel ricerca F24
    if (action === 'reportExcelSel') {
        summaryVisible = false;
        var selR = collectF24Sel();
        if (!selR.length) { showSt('\u26A0\uFE0F Nessun tributo trovato.', 0); return; }
        dlXLS(buildXLSSel(selR, dlLog), safe(getIdentifier().code)+'_RicercaF24_CassettoUtility.xls');
        showSt('\u2705 Report Excel ricerca F24 generato.', 100); setTimeout(hideSt, 4000); return;
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
        showSt('\uD83E\uDDF3\u2B07 '+tipo+'\u2026', 50); setDis(true);
        var ok = await dlPdf(pdfU, fn);
        if (!ok && isQ) {
            showSt('\u26A0\uFE0F Riprovo download\u2026', 70);
            await sleep(500);
            ok = await dlPdf(pdfU, fn);
        }
        showSt(ok ? '\u2705 '+fn : '\u274C Errore.', 100); setDis(false); return;
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
        showSt('\uD83E\uDDF3\u2B07 Generazione PDF CU\u2026', 50); setDis(true);
        var ok2 = await dlCUPdf(annoCU, protCU, fname2);
        showSt(ok2 ? '\u2705 '+fname2 : '\u274C Errore generazione PDF.', 100); setDis(false); return;
    }
}

console.log('[Cassetto_Utility] v'+VERSION+' caricato');
})();
