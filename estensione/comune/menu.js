/**
 * Cassetto_Utility - menu dell'estensione
 *
 * Il popup è il punto di comando: contiene i salti e le impostazioni.
 * Non esegue nulla da sé, perché da qui non si vede la pagina del cassetto:
 * manda un messaggio al content script, che sa in che pagina si trova.
 *
 * Nel menu non ci sono gli scarichi né i report. Non è una dimenticanza: nel
 * cassetto quei comandi cambiano da pagina a pagina - l'elenco F24 offre cose
 * che il dettaglio di una CU non ha - e un popup non sa quale pagina sia
 * aperta senza andarglielo a chiedere. Un elenco di pulsanti per metà spenti
 * dice meno di una barra che mostra solo quelli veri.
 *
 * L'avanzamento non vive qui. Un popup si chiude appena perde il fuoco, e con
 * esso sparirebbe la barra di un lavoro che può durare minuti.
 */
(function () {
    'use strict';

    var CANALE = 'cassetto-utility';
    var PORTALE = 'https://cassetto.agenziaentrate.gov.it/';
    var PREFISSO = 'CU_';

    var api = (typeof browser !== 'undefined' && browser.storage) ? browser : chrome;

    /*
     * Copia ridotta delle palette dello userscript: qui servono solo i colori
     * della chrome del menu. Tenere in piedi due elenchi non è bello, ma il
     * popup non può leggere le variabili di Cassetto_Utility.user.js e un file
     * condiviso richiederebbe un passo di generazione.
     */
    var TEMI = [
        { id: 'ardesia', nome: 'Ardesia e ottone',
          inchiostro: '#22262F', ardesia: '#2E3540', ardesiaChiara: '#59616F',
          carta: '#DDE1E7', cartaTenue: '#9AA2AF', accento: '#C9962F',
          riuscito: '#59916B', errore: '#D26358' },
        { id: 'nordico', nome: 'Notte nordica',
          inchiostro: '#1A202C', ardesia: '#2D3748', ardesiaChiara: '#57637A',
          carta: '#EDF2F7', cartaTenue: '#9BA7B8', accento: '#319795',
          riuscito: '#4FC3BD', errore: '#EE7070' },
        { id: 'navy', nome: 'Blu notte e ambra',
          inchiostro: '#0F172A', ardesia: '#1E293B', ardesiaChiara: '#4A5A72',
          carta: '#F8FAFC', cartaTenue: '#94A3B8', accento: '#F59E0B',
          riuscito: '#22C08D', errore: '#EF6B6B' },
        { id: 'grafite', nome: 'Grafite e menta',
          inchiostro: '#18181B', ardesia: '#27272A', ardesiaChiara: '#52525B',
          carta: '#FAFAFA', cartaTenue: '#A1A1AA', accento: '#10B981',
          riuscito: '#34D07A', errore: '#F26981' }
    ];

    var TEMA_PREDEFINITO = 'ardesia';

    var OPZIONI_PREDEFINITE = {
        quietanzaSeDisponibile: true,
        chiediConferma: true,
        apertura: 'menu'
    };

    var opzioni = Object.assign({}, OPZIONI_PREDEFINITE);
    var tema = TEMA_PREDEFINITO;
    var schedaPortale = null;

    /* ─── Deposito ──────────────────────────────────────────────── */

    /*
     * `chrome.*` vuole una callback, `browser.*` di Firefox restituisce una
     * promessa e la callback la ignora. Chiedere nel modo sbagliato non dà
     * errore: semplicemente non risponde mai, e il menu resterebbe vuoto.
     * Si passa la callback e si guarda anche il valore restituito, così va
     * bene in entrambi i casi; il tempo massimo è l'ultima difesa.
     */
    function chiedi(esegui) {
        return new Promise(function (r) {
            var fatto = false;
            function unaVolta(d) { if (!fatto) { fatto = true; r(d); } }
            var esito;
            try { esito = esegui(unaVolta); }
            catch (e) { unaVolta(undefined); return; }
            if (esito && typeof esito.then === 'function') {
                esito.then(unaVolta, function () { unaVolta(undefined); });
            }
            setTimeout(function () { unaVolta(undefined); }, 3000);
        });
    }

    function leggi(chiavi) {
        return chiedi(function (cb) {
            return api.storage.local.get(chiavi.map(function (c) { return PREFISSO + c; }), cb);
        }).then(function (d) { return d || {}; });
    }

    /*
     * La pagina tiene una copia delle opzioni in memoria e va avvisata, o
     * resterebbe indietro. Le si manda il valore, non l'invito a rileggere:
     * la set() qui sopra è asincrona e non attesa, quindi una rilettura
     * potrebbe arrivare prima che sia stata committata e riportare indietro
     * proprio il valore appena cambiato.
     */
    function scrivi(chiave, valore) {
        var voce = {};
        voce[PREFISSO + chiave] = valore;
        api.storage.local.set(voce);
        if (chiave === 'opzioni') inviaAllaPagina({ tipo: 'opzioni', valore: valore });
    }

    /* ─── Verso la pagina ───────────────────────────────────────── */

    function inviaAllaPagina(messaggio) {
        if (!schedaPortale) return;
        messaggio.canale = CANALE;
        api.tabs.sendMessage(schedaPortale.id, messaggio, function () {
            void api.runtime.lastError;   // scheda non pronta: nulla da fare
        });
    }

    function trovaScheda() {
        return chiedi(function (cb) {
            return api.tabs.query({ active: true, currentWindow: true }, cb);
        }).then(function (schede) {
            var t = schede && schede[0];
            return (t && t.url && t.url.indexOf(PORTALE) === 0) ? t : null;
        });
    }

    /* ─── Disegno ───────────────────────────────────────────────── */

    function applicaTema(id) {
        var t = TEMI.filter(function (x) { return x.id === id; })[0] || TEMI[0];
        tema = t.id;
        var radice = document.documentElement.style;
        radice.setProperty('--inchiostro', t.inchiostro);
        radice.setProperty('--ardesia', t.ardesia);
        radice.setProperty('--ardesia-chiara', t.ardesiaChiara);
        radice.setProperty('--carta', t.carta);
        radice.setProperty('--carta-tenue', t.cartaTenue);
        radice.setProperty('--accento', t.accento);
    }

    /*
     * Lo stato si legge in tre modi insieme: il segno dentro la casella, il
     * colore, e la parola sì o no accanto al titolo.
     */
    function interruttore(chiave, titolo, nota) {
        var b = document.createElement('button');
        b.className = 'opzione';
        b.setAttribute('role', 'checkbox');
        b.innerHTML = '<span class="casella" aria-hidden="true">✓</span>' +
                      '<span><span class="nome"></span><span class="nota"></span></span>';

        var nome = b.querySelector('.nome');
        var stato = document.createElement('span');
        stato.className = 'stato';

        function aggiorna() {
            var acceso = !!opzioni[chiave];
            b.setAttribute('aria-checked', String(acceso));
            nome.textContent = titolo;
            stato.textContent = acceso ? 'sì' : 'no';
            nome.appendChild(stato);
        }

        b.querySelector('.nota').textContent = nota;
        aggiorna();

        b.onclick = function () {
            opzioni[chiave] = !opzioni[chiave];
            aggiorna();
            scrivi('opzioni', opzioni);
        };
        return b;
    }

    function disegnaImpostazioni() {
        var scarico = document.getElementById('opzioniScarico');
        scarico.textContent = '';
        scarico.appendChild(interruttore('quietanzaSeDisponibile',
            'Preferisci la quietanza alla copia',
            'Per gli F24 quietanzati scarica la ricevuta di pagamento. Spento, scarica sempre la copia del modello.'));
        scarico.appendChild(interruttore('chiediConferma',
            'Chiedi conferma oltre i 15 documenti',
            'Un lotto lungo occupa il browser per minuti e non si può interrompere.'));

        var apertura = document.getElementById('apertura');
        apertura.textContent = '';
        [['menu', 'Menu'], ['barra', 'Barra in pagina']].forEach(function (v) {
            var b = document.createElement('button');
            b.className = 'scelta';
            b.setAttribute('role', 'radio');
            b.setAttribute('aria-checked', String(opzioni.apertura === v[0]));
            b.textContent = v[1];
            b.onclick = function () {
                opzioni.apertura = v[0];
                scrivi('opzioni', opzioni);
                disegnaImpostazioni();
            };
            apertura.appendChild(b);
        });

        var elenco = document.getElementById('temi');
        elenco.textContent = '';
        TEMI.forEach(function (t) {
            var b = document.createElement('button');
            b.className = 'scelta';
            b.setAttribute('role', 'radio');
            b.setAttribute('aria-checked', String(t.id === tema));
            b.title = t.nome;
            var campione = document.createElement('span');
            campione.className = 'campione';
            [t.inchiostro, t.accento, t.riuscito, t.errore].forEach(function (colore) {
                var tacca = document.createElement('span');
                tacca.style.background = colore;
                campione.appendChild(tacca);
            });
            b.appendChild(campione);
            b.appendChild(document.createTextNode(t.nome));
            b.onclick = function () {
                applicaTema(t.id);
                scrivi('tema', t.id);
                inviaAllaPagina({ tipo: 'tema', valore: t.id });
                disegnaImpostazioni();
            };
            elenco.appendChild(b);
        });
    }

    function mostraAvviso(testo) {
        var a = document.getElementById('avviso');
        a.textContent = testo;
        a.hidden = false;
        document.querySelectorAll('.comando').forEach(function (b) { b.disabled = true; });
    }

    /* ─── Avvio ─────────────────────────────────────────────────── */

    /*
     * `version_name` è la forma leggibile ("0.09 beta"), quella che la barra
     * mostra come "0.09β"; `version` è la forma numerica che pretendono gli
     * store. Chrome dichiara entrambe, Firefox solo la seconda: si preferisce
     * la prima quando c'è, così le due superfici dicono la stessa cosa.
     */
    var manifest = api.runtime.getManifest ? api.runtime.getManifest() : {};
    document.getElementById('versione').textContent =
        manifest.version_name || (manifest.version ? 'v' + manifest.version : '');

    document.querySelectorAll('.comando').forEach(function (b) {
        b.onclick = function () {
            inviaAllaPagina({ tipo: 'comando', comando: b.dataset.comando });
            window.close();   // quello che succede si guarda nella pagina, non qui
        };
    });

    Promise.all([leggi(['tema', 'opzioni']), trovaScheda()]).then(function (r) {
        var dati = r[0];
        schedaPortale = r[1];

        applicaTema(dati[PREFISSO + 'tema'] || TEMA_PREDEFINITO);
        var salvate = dati[PREFISSO + 'opzioni'] || {};
        Object.keys(OPZIONI_PREDEFINITE).forEach(function (k) {
            opzioni[k] = (salvate[k] === undefined) ? OPZIONI_PREDEFINITE[k] : salvate[k];
        });

        disegnaImpostazioni();

        if (!schedaPortale) {
            mostraAvviso('I comandi funzionano sulle pagine del cassetto fiscale. ' +
                         'Apri il cassetto in questa scheda e riprova.');
        }
    });
})();
