// ==UserScript==
// @name           Cassetto_Utility
// @namespace      https://denvermotel.github.io/Cassetto_Utility/
// @downloadURL    https://raw.githubusercontent.com/denvermotel/Cassetto_Utility/refs/heads/main/Cassetto_Utility.user.js
// @updateURL      https://raw.githubusercontent.com/denvermotel/Cassetto_Utility/refs/heads/main/Cassetto_Utility.user.js
// @version        0.05-beta
// @description    Toolbox per cassetto.agenziaentrate.gov.it: download massivo F24/F23, Report Excel con raffronto, supporto cassetto proprio e delegato
// @author         denvermotel
// @match          https://cassetto.agenziaentrate.gov.it/*
// @icon           https://www.agenziaentrate.gov.it/portale/favicon.ico
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
 * Cassetto_Utility - v0.05 beta
 * Userscript per il portale cassetto.agenziaentrate.gov.it
 *
 * Changelog 0.05β:
 *   - NEW: Conversione da bookmarklet a userscript Tampermonkey/Greasemonkey
 *   - NEW: Storage persistente (GM_setValue/GM_getValue) per log download
 *   - NEW: Tab riapertura barra dopo chiusura con ✕
 *   - NEW: Link istruzioni (ℹ️) nella barra
 *   - NEW: Licenza GPL-3.0 allineata a FE-Utility
 *   - NEW: Grafica barra omogenea con FE-Utility
 *   - NEW: Monitoraggio URL — pulsanti si aggiornano alla navigazione
 *   - NEW: Pagina Versamenti (Ric=VERS) con link a F24 e F23
 */
(function () {
    'use strict';

    /* ─── ANTI-DOPPIO AVVIO ─────────────────────────────────────── */
    var _win = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
    if (_win._CassettoUtility) {
        var ex = document.getElementById('CU_Panel');
        if (ex) {
            var vis = ex.style.display;
            ex.style.setProperty('display', vis === 'none' ? 'block' : 'none', 'important');
            if (vis === 'none') aggiornaPadding();
            else document.body.style.removeProperty('padding-top');
        }
        return;
    }
    _win._CassettoUtility = true;

    /* ─── COSTANTI ───────────────────────────────────────────────── */
    var VERSION = '0.05\u03B2';  // 0.05β
    var PANEL_ID = 'CU_Panel';
    var INSTRUCTIONS_URL = 'https://denvermotel.github.io/Cassetto_Utility/';
    var BASE_URL = window.location.origin;

    /* ─── STORAGE (GM_setValue/GM_getValue con fallback localStorage) ─ */
    var STORAGE_PREFIX = 'CU_';
    var _useGM = (typeof GM_setValue === 'function' && typeof GM_getValue === 'function');

    function storageGet(key, def) {
        try {
            if (_useGM) {
                var v = GM_getValue(STORAGE_PREFIX + key);
                return (v !== undefined && v !== null) ? v : def;
            }
            var v2 = localStorage.getItem(STORAGE_PREFIX + key);
            return v2 !== null ? JSON.parse(v2) : def;
        } catch (e) { return def; }
    }

    function storageSet(key, val) {
        try {
            if (_useGM) { GM_setValue(STORAGE_PREFIX + key, val); return; }
            localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(val));
        } catch (e) { }
    }

    /* ─── PAGE CONTEXT DETECTION (dinamico) ──────────────────────── */
    // Queste variabili vengono ricalcolate ad ogni cambio URL
    var isF24List, isF24Detail, isF23List, isF23Detail;
    var isListPage, isDetailPage, isVersPage, docType;

    function detectContext() {
        var href = window.location.href;
        isF24List    = href.indexOf('Ric=F24')    !== -1 && href.indexOf('Ric=DetF24') === -1;
        isF24Detail  = href.indexOf('Ric=DetF24') !== -1;
        isF23List    = href.indexOf('Ric=F23')    !== -1 && href.indexOf('Ric=DetF23') === -1;
        isF23Detail  = href.indexOf('Ric=DetF23') !== -1;
        isListPage   = isF24List   || isF23List;
        isDetailPage = isF24Detail || isF23Detail;
        isVersPage   = href.indexOf('Ric=VERS') !== -1 && !isListPage && !isDetailPage;
        docType      = (isF24List || isF24Detail) ? 'F24' : 'F23';
    }
    detectContext();

    /* ─── IDENTIFIER EXTRACTION (PIVA 11 cifre | CF 16 caratteri) ── */
    // Priorità:
    //   1. Cassetto delegato → div.section.border.border-primary.my-1.bg-light.px-3
    //   2. Cassetto proprio  → #user-info p.mb-2
    //      a. PIVA: numero di 11 cifre
    //      b. CF:   pattern 6L + 2N + L + 2N + L + 3N + L (16 char)
    //   3. fallback: primo testo utile in #user-info
    function getIdentifier() {
        // 1. Delegato
        var delegaEl = document.querySelector('div.section.border.border-primary.my-1.bg-light.px-3');
        if (delegaEl) {
            var m = delegaEl.textContent.match(/\b(\d{11})\b/);
            if (m) return { code: m[1], tipo: 'delegato' };
        }
        // 2. p.mb-2 nel box utente
        var ps = document.querySelectorAll('#user-info-data-container p.mb-2, #user-info p.mb-2');
        for (var i = 0; i < ps.length; i++) {
            var t = ps[i].textContent.trim();
            var mPiva = t.match(/\b(\d{11})\b/);
            if (mPiva) return { code: mPiva[1], tipo: 'piva' };
            var mCf = t.match(/\b([A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z])\b/);
            if (mCf) return { code: mCf[1], tipo: 'cf' };
        }
        // 3. Fallback
        var ui = document.getElementById('user-info');
        if (ui) {
            var mf = ui.textContent.match(/\b(\d{11})\b/);
            if (mf) return { code: mf[1], tipo: 'piva' };
        }
        return { code: 'CODICE', tipo: 'sconosciuto' };
    }

    function isDelegato() {
        return !!document.querySelector('div.section.border.border-primary.my-1.bg-light.px-3');
    }

    /* ─── PARSE ITALIAN DATE dd/mm/yyyy ──────────────────────────── */
    function parseDate(s) {
        var p = String(s || '').trim().split('/');
        if (p.length === 3) return { g: p[0].padStart(2, '0'), m: p[1].padStart(2, '0'), a: p[2] };
        return { g: 'GG', m: 'MM', a: 'AAAA' };
    }

    /* ─── UTILITY ────────────────────────────────────────────────── */
    function getParam(n, href) { href = href || window.location.href; var m = new RegExp('[?&]' + n + '=([^&]*)').exec(href); return m ? decodeURIComponent(m[1]) : ''; }
    function safe(s) { return String(s).replace(/[\/\\:*?"<>|]/g, '_').replace(/\s+/g, '_'); }
    function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
    function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

    /* ─── BUILD FILENAME ─────────────────────────────────────────── */
    function buildFilename(tipo, anno, dateStr, idx) {
        var cod = getIdentifier().code;
        var d   = parseDate(dateStr);
        var yr  = (d.a !== 'AAAA') ? d.a : anno;
        return safe(cod) + '_' + safe(yr) + '_' + safe(d.m) + '_' + safe(d.g) + '_' + safe(tipo) + '_idx' + safe(idx) + '.pdf';
    }

    /* ─── CSS INJECTION ──────────────────────────────────────────── */
    var stile = document.createElement('style');
    stile.textContent =
        '#' + PANEL_ID + '{' +
        'all:initial!important;display:block!important;' +
        'position:fixed!important;top:0!important;left:0!important;' +
        'width:100vw!important;box-sizing:border-box!important;' +
        'z-index:2147483647!important;' +
        'background:#1b3a2b!important;' +
        'border-bottom:2px solid #2e7d32!important;' +
        'box-shadow:0 3px 12px rgba(0,0,0,.6)!important;' +
        'font-family:Arial,Helvetica,sans-serif!important;' +
        'font-size:12px!important;color:#e8f5e9!important;}' +

        '#CU_TopRow{' +
        'all:initial!important;' +
        'display:flex!important;flex-direction:row!important;flex-wrap:nowrap!important;' +
        'align-items:center!important;gap:5px!important;' +
        'padding:5px 20px 5px 10px!important;width:100%!important;box-sizing:border-box!important;' +
        'overflow-x:auto!important;}' +

        '#CU_Logo{' +
        'all:initial!important;' +
        'font-family:Arial,sans-serif!important;font-size:13px!important;' +
        'font-weight:bold!important;color:#a5d6a7!important;' +
        'white-space:nowrap!important;flex-shrink:0!important;margin-right:4px!important;}' +

        '#CU_BottomRow{' +
        'all:initial!important;display:none!important;width:100%!important;' +
        'box-sizing:border-box!important;padding:2px 10px 5px!important;}' +

        '#CU_PBar{' +
        'all:initial!important;display:inline-block!important;' +
        'width:180px!important;height:8px!important;' +
        'background:#263238!important;border-radius:4px!important;overflow:hidden!important;' +
        'vertical-align:middle!important;margin-right:8px!important;}' +

        '#CU_PFill{' +
        'all:initial!important;display:block!important;' +
        'height:100%!important;background:#43a047!important;width:0%!important;' +
        'transition:width .4s!important;}' +

        '#CU_Status{' +
        'all:initial!important;display:inline!important;' +
        'font-family:Arial,sans-serif!important;font-size:11px!important;' +
        'color:#80cbc4!important;vertical-align:middle!important;}' +

        '.cuBtn{' +
        'all:initial!important;display:inline-block!important;' +
        'padding:5px 10px!important;border:none!important;border-radius:4px!important;' +
        'cursor:pointer!important;font-size:11px!important;font-weight:bold!important;' +
        'white-space:nowrap!important;flex-shrink:0!important;' +
        'font-family:Arial,sans-serif!important;line-height:1.4!important;' +
        'transition:filter .15s!important;}' +
        '.cuBtn:hover{filter:brightness(1.2)!important;}' +
        '.cuBtn:disabled{opacity:.4!important;cursor:not-allowed!important;}' +

        '.cu-green{background:#2e7d32!important;color:#fff!important;}' +
        '.cu-blue{background:#1565c0!important;color:#fff!important;}' +
        '.cu-teal{background:#00695c!important;color:#fff!important;}' +
        '.cu-orange{background:#e65100!important;color:#fff!important;}' +
        '.cu-purple{background:#6a1b9a!important;color:#fff!important;}' +
        '.cu-grey{background:#37474f!important;color:#fff!important;}' +
        '.cu-red{background:#b71c1c!important;color:#fff!important;}' +

        '.cu-badge{' +
        'all:initial!important;display:inline-block!important;' +
        'font-family:Arial,sans-serif!important;font-size:11px!important;' +
        'color:#80cbc4!important;padding:2px 7px!important;' +
        'border:1px solid #2e7d32!important;border-radius:3px!important;' +
        'white-space:nowrap!important;flex-shrink:0!important;}' +

        '.cu-dtag{' +
        'all:initial!important;display:inline-block!important;' +
        'font-family:Arial,sans-serif!important;font-size:11px!important;' +
        'background:#2e7d32!important;color:#fff!important;' +
        'padding:2px 7px!important;border-radius:3px!important;border:1px solid #2e7d32!important;' +
        'white-space:nowrap!important;flex-shrink:0!important;}' +

        '#CU_InfoLink{' +
        'all:initial!important;display:inline-flex!important;align-items:center!important;' +
        'justify-content:center!important;width:26px!important;height:26px!important;' +
        'font-size:14px!important;text-decoration:none!important;cursor:pointer!important;' +
        'border-radius:4px!important;background:rgba(255,255,255,0.1)!important;' +
        'flex-shrink:0!important;transition:background .15s!important;margin-left:4px!important;}' +
        '#CU_InfoLink:hover{background:rgba(255,255,255,0.25)!important;}';
    document.head.appendChild(stile);

    /* ─── BUILD PANEL (shell fissa — i pulsanti sono dinamici) ──── */
    var p = document.createElement('div');
    p.id = PANEL_ID;
    p.innerHTML =
        '<div id="CU_TopRow">' +
            '<span id="CU_Logo">\uD83E\uDDF3 Cassetto_Utility v' + VERSION + '</span>' +
            '<span id="CU_Badge" class="cu-badge"></span>' +
            '<span id="CU_DocTag"></span>' +
            '<span id="CU_Buttons" style="all:initial!important;display:contents!important;"></span>' +
            '<span style="all:initial!important;flex:1 1 auto!important;min-width:10px!important;"></span>' +
            '<a id="CU_InfoLink" href="' + INSTRUCTIONS_URL + '" target="_blank" rel="noopener noreferrer" title="Istruzioni Cassetto_Utility">\u2139\uFE0F</a>' +
            '<button id="CU_X" style="all:initial;display:inline-flex;align-items:center;' +
                'justify-content:center;width:26px;height:26px;margin-left:4px;' +
                'background:#b71c1c;border:none;border-radius:4px;color:#fff;font-size:14px;' +
                'font-weight:bold;cursor:pointer;flex-shrink:0;line-height:1;" title="Chiudi">\u2715</button>' +
        '</div>' +
        '<div id="CU_BottomRow">' +
            '<div id="CU_PBar"><div id="CU_PFill"></div></div>' +
            '<span id="CU_Status"></span>' +
        '</div>';

    document.documentElement.appendChild(p);

    /* ─── REBUILD BUTTONS (chiamata ad ogni cambio URL) ──────────── */
    function rebuildButtons() {
        detectContext();

        // Badge identificativo
        var idInfo = getIdentifier();
        var icon = isDelegato() ? '\uD83D\uDC65' : (idInfo.tipo === 'cf' ? '\uD83D\uDC64' : '\uD83C\uDFE2');
        var badgeTitle = isDelegato() ? 'Cassetto delegato' : (idInfo.tipo === 'cf' ? 'Codice Fiscale' : 'Partita IVA');
        var badgeEl = document.getElementById('CU_Badge');
        if (badgeEl) {
            badgeEl.textContent = icon + ' ' + idInfo.code;
            badgeEl.title = badgeTitle;
        }

        // Doc type tag
        var docTagEl = document.getElementById('CU_DocTag');
        if (docTagEl) {
            if (isListPage || isDetailPage) {
                docTagEl.className = 'cu-dtag';
                docTagEl.textContent = docType;
            } else if (isVersPage) {
                docTagEl.className = 'cu-dtag';
                docTagEl.textContent = 'Versamenti';
            } else {
                docTagEl.className = '';
                docTagEl.textContent = '';
            }
        }

        // Pulsanti
        var container = document.getElementById('CU_Buttons');
        if (!container) return;

        var btnsHtml = '';

        if (isF24List) {
            btnsHtml =
                '<button class="cuBtn cu-green"  data-action="downloadAll">\uD83E\uDDC3\u2B07 Scarica F24</button>' +
                '<button class="cuBtn cu-blue"   data-action="copyProto">\uD83D\uDCCB Protocolli</button>' +
                '<button class="cuBtn cu-purple" data-action="reportExcel">\uD83D\uDCCA Report Excel</button>' +
                '<button class="cuBtn cu-orange" data-action="summary">\uD83D\uDD0D Riepilogo</button>';
        } else if (isF23List) {
            btnsHtml =
                '<button class="cuBtn cu-green"  data-action="downloadAllF23">\uD83E\uDDC3\u2B07 Scarica F23</button>' +
                '<button class="cuBtn cu-purple" data-action="reportExcel">\uD83D\uDCCA Report Excel</button>' +
                '<button class="cuBtn cu-orange" data-action="summary">\uD83D\uDD0D Riepilogo</button>';
        } else if (isF24Detail) {
            btnsHtml =
                '<button class="cuBtn cu-green" data-action="downloadDetailPDF">\uD83E\uDDC3\u2B07 Copia F24 (PDF)</button>' +
                '<button class="cuBtn cu-teal"  data-action="downloadQuietanza">\uD83E\uDDF3\u2B07 Quietanza (PDF)</button>';
        } else if (isF23Detail) {
            btnsHtml =
                '<button class="cuBtn cu-green" data-action="downloadDetailPDF">\uD83E\uDDC3\u2B07 Copia F23 (PDF)</button>';
        } else if (isVersPage) {
            // Pagina Versamenti: mostra link diretti a F24 e F23
            btnsHtml =
                '<button class="cuBtn cu-green" data-action="goToF24">\uD83D\uDCC4 Modello F24</button>' +
                '<button class="cuBtn cu-teal"  data-action="goToF23">\uD83D\uDCC4 Modello F23</button>';
        } else {
            btnsHtml =
                '<button class="cuBtn cu-orange" data-action="goToVers">\u26A0 Vai a Versamenti</button>';
        }

        container.innerHTML = btnsHtml;

        // Bind eventi sui nuovi pulsanti
        container.querySelectorAll('.cuBtn').forEach(function (btn) {
            btn.addEventListener('click', handleAction);
        });

        // Nasconde la status row al cambio pagina
        hideSt();
        summaryVisible = false;

        aggiornaPadding();
        console.log('[CU] Contesto:', isVersPage ? 'VERS' : isF24List ? 'F24 lista' : isF23List ? 'F23 lista' : isF24Detail ? 'F24 dettaglio' : isF23Detail ? 'F23 dettaglio' : 'altro');
    }

    // Prima costruzione
    rebuildButtons();

    /* ─── URL CHANGE MONITOR ─────────────────────────────────────── */
    // Polling ogni 500ms: se la URL è cambiata, ricostruisce i pulsanti
    var _lastUrl = window.location.href;
    setInterval(function () {
        var cur = window.location.href;
        if (cur !== _lastUrl) {
            _lastUrl = cur;
            rebuildButtons();
        }
    }, 500);

    /* ─── PADDING DINAMICO ───────────────────────────────────────── */
    var _padTimer;
    function aggiornaPadding() {
        document.body.style.setProperty('padding-top', (p.offsetHeight || 40) + 'px', 'important');
    }
    aggiornaPadding();
    _padTimer = setInterval(aggiornaPadding, 600);

    /* ─── CLOSE / REOPEN TAB ─────────────────────────────────────── */
    document.getElementById('CU_X').onclick = function () {
        p.style.setProperty('display', 'none', 'important');
        document.body.style.removeProperty('padding-top');
        clearInterval(_padTimer);
        // Tab per riaprire
        var tab = document.createElement('div');
        tab.id = 'CU_ReopenTab';
        tab.style.cssText = 'all:initial!important;position:fixed!important;top:0!important;right:20px!important;' +
            'background:#1b3a2b!important;color:#a5d6a7!important;padding:4px 12px!important;' +
            'border-radius:0 0 6px 6px!important;font-family:Arial,sans-serif!important;' +
            'font-size:12px!important;cursor:pointer!important;z-index:2147483647!important;' +
            'box-shadow:0 2px 6px rgba(0,0,0,0.3)!important;font-weight:bold!important;';
        tab.textContent = '\uD83E\uDDF3 Cassetto_Utility';
        tab.title = 'Riapri la barra Cassetto_Utility';
        tab.onclick = function () {
            tab.remove();
            p.style.setProperty('display', 'block', 'important');
            aggiornaPadding();
            _padTimer = setInterval(aggiornaPadding, 600);
        };
        document.documentElement.appendChild(tab);
    };

    /* ─── STATUS / PROGRESS ──────────────────────────────────────── */
    var summaryVisible = false;

    function showSt(msg, pct) {
        var row = document.getElementById('CU_BottomRow');
        var fill = document.getElementById('CU_PFill');
        var st = document.getElementById('CU_Status');
        if (row) row.style.setProperty('display', 'block', 'important');
        if (st) st.textContent = msg;
        if (fill && pct !== undefined) fill.style.setProperty('width', Math.min(100, pct) + '%', 'important');
        aggiornaPadding();
    }

    function hideSt() {
        var row = document.getElementById('CU_BottomRow');
        if (row) row.style.setProperty('display', 'none', 'important');
        aggiornaPadding();
    }

    function setDis(val) {
        var btns = document.querySelectorAll('#CU_Buttons .cuBtn');
        btns.forEach(function (b) { b.disabled = val; });
    }

    /* ─── COLLECT F24 ROWS FROM LIST ─────────────────────────────── */
    function collectF24() {
        var rows = [];
        document.querySelectorAll('a.btn[href*="Ric=DetF24"]').forEach(function (a) {
            var row = a.closest('tr'); if (!row) return;
            var dateEl = row.querySelector('th');
            var numEl  = row.querySelector('td[headers="numero"]');
            var impEl  = row.querySelector('td[headers="importo"]');
            var proEl  = row.querySelector('td[headers="protocollo"]');
            var qLink  = row.querySelector('a[href*="stampa=Q"]');
            rows.push({
                detHref: row.querySelector('a.btn').href,
                qHref: qLink ? qLink.href : null,
                date: dateEl ? dateEl.textContent.trim() : '',
                num: numEl ? numEl.textContent.trim() : '',
                importo: impEl ? impEl.textContent.trim().replace(/\s+/g, ' ') : '',
                proto: proEl ? proEl.textContent.trim() : '',
                hasQuietanza: !!qLink,
                docType: 'F24',
            });
        });
        return rows;
    }

    /* ─── COLLECT F23 ROWS FROM LIST ─────────────────────────────── */
    function collectF23() {
        var rows = [];
        document.querySelectorAll('a[href*="Ric=DetF23"]').forEach(function (a) {
            var row = a.closest('tr'); if (!row) return;
            var dateEl = row.querySelector('th[headers="dataversamento"]') || row.querySelector('th');
            var impEl  = row.querySelector('td[headers="saldo"]') || row.querySelector('td');
            rows.push({
                detHref: a.href,
                qHref: null,
                date: dateEl ? dateEl.textContent.trim() : '',
                importo: impEl ? impEl.textContent.trim().replace(/\s+/g, ' ') : '',
                proto: '',
                hasQuietanza: false,
                docType: 'F23',
            });
        });
        return rows;
    }

    /* ─── DOWNLOAD PDF ───────────────────────────────────────────── */
    function dlPdf(url, filename) {
        return new Promise(function (resolve) {
            fetch(url, { credentials: 'include' })
                .then(function (r) { return r.blob(); })
                .then(function (blob) {
                    var bu = URL.createObjectURL(blob);
                    var a = document.createElement('a'); a.href = bu; a.download = filename;
                    document.body.appendChild(a); a.click(); document.body.removeChild(a);
                    setTimeout(function () { URL.revokeObjectURL(bu); }, 5000);
                    resolve(true);
                }).catch(function (err) { console.warn('[CU]', err); resolve(false); });
        });
    }

    /* ─── SESSION DOWNLOAD LOG ───────────────────────────────────── */
    var dlLog = [];

    /* ─── GENERIC BATCH DOWNLOAD ─────────────────────────────────── */
    async function runBatch(rows) {
        if (!rows.length) { showSt('\u26A0\uFE0F Nessun versamento trovato in questa pagina.', 0); return; }
        setDis(true); dlLog = [];
        var ok_n = 0, fail_n = 0;
        for (var i = 0; i < rows.length; i++) {
            var row  = rows[i];
            var anno = getParam('Anno', row.detHref) || 'XXXX';
            var idx  = getParam('indice', row.detHref) || String(i);
            var dlUrl, tipo;
            if (row.docType === 'F24') {
                if (row.hasQuietanza) { dlUrl = row.qHref;               tipo = 'QuietanzaF24'; }
                else                  { dlUrl = row.detHref + '&stampa=P'; tipo = 'CopiaF24';     }
            } else {
                dlUrl = row.detHref + '&stampa=P'; tipo = 'CopiaF23';
            }
            var fname = buildFilename(tipo, anno, row.date, idx);
            showSt('\uD83E\uDDF3\u2B07 (' + (i + 1) + '/' + rows.length + ') ' + fname, Math.round(i / rows.length * 100));
            var ok = await dlPdf(dlUrl, fname);
            dlLog.push({ date: row.date, importo: row.importo, proto: row.proto, docType: row.docType,
                         tipo: tipo, filename: fname, ok: ok });
            if (ok) { ok_n++; } else { fail_n++; }
            await sleep(600);
        }
        document.getElementById('CU_PFill').style.setProperty('width', '100%', 'important');
        showSt('\u2705 Completato: ' + ok_n + ' scaricati' + (fail_n > 0 ? ', \u26A0\uFE0F ' + fail_n + ' errori' : '') +
               ' \u2014 usa \uD83D\uDCCA Report Excel per il raffronto.', 100);
        setDis(false);

        // Salva log nello storage persistente
        var logKey = 'dlLog_' + getIdentifier().code + '_' + (getParam('Anno') || 'ANNO');
        storageSet(logKey, dlLog);
    }

    /* ─── BUILD XLS REPORT ───────────────────────────────────────── */
    function buildXLS(rows, log) {
        var idInfo   = getIdentifier();
        var cod      = idInfo.code;
        var tipoCod  = isDelegato() ? 'Cassetto Delegato' : (idInfo.tipo === 'cf' ? 'Cassetto Proprio (CF)' : 'Cassetto Proprio (PIVA)');
        var anno     = getParam('Anno') || '';
        var now      = new Date();
        var nowStr   = now.toLocaleDateString('it-IT') + ' ' + now.toLocaleTimeString('it-IT');
        var dt       = isF24List ? 'F24' : 'F23';

        var logMap = {};
        log.forEach(function (l) { if (l.proto) logMap[l.proto] = l; });
        var logArr = log.slice();

        var totQ   = rows.filter(function (r) { return r.hasQuietanza; }).length;
        var totC   = rows.length - totQ;
        var totOK  = log.filter(function (l) { return l.ok; }).length;
        var totERR = log.filter(function (l) { return !l.ok; }).length;
        var totNS  = rows.length - log.length;

        var S = '<Style ss:ID="'; var E = '</Style>';
        var styles = S + 'hdr"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#1a3a2a" ss:Pattern="Solid"/>' + E
            + S + 'ttl"><Font ss:Bold="1" ss:Size="14"/>' + E
            + S + 'bld"><Font ss:Bold="1"/>' + E
            + S + 'ok"><Interior ss:Color="#E8F5E9" ss:Pattern="Solid"/>' + E
            + S + 'er"><Interior ss:Color="#FFEBEE" ss:Pattern="Solid"/>' + E
            + S + 'wn"><Interior ss:Color="#FFF9C4" ss:Pattern="Solid"/>' + E;

        function cell(v, t, sty) { return '<Cell' + (sty ? ' ss:StyleID="' + sty + '"' : '') + '><Data ss:Type="' + (t || 'String') + '">' + esc(v) + '</Data></Cell>'; }

        // Sheet 1: Riepilogo
        var sh1 = '<Worksheet ss:Name="Riepilogo ' + dt + '">'
            + '<Table><Column ss:Width="220"/><Column ss:Width="180"/>'
            + '<Row>' + cell('Cassetto_Utility v' + VERSION + ' \u2014 Report ' + dt, 'String', 'ttl') + '</Row>'
            + '<Row>' + cell('Identificativo (PIVA/CF):') + cell(cod) + '</Row>'
            + '<Row>' + cell('Modalit\u00e0:') + cell(tipoCod) + '</Row>'
            + '<Row>' + cell('Anno selezionato:') + cell(anno) + '</Row>'
            + '<Row>' + cell('Tipo modello:') + cell(dt) + '</Row>'
            + '<Row>' + cell('Data report:') + cell(nowStr) + '</Row>'
            + '<Row/>'
            + '<Row>' + cell('Versamenti sul sito:', 'String', 'bld') + cell(rows.length, 'Number') + '</Row>';
        if (dt === 'F24') {
            sh1 += '<Row>' + cell('  con Quietanza:', 'String', 'bld') + cell(totQ, 'Number') + '</Row>'
                 + '<Row>' + cell('  solo Copia F24:', 'String', 'bld') + cell(totC, 'Number') + '</Row>';
        }
        sh1 += '<Row/>'
            + '<Row>' + cell('Scaricati con successo:', 'String', 'bld') + cell(totOK, 'Number', 'ok') + '</Row>'
            + '<Row>' + cell('Errori download:', 'String', 'bld') + cell(totERR, 'Number', 'er') + '</Row>'
            + '<Row>' + cell('Non scaricati (solo lista):', 'String', 'bld') + cell(totNS, 'Number', 'wn') + '</Row>'
            + '</Table></Worksheet>';

        // Sheet 2: Dettaglio
        var hdrs = dt === 'F24'
            ? ['N\u00B0', 'Data', 'Saldo', 'Protocollo', 'Disponibile', 'Nome File', 'Stato']
            : ['N\u00B0', 'Data', 'Importo', 'Nome File', 'Stato'];
        var hrow = hdrs.map(function (h) { return cell(h, 'String', 'hdr'); }).join('');
        var widths = dt === 'F24'
            ? [40, 100, 100, 180, 100, 280, 110]
            : [40, 100, 100, 280, 110];
        var cols = widths.map(function (w) { return '<Column ss:Width="' + w + '"/>'; }).join('');

        var drows = rows.map(function (r, i) {
            var l = r.proto ? logMap[r.proto] : (logArr[i] || null);
            var fname    = l ? l.filename : '';
            var stato    = l ? (l.ok ? 'Scaricato' : 'Errore') : 'Non scaricato';
            var sty      = l ? (l.ok ? 'ok' : 'er') : 'wn';
            var tipoDisp = r.hasQuietanza ? 'Quietanza' : (dt === 'F24' ? 'Copia F24' : 'Copia F23');
            if (dt === 'F24') {
                return '<Row>' + cell(i + 1, 'Number', sty) + cell(r.date, 'String', sty) + cell(r.importo, 'String', sty)
                    + cell(r.proto, 'String', sty) + cell(tipoDisp, 'String', sty) + cell(fname, 'String', sty) + cell(stato, 'String', sty) + '</Row>';
            } else {
                return '<Row>' + cell(i + 1, 'Number', sty) + cell(r.date, 'String', sty) + cell(r.importo, 'String', sty)
                    + cell(fname, 'String', sty) + cell(stato, 'String', sty) + '</Row>';
            }
        }).join('');

        var sh2 = '<Worksheet ss:Name="Dettaglio ' + dt + '">'
            + '<Table>' + cols + '<Row>' + hrow + '</Row>' + drows + '</Table></Worksheet>';

        return '<?xml version="1.0" encoding="UTF-8"?><?mso-application progid="Excel.Sheet"?>'
            + '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"'
            + ' xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">'
            + '<Styles>' + styles + '</Styles>' + sh1 + sh2 + '</Workbook>';
    }

    function dlXLS(content, fname) {
        var blob = new Blob([content], { type: 'application/vnd.ms-excel;charset=UTF-8' });
        var u = URL.createObjectURL(blob);
        var a = document.createElement('a'); a.href = u; a.download = fname;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(u); }, 5000);
    }

    /* ─── ACTION HANDLER ─────────────────────────────────────────── */
    async function handleAction(e) {
        var action = e.currentTarget.dataset.action;

        if (action === 'goToVers') {
            window.location.href = BASE_URL + '/cassfisc-web/CassettoFiscaleServlet?Ric=VERS';
            return;
        }

        if (action === 'goToF24') {
            // Cerca il link alla pagina F24 nella pagina corrente e lo clicca,
            // altrimenti naviga direttamente
            var linkF24 = document.querySelector('a[href*="Ric=F24"]');
            if (linkF24) { linkF24.click(); }
            else { window.location.href = BASE_URL + '/cassfisc-web/CassettoFiscaleServlet?Ric=F24'; }
            return;
        }

        if (action === 'goToF23') {
            var linkF23 = document.querySelector('a[href*="Ric=F23"]');
            if (linkF23) { linkF23.click(); }
            else { window.location.href = BASE_URL + '/cassfisc-web/CassettoFiscaleServlet?Ric=F23'; }
            return;
        }

        if (action === 'copyProto') {
            var rows = collectF24();
            navigator.clipboard.writeText(rows.map(function (r) { return r.date + '\t' + r.proto; }).join('\n')).then(function () {
                showSt('\u2705 ' + rows.length + ' protocolli copiati!', 100);
                setTimeout(hideSt, 3000);
            });
            return;
        }

        if (action === 'summary') {
            if (summaryVisible) { hideSt(); summaryVisible = false; return; }
            var rows2 = isF24List ? collectF24() : collectF23();
            var conQ  = rows2.filter(function (r) { return r.hasQuietanza; }).length;
            var msg   = '\uD83D\uDCCA ' + docType + ' \u2014 Totale: ' + rows2.length;
            if (isF24List) msg += ' | Quietanza: ' + conQ + ' | Solo copia: ' + (rows2.length - conQ);
            if (dlLog.length) msg += ' | Scaricati: ' + dlLog.filter(function (l) { return l.ok; }).length;
            showSt(msg, 100); summaryVisible = true; return;
        }

        if (action === 'downloadAll')    { await runBatch(collectF24()); return; }
        if (action === 'downloadAllF23') { await runBatch(collectF23()); return; }

        if (action === 'reportExcel') {
            summaryVisible = false;
            var rows3 = isF24List ? collectF24() : collectF23();
            if (!rows3.length) { showSt('\u26A0\uFE0F Nessun versamento trovato.', 0); return; }
            var cod   = getIdentifier().code;
            var anno  = getParam('Anno') || 'ANNO';
            var xls   = buildXLS(rows3, dlLog);
            var fname = safe(cod) + '_' + safe(anno) + '_Report' + docType + '_CassettoUtility.xls';
            dlXLS(xls, fname);
            showSt('\u2705 Report Excel generato: ' + fname, 100);
            setTimeout(hideSt, 4000); return;
        }

        // ── Detail page actions ──
        if (action === 'downloadDetailPDF' || action === 'downloadQuietanza') {
            var curUrl = window.location.href;
            var anno2  = getParam('Anno', curUrl);
            var idx    = getParam('indice', curUrl);
            var h3     = document.querySelector('#print h3, h3');
            var dStr   = '';
            if (h3) { var dm = h3.textContent.match(/(\d{1,2}\/\d{1,2}\/\d{4})/); if (dm) dStr = dm[1]; }
            var isQ  = (action === 'downloadQuietanza');
            var tipo = isQ ? 'QuietanzaF24' : (isF24Detail ? 'CopiaF24' : 'CopiaF23');
            var pdfU = curUrl.replace(/[?&]stampa=[^&]*/g, '').replace(/[?&]+$/, '') + '&stampa=' + (isQ ? 'Q' : 'P');
            var fn   = buildFilename(tipo, anno2, dStr, idx);
            showSt('\uD83E\uDDF3\u2B07 Scaricamento ' + tipo + '\u2026', 50);
            setDis(true);
            var ok = await dlPdf(pdfU, fn);
            if (!ok && isQ) { showSt('\u26A0\uFE0F Apertura in nuova scheda\u2026', 70); window.open(pdfU, '_blank'); ok = true; }
            showSt(ok ? '\u2705 ' + fn : '\u274C Errore nel download.', 100);
            setDis(false); return;
        }
    }

    console.log('[Cassetto_Utility] v' + VERSION + ' caricato');

})();
