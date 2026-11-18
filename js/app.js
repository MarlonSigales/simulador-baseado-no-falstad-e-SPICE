/**
 * © 2026 Simulador de Circuitos (Falstad + SPICE) — Marlon Sigales. Todos os direitos reservados; copiar, reproduzir ou alterar exige autorização do autor (ver LICENSE).
 *
 * Liga tudo: menu de componentes, laço da simulação em tempo real, osciloscópio, propriedades, biblioteca SPICE e arquivos.
 */

'use strict';

(function () {
    const $ = (s, r = document) => r.querySelector(s);
    const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const C = window.Componentes, S = window.Spice, Circ = window.Circuito, Ex = window.Exemplos;
    const CHAVE_CIRCUITO = 'simfs-circuito-v1', CHAVE_BIB = 'simfs-biblioteca-v1';
    const CORES_OSC = ['#a8e156', '#ffd166', '#ff8a80', '#7cc4ff']; // claras, para o fundo escuro do osciloscópio
    const VELOCIDADES = [
        ['1', 'Tempo real (1×)'], ['0.1', 'Lenta (0,1×)'], ['0.01', 'Muito lenta (0,01×)'], ['0.001', 'Câmera lenta (0,001×)'],
        ['0.0001', 'Ultra lenta (0,0001×)'], ['max', 'Máxima (o quanto der)']
    ];
    const salvarLS = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } };
    const lerLS = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } };

    const App = {
        lib: new window.Biblioteca(),
        motor: null, net: null,
        rodando: true,
        dt: 10e-6,
        velocidade: '0.01',
        fatorCorrente: 4000,
        mostrarCorrente: true,
        escalaV: 5,
        osc: [], oscN: 5, oscCont: 0, _ppa: 5, oscTdiv: 'auto', oscTrig: 'livre', oscNivel: '', oscCongelado: false,
        desfazer: [], refazer: [],
        avisos: [], erro: '',
        tReal: 0, tSimJanela: 0, razao: 0,

        iniciar() {
            this.carregarBiblioteca();
            this.ed = new window.Editor($('#tela'), this);
            this.montarMenu();
            this.montarControles();
            this.montarBiblioteca();
            const salvo = lerLS(CHAVE_CIRCUITO);
            if (salvo && Array.isArray(salvo.els) && salvo.els.length) this.abrirDados(salvo, true);
            else this.abrirExemplo('rc');
            this.ligarTeclas();
            this.ligarMenuMovel();
            let ant = performance.now();
            const quadro = (agora) => {
                const dtReal = Math.min(0.1, (agora - ant) / 1000); ant = agora;
                this.passoQuadro(dtReal);
                this.ed.animarCorrente(this.rodando ? dtReal : 0);
                this.ed.desenhar();
                this.desenharOsc();
                requestAnimationFrame(quadro);
            };
            requestAnimationFrame(quadro);
        },

        // ------------------------------------------------------------ biblioteca
        carregarBiblioteca() {
            Object.entries(window.MODELOS_EMBUTIDOS || {}).forEach(([k, t]) => this.lib.adicionar(k, t, 'embutido'));
            const salva = lerLS(CHAVE_BIB);
            if (salva) this.lib.importar(salva);
            // na web (GitHub Pages), lê também a pasta modelos/ do repositório pelo índice
            if (/^https?:/.test(location.protocol)) {
                fetch('modelos/indice.json', { cache: 'no-cache' }).then((r) => r.ok ? r.json() : null).then((ind) => {
                    if (!ind || !Array.isArray(ind.arquivos)) return;
                    return Promise.all(ind.arquivos.map((f) => fetch('modelos/' + encodeURIComponent(f)).then((r) => r.ok ? r.text() : null)
                        .then((t) => { if (t) this.lib.adicionar(f, t, 'repositório'); })));
                }).then(() => { this.listarBiblioteca(); this.reconstruir(); }).catch(() => {});
            }
        },
        guardarBiblioteca() {
            const o = this.lib.exportar();
            Object.keys(o).forEach((k) => { if (o[k].origem !== 'pasta' && o[k].origem !== 'colado') delete o[k]; });
            if (!salvarLS(CHAVE_BIB, o)) this.aviso('A biblioteca ficou grande demais para guardar no navegador: ela vale só nesta sessão.');
        },

        // ------------------------------------------------------------ circuito
        novoId(tipo) {
            const letra = { fio: 'W', resistor: 'R', capacitor: 'C', indutor: 'L', chave: 'S', fonteV: 'V', trilho: 'V', fonteI: 'I', terra: 'GND', diodo: 'D', zener: 'DZ', led: 'LED', potenciometro: 'P', eletrolitico: 'C', chave2: 'S', transformador: 'T', lampada: 'LP', rele: 'K', amperimetro: 'AM', entradaLogica: 'IN', saidaLogica: 'OUT', rotuloNo: 'LBL', texto: 'TXT', porta_not: 'U', porta_and: 'U', porta_nand: 'U', porta_or: 'U', porta_nor: 'U', porta_xor: 'U', porta_xnor: 'U', npn: 'Q', pnp: 'Q', nmos: 'M', pmos: 'M', ampop: 'U', caixa: 'X', voltimetro: 'VM' }[tipo] || 'E';
            let n = 1;
            const usados = new Set(this.ed.els.map((e) => e.id));
            while (usados.has(letra + n)) n++;
            return letra + n;
        },
        novo(tipo, geo) {
            const d = C.DEFS[tipo];
            const el = Object.assign({ id: this.novoId(tipo), tipo, props: JSON.parse(JSON.stringify(d.props || {})) }, geo);
            this.ed.els.push(el);
            return el;
        },
        excluir(id) {
            this.ed.els = this.ed.els.filter((e) => e.id !== id);
            this.osc = this.osc.filter((o) => o.el !== id);
            this.ed.sels.delete(id);
            if (this.ed.sel === id) { this.ed.sel = null; this.selecionou(null); }
            this.mudouTopologia();
        },
        antes(snapshot) {
            this.desfazer.push(snapshot || JSON.stringify(this.ed.els));
            if (this.desfazer.length > 80) this.desfazer.shift();
            this.refazer = [];
        },
        voltar(lista, outra) {
            if (!lista.length) return;
            outra.push(JSON.stringify(this.ed.els));
            this.ed.els = JSON.parse(lista.pop());
            this.ed.selecionarSo(null); this.selecionou(null);
            this.mudouTopologia();
        },
        mudouTopologia() { this.reconstruir(); this.guardar(); },
        mudouValor(el) { this.reconstruir(); this.guardar(); if (el && el.id === this.ed.sel) this.mostrarPropriedades(el); },

        reconstruir() {
            const estados = this.motor ? this.motor.estados() : null;
            const t = this.motor ? this.motor.t : 0;
            this.erro = '';
            try {
                this.net = Circ.construir(this.ed.els, this.lib);
                this.motor = new window.MotorSim.Motor(this.net, estados);
                this.motor.t = t;
                this.avisos = this.net.avisos;
            } catch (e) {
                this.motor = null; this.erro = e.message;
            }
            this.mostrarAvisos();
        },
        reiniciar() {
            this.motor = null;
            this.limparOsc();
            this.reconstruir();
        },

        /** Tensões nos pinos e corrente do elemento, para desenhar. */
        info(el) {
            const vazio = { v: [0, 0, 0, 0, 0, 0, 0, 0], i: 0, cor: (v) => this.cor(v) };
            if (!this.motor || !this.net) return vazio;
            const nos = this.net.pinos[el.id] || [];
            const v = nos.map((n) => this.motor.v(n));
            let i = 0;
            const nome = this.net.primDe[el.id];
            const p = nome && this.motor.prim(nome);
            const soma = this.net.correnteDe && this.net.correnteDe[el.id];
            if (soma) soma.forEach((nm) => { const q = this.motor.prim(nm); if (q) i += q.i; }); // série + paralelos = corrente no terminal
            else if (p) i = p.i;
            const pp = this.net.papeis && this.net.papeis[el.id];
            const prims = {};
            if (pp) Object.entries(pp).forEach(([k, nm]) => { prims[k] = this.motor.prim(nm); });
            return { v, i, cor: vazio.cor, prim: p, prims };
        },
        /**
         * Tensão de um bipolo como no Falstad: v(p0) − v(p1), de modo que V·I > 0 = potência consumida.
         * Fontes e voltímetro: v(p1) − v(p0) (o + fica em p1), e V·I > 0 = potência fornecida.
         */
        tensaoEl(el, inf) {
            const v = inf.v[0] - inf.v[1];
            return C.DEFS[el.tipo].tensaoInvertida ? -v : v;
        },
        cor(v) {
            const f = Math.max(-1, Math.min(1, v / (this.escalaV || 5)));
            const cinza = [122, 138, 136];
            const alvo = f >= 0 ? [22, 160, 70] : [205, 40, 40];
            const a = Math.abs(f);
            const c = cinza.map((x, k) => Math.round(x + (alvo[k] - x) * a));
            return `rgb(${c[0]},${c[1]},${c[2]})`;
        },

        // ------------------------------------------------------------ laço da simulação
        passoQuadro(dtReal) {
            if (!this.rodando || !this.motor || this.erro) { this.mostrarTempo(); return; }
            const inicio = performance.now();
            let passos;
            if (this.velocidade === 'max') passos = 1e9;
            else { this.acumulado = (this.acumulado || 0) + dtReal * parseFloat(this.velocidade) / this.dt; passos = Math.floor(this.acumulado); this.acumulado -= passos; }
            let feitos = 0;
            try {
                for (; feitos < passos; feitos++) {
                    this.motor.passo(this.dt);
                    this.amostrarOsc();
                    if ((feitos & 15) === 15 && performance.now() - inicio > 14) break;
                }
            } catch (e) {
                this.erro = e.message; this.rodando = false; this.atualizarBotaoRodar(); this.mostrarAvisos();
            }
            if (feitos < passos && this.velocidade !== 'max') this.acumulado = 0; // não acumula atraso
            this.tSimJanela += feitos * this.dt; this.tReal += dtReal;
            if (this.tReal > 0.5) { this.razao = this.tSimJanela / this.tReal; this.tReal = 0; this.tSimJanela = 0; }
            // escala de cores segue a maior tensão do circuito (suavizada)
            let max = 1;
            for (let k = 1; k < this.net.nNos; k++) max = Math.max(max, Math.abs(this.motor.v(k)));
            this.escalaV += (max - this.escalaV) * 0.05;
            this.mostrarTempo();
        },
        mostrarTempo() {
            const t = this.motor ? this.motor.t : 0;
            $('#tempo-sim').textContent = S.formatar(t, 's');
            $('#razao').textContent = this.rodando && this.razao ? '×' + (this.razao >= 0.01 ? this.razao.toFixed(this.razao >= 1 ? 2 : 3) : this.razao.toExponential(1)).replace('.', ',') : '—';
        },

        // ------------------------------------------------------------ osciloscópio
        // Grade de 10 × 8 divisões. Cada traço tem grandeza (V, I, P), escala por divisão (auto ou fixa) e posição.
        // Todos os traços guardam as amostras juntos (mesmo índice = mesmo instante), alinhados pela direita.
        adicionarOsc(el, g, conf) {
            if (this.osc.some((o) => o.el === el.id && o.g === g)) return;
            if (this.osc.length >= 4) this.osc.shift();
            const usadas = this.osc.map((o) => o.cor);
            const len = this.osc.length ? this.osc[0].dados.length : 0;
            this.osc.push(Object.assign({ el: el.id, g, cor: CORES_OSC.find((c) => !usadas.includes(c)) || CORES_OSC[0], escala: 'auto', pos: 0 }, conf || {}, { dados: new Array(len).fill(NaN) }));
            this.listarOsc();
        },
        valorOsc(o) {
            const el = this.ed.el(o.el);
            if (!el) return NaN;
            const inf = this.info(el);
            const v = C.DEFS[el.tipo].bipolo ? this.tensaoEl(el, inf) : inf.v[0];
            if (o.g === 'I') return inf.i;
            if (o.g === 'P') return Math.abs(v * inf.i);
            return v;
        },
        /** Passos por amostra: com tempo/div fixo, sai da largura da tela (1 amostra por pixel). */
        passosPorAmostra() {
            if (this.oscTdiv === 'auto' || !this.oscTdiv) return this.oscN || 5;
            const w = Math.max(100, Math.floor(($('#osc').parentElement.clientWidth) || 600));
            return Math.max(1, Math.floor(parseFloat(this.oscTdiv) * 10 / (w * this.dt)));
        },
        /** Amostras na tela: com tempo/div fixo, as que cabem em exatamente 10 divisões. */
        amostrasNaTela(w) {
            if (this.oscTdiv === 'auto' || !this.oscTdiv) return Math.max(2, Math.floor(w));
            return Math.max(2, Math.round(parseFloat(this.oscTdiv) * 10 / (this._ppa * this.dt)));
        },
        amostrarOsc() {
            if (!this.osc.length || this.oscCongelado) return;
            if (++this.oscCont < this._ppa) return;
            this.oscCont = 0;
            this.osc.forEach((o) => { o.dados.push(this.valorOsc(o)); if (o.dados.length > 20000) o.dados.splice(0, o.dados.length - 20000); });
        },
        limparOsc() { this.osc.forEach((o) => { o.dados = []; }); this.oscCont = 0; },
        unidade: (g) => (g === 'I' ? 'A' : g === 'P' ? 'W' : 'V'),
        listarOsc() {
            const box = $('#osc-traços');
            if (!this.osc.length) { box.innerHTML = '<p class="muted">Selecione um componente e clique em “No osciloscópio” (V, I ou P).</p>'; return; }
            const escalas = (u) => ['auto', ...[1e-6, 2e-6, 5e-6, 1e-5, 2e-5, 5e-5, 1e-4, 2e-4, 5e-4, 1e-3, 2e-3, 5e-3, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100]]
                .map((v) => `<option value="${v}">${v === 'auto' ? 'automática' : S.formatar(v, u) + '/div'}</option>`).join('');
            box.innerHTML = `<table class="osc-tabela"><thead><tr><th></th><th>Componente</th><th>Grandeza</th><th>Escala</th><th>Posição (div)</th><th>Medidas na tela</th><th></th></tr></thead><tbody>
                ${this.osc.map((o, i) => `<tr data-traco="${i}">
                    <td><span class="osc-cor" style="background:${o.cor}"></span></td>
                    <td><b>${esc(o.el)}</b></td>
                    <td><select data-osc="g"><option value="V" ${o.g === 'V' ? 'selected' : ''}>Tensão</option><option value="I" ${o.g === 'I' ? 'selected' : ''}>Corrente</option><option value="P" ${o.g === 'P' ? 'selected' : ''}>Potência</option></select></td>
                    <td><select data-osc="escala">${escalas(this.unidade(o.g))}</select></td>
                    <td><input type="number" data-osc="pos" value="${o.pos}" step="0.5" min="-4" max="4"></td>
                    <td class="osc-medidas" data-medidas="${i}">—</td>
                    <td><button type="button" class="link-botao" data-tirar-osc="${i}" title="Tirar do osciloscópio">✕</button></td></tr>`).join('')}
                </tbody></table>`;
            box.querySelectorAll('tr[data-traco]').forEach((tr) => {
                const o = this.osc[+tr.dataset.traco];
                tr.querySelector('[data-osc="escala"]').value = String(o.escala);
                tr.querySelectorAll('[data-osc]').forEach((inp) => inp.addEventListener('change', () => {
                    const k = inp.dataset.osc;
                    if (k === 'g') { o.g = inp.value; o.dados = o.dados.map(() => NaN); o.escala = 'auto'; this.listarOsc(); }
                    else if (k === 'escala') o.escala = inp.value === 'auto' ? 'auto' : parseFloat(inp.value);
                    else o.pos = Math.max(-4, Math.min(4, parseFloat(inp.value) || 0));
                    this.guardar();
                }));
            });
        },
        /** Índice inicial da janela: com disparo, a última borda que ainda deixa a tela cheia. */
        inicioJanela(d, n) {
            let ini = Math.max(0, d.length - n);
            if (this.oscTrig === 'livre' || !this.osc.length) return ini;
            const fin = d.filter(isFinite);
            if (fin.length < 4) return ini;
            const nivel = this.oscNivel === '' || this.oscNivel === undefined || isNaN(S.valor(this.oscNivel))
                ? (Math.max(...fin) + Math.min(...fin)) / 2 : S.valor(this.oscNivel);
            const sobe = this.oscTrig === 'subida';
            for (let i = d.length - n; i > Math.max(1, d.length - 3 * n); i--) {
                if (sobe ? (d[i - 1] < nivel && d[i] >= nivel) : (d[i - 1] > nivel && d[i] <= nivel)) return i;
            }
            return ini;
        },
        medidas(d) {
            const f = d.filter(isFinite);
            if (!f.length) return null;
            const max = Math.max(...f), min = Math.min(...f);
            const media = f.reduce((a, b) => a + b, 0) / f.length;
            const rms = Math.sqrt(f.reduce((a, b) => a + b * b, 0) / f.length);
            // frequência: cruzamentos da média subindo (com histerese de 10 % do pico a pico)
            const h = (max - min) * 0.1, idx = [];
            let baixo = false;
            f.forEach((x, i) => { if (x < media - h) baixo = true; else if (baixo && x > media + h) { idx.push(i); baixo = false; } });
            const amostraT = this._ppa * this.dt;
            const freq = idx.length >= 2 && max - min > 1e-12 ? (idx.length - 1) / ((idx[idx.length - 1] - idx[0]) * amostraT) : NaN;
            return { max, min, pp: max - min, media, rms, freq };
        },
        escalaAuto(lim) {
            // menor 1-2-5 que põe o pico dentro de ±4 divisões
            const alvo = Math.max(lim, 1e-12) / 4;
            const p = Math.pow(10, Math.floor(Math.log10(alvo)));
            for (const m of [1, 2, 5, 10]) if (m * p >= alvo) return m * p;
            return 10 * p;
        },
        desenharOsc() {
            const cv = $('#osc'), wrap = cv.parentElement;
            const dpr = window.devicePixelRatio || 1, w = wrap.clientWidth, h = wrap.clientHeight;
            if (!w || !h) return;
            if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); } // tamanho na tela só pelo CSS
            this._ppa = this.passosPorAmostra();
            const g = cv.getContext('2d');
            g.setTransform(dpr, 0, 0, dpr, 0, 0);
            g.fillStyle = '#0d2b2c'; g.fillRect(0, 0, w, h);
            const DX = 10, DY = 8;
            g.strokeStyle = 'rgba(255,255,255,.09)'; g.lineWidth = 1;
            for (let i = 1; i < DX; i++) { g.beginPath(); g.moveTo(i * w / DX, 0); g.lineTo(i * w / DX, h); g.stroke(); }
            for (let i = 1; i < DY; i++) { g.beginPath(); g.moveTo(0, i * h / DY); g.lineTo(w, i * h / DY); g.stroke(); }
            g.strokeStyle = 'rgba(255,255,255,.25)'; g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.moveTo(w / 2, 0); g.lineTo(w / 2, h); g.stroke();
            const n = this.amostrasNaTela(w);
            const ref = this.osc[0] ? this.osc[0].dados : [];
            const ini = this.inicioJanela(ref, n);
            g.font = '11px Segoe UI, Roboto, Arial'; g.textBaseline = 'top';
            this.osc.forEach((o, k) => {
                const d = o.dados.slice(ini, ini + n);
                const fin = d.filter(isFinite);
                if (!fin.length) return;
                const lim = Math.max(...fin.map(Math.abs));
                const div = o.escala === 'auto' ? this.escalaAuto(lim) : o.escala;
                const y = (x) => h / 2 - (x / div + o.pos) * (h / DY);
                g.strokeStyle = o.cor; g.lineWidth = 1.6; g.beginPath();
                let caneta = false;
                d.forEach((x, i) => { if (!isFinite(x)) { caneta = false; return; } const px = i * w / n, py = y(x); caneta ? g.lineTo(px, py) : g.moveTo(px, py); caneta = true; });
                g.stroke();
                // marcador do zero do traço
                g.fillStyle = o.cor; g.beginPath(); g.moveTo(0, y(0) - 4); g.lineTo(6, y(0)); g.lineTo(0, y(0) + 4); g.fill();
                const u = this.unidade(o.g);
                g.fillText(`${o.el} ${o.g}: ${S.formatar(d[d.length - 1], u)}   ${S.formatar(div, u)}/div${o.escala === 'auto' ? ' (auto)' : ''}`, 10, 4 + k * 14);
                const m = this.medidas(d), cel = document.querySelector(`[data-medidas="${k}"]`);
                if (cel && m && (this._medT || 0) < performance.now() - 300) {
                    cel.textContent = `pp ${S.formatar(m.pp, u)} · méd ${S.formatar(m.media, u)} · RMS ${S.formatar(m.rms, u)}${isFinite(m.freq) ? ' · ' + S.formatar(m.freq, 'Hz') : ''}`;
                }
            });
            if ((this._medT || 0) < performance.now() - 300) this._medT = performance.now();
            g.fillStyle = 'rgba(255,255,255,.6)'; g.textBaseline = 'bottom'; g.textAlign = 'right';
            const tdiv = n * this._ppa * this.dt / DX;
            g.fillText(`${S.formatar(tdiv, 's')}/div${this.oscTdiv === 'auto' ? ' (auto)' : ''}${this.oscTrig !== 'livre' ? ' · disparo ' + this.oscTrig : ''}${this.oscCongelado ? ' · CONGELADO' : ''}`, w - 6, h - 4);
            g.textAlign = 'left';
        },

        // ------------------------------------------------------------ painéis
        montarMenu() {
            const nav = $('#sidebar-nav');
            const html = [`<span class="sidebar-grupo">Modo</span>
                <button type="button" class="sidebar-link ferramenta" data-ferramenta="selecionar"><span class="sidebar-num">↖</span>Selecionar e mover <kbd>Esc</kbd></button>`];
            C.GRUPOS.forEach((gr) => {
                const itens = Object.entries(C.DEFS).filter(([, d]) => d.grupo === gr.id);
                if (!itens.length) return;
                html.push(`<span class="sidebar-grupo">${esc(gr.nome)}</span>`);
                itens.forEach(([k, d]) => html.push(`<button type="button" class="sidebar-link ferramenta" data-ferramenta="${k}">
                    <span class="sidebar-num">${esc(d.icone || (d.curto || d.nome)[0])}</span>${esc(d.curto || d.nome)}${d.tecla ? ` <kbd>${d.tecla}</kbd>` : ''}</button>`));
            });
            html.push(`<span class="sidebar-grupo">Em breve</span>
                <span class="sidebar-link sidebar-futuro" title="Bloco que roda firmware em C (ver ARQUITETURA.md)"><span class="sidebar-num">μ</span>Microcontrolador (C)</span>`);
            nav.innerHTML = html.join('');
            nav.addEventListener('click', (ev) => {
                const b = ev.target.closest('[data-ferramenta]');
                if (b) { this.escolherFerramenta(b.dataset.ferramenta); document.body.classList.remove('sidebar-aberta'); }
            });
            this.escolherFerramenta('selecionar');
            const sel = $('#exemplos');
            sel.innerHTML = '<option value="">Abrir exemplo…</option>' + Ex.EXEMPLOS.map((e) => `<option value="${e.id}">${esc(e.nome)}</option>`).join('');
            sel.addEventListener('change', () => { if (sel.value) { this.abrirExemplo(sel.value); sel.value = ''; document.body.classList.remove('sidebar-aberta'); } });
        },
        escolherFerramenta(f) {
            this.ed.ferramenta = f;
            document.querySelectorAll('.ferramenta').forEach((b) => b.classList.toggle('ativa', b.dataset.ferramenta === f));
            $('#modo').textContent = f === 'selecionar' ? 'Selecionar: arraste componentes, pontas e o fundo; clique na chave para abrir/fechar.'
                : `${C.DEFS[f].nome}: ${C.DEFS[f].bipolo ? 'arraste na grade de uma ponta à outra.' : 'clique onde quer pôr.'} Esc volta a selecionar.`;
        },

        montarControles() {
            const vel = $('#velocidade');
            vel.innerHTML = VELOCIDADES.map(([v, t]) => `<option value="${v}">${t}</option>`).join('');
            vel.value = this.velocidade;
            vel.addEventListener('change', () => { this.velocidade = vel.value; this.acumulado = 0; this.guardar(); });
            const dt = $('#passo');
            dt.addEventListener('change', () => {
                const v = S.valor(dt.value);
                if (v > 0 && v < 1) { this.dt = v; this.guardar(); } else this.aviso('Passo de tempo inválido (ex.: 10u, 1m).');
                dt.value = S.formatar(this.dt, 's').replace(/ /g, '');
            });
            const cor = $('#vel-corrente');
            cor.addEventListener('input', () => { this.fatorCorrente = Math.pow(10, parseFloat(cor.value)); });
            $('#mostrar-corrente').addEventListener('change', (ev) => { this.mostrarCorrente = ev.target.checked; });
            const td = $('#osc-tdiv');
            td.innerHTML = '<option value="auto">automático</option>' + [1e-6, 2e-6, 5e-6, 1e-5, 2e-5, 5e-5, 1e-4, 2e-4, 5e-4, 1e-3, 2e-3, 5e-3, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5]
                .map((v) => `<option value="${v}">${S.formatar(v, 's')}/div</option>`).join('');
            td.addEventListener('change', () => { this.oscTdiv = td.value; this.limparOsc(); this.guardar(); });
            $('#osc-trig').addEventListener('change', (ev) => { this.oscTrig = ev.target.value; this.guardar(); });
            $('#osc-nivel').addEventListener('change', (ev) => { this.oscNivel = ev.target.value.trim(); this.guardar(); });
            document.addEventListener('click', (ev) => {
                const a = ev.target.closest('[data-acao]');
                if (a) this.acao(a.dataset.acao, a);
                const t = ev.target.closest('[data-tirar-osc]');
                if (t) { this.osc.splice(+t.dataset.tirarOsc, 1); this.listarOsc(); }
            });
            $('#abrir-json').addEventListener('change', (ev) => this.abrirArquivoCircuito(ev.target));
            this.listarOsc();
        },
        atualizarBotaoRodar() {
            const b = $('[data-acao="rodar"]');
            b.textContent = this.rodando ? '⏸ Pausar' : '▶ Executar';
            b.classList.toggle('btn-primary', !this.rodando);
        },
        acao(a, alvo) {
            const sel = this.ed.selecionado();
            switch (a) {
                case 'rodar': this.rodando = !this.rodando; if (this.rodando && this.erro) this.reconstruir(); this.atualizarBotaoRodar(); break;
                case 'passo': if (this.motor && !this.erro) { try { this.motor.passo(this.dt); this.amostrarOsc(); } catch (e) { this.erro = e.message; this.mostrarAvisos(); } } break;
                case 'reiniciar': this.reiniciar(); break;
                case 'zoom-mais': this.ed.zoom(1.25); break;
                case 'zoom-menos': this.ed.zoom(0.8); break;
                case 'centralizar': this.enquadrar(); break;
                case 'area-grande': document.body.classList.toggle('area-grande'); setTimeout(() => this.enquadrar(), 50); break;
                case 'tela-cheia': {
                    const c = $('.sim-tela-card');
                    if (document.fullscreenElement) document.exitFullscreen(); else if (c.requestFullscreen) c.requestFullscreen().then(() => setTimeout(() => this.enquadrar(), 100)).catch(() => this.aviso('O navegador não deixou abrir em tela cheia.'));
                    break;
                }
                case 'desfazer': this.voltar(this.desfazer, this.refazer); break;
                case 'refazer': this.voltar(this.refazer, this.desfazer); break;
                case 'novo': if (confirm('Começar um circuito novo? O atual será apagado (salve antes se quiser).')) { this.antes(); this.ed.els = []; this.osc = []; this.listarOsc(); this.reiniciar(); this.guardar(); } break;
                case 'salvar': this.baixar(`circuito-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(this.dados(), null, 1), 'application/json'); break;
                case 'abrir': $('#abrir-json').click(); break;
                case 'exportar-spice': this.baixar('circuito.cir', Circ.exportarSpice(this.ed.els, this.lib, { passo: String(this.dt), tempo: String(Math.max(this.dt * 2000, 0.02)) }), 'text/plain'); break;
                case 'girar': if (sel && !C.DEFS[sel.tipo].bipolo) { this.antes(); sel.rot = ((sel.rot || 0) + 1) % 4; this.mudouTopologia(); } else if (sel) { this.antes(); sel.p.reverse(); this.mudouTopologia(); } break;
                case 'excluir': this.excluirSelecao(); break;
                case 'copiar': this.copiar(); break;
                case 'recortar': if (this.copiar()) this.excluirSelecao(); break;
                case 'colar': this.colar(); break;
                case 'duplicar': if (this.copiar()) this.colar(); break;
                case 'tudo': this.ed.sels = new Set(this.ed.els.map((e) => e.id)); this.ed.sel = null; this.selecionou(null); break;
                case 'osc-v': if (sel) this.adicionarOsc(sel, 'V'); break;
                case 'osc-i': if (sel) this.adicionarOsc(sel, 'I'); break;
                case 'osc-limpar': this.osc = []; this.listarOsc(); break;
                case 'osc-apagar': this.limparOsc(); break;
                case 'osc-congelar': this.oscCongelado = !this.oscCongelado; alvo.textContent = this.oscCongelado ? '▶ Continuar' : '❄ Congelar'; break;
                case 'osc-p': if (sel) this.adicionarOsc(sel, 'P'); break;
                case 'bib-pasta': $('#bib-pasta').click(); break;
                case 'bib-arquivos': $('#bib-arquivos').click(); break;
                case 'bib-colar': this.colarModelo(); break;
                case 'bib-usar': this.usarDaBiblioteca(alvo.dataset.classe, alvo.dataset.nome); break;
                case 'bib-tirar': this.lib.remover(alvo.dataset.arquivo); this.guardarBiblioteca(); this.listarBiblioteca(); this.reconstruir(); break;
                case 'buscar-modelo': $('#bib-busca').value = alvo.dataset.busca || ''; this.listarBiblioteca(); $('#painel-biblioteca').scrollIntoView({ block: 'nearest' }); $('#bib-busca').focus(); break;
            }
        },

        excluirSelecao() {
            const ids = [...this.ed.sels];
            if (!ids.length) return;
            this.antes();
            this.ed.els = this.ed.els.filter((e) => !this.ed.sels.has(e.id));
            this.osc = this.osc.filter((o) => !this.ed.sels.has(o.el)); this.listarOsc();
            this.ed.selecionarSo(null); this.selecionou(null);
            this.mudouTopologia();
        },
        copiar() {
            const els = this.ed.selecionados();
            if (!els.length) return false;
            this.area = { els: JSON.parse(JSON.stringify(els)), vezes: 0 };
            try { navigator.clipboard && navigator.clipboard.writeText(JSON.stringify({ formato: 'simulador-falstad-spice', els: this.area.els })).catch(() => {}); } catch (e) { /* sem área de transferência */ }
            this.aviso(`${els.length} componente(s) copiado(s).`);
            return true;
        },
        colar() {
            if (!this.area || !this.area.els.length) return;
            this.antes();
            this.area.vezes++;
            const d = 2 * C.GRADE * this.area.vezes;
            const novos = this.area.els.map((e) => {
                const c = JSON.parse(JSON.stringify(e));
                c.id = this.novoId(c.tipo);
                this.ed.els.push(c); // já entra na lista para o próximo id não repetir
                return c;
            });
            this.ed.deslocar(novos, d, d);
            this.ed.sels = new Set(novos.map((e) => e.id)); this.ed.sel = novos.length === 1 ? novos[0].id : null;
            this.selecionou(this.ed.selecionado());
            this.mudouTopologia();
        },
        moverSelecao(dx, dy) {
            const els = this.ed.selecionados();
            if (!els.length) return;
            this.antes(); this.ed.deslocar(els, dx, dy); this.mudouTopologia();
        },

        selecionou(el, focar) {
            this.mostrarPropriedades(el);
            if (focar && el) $('#painel-prop').scrollIntoView({ block: 'nearest' });
        },
        mostrarPropriedades(el) {
            const box = $('#prop');
            const n = this.ed ? this.ed.sels.size : 0;
            if (n > 1) {
                box.innerHTML = `<p><b>${n} componentes selecionados</b></p><p class="muted">Arraste um deles para mover todos; setas movem na grade. Ctrl+C copia, Ctrl+D duplica, Delete apaga.</p>
                    <div class="prop-botoes"><button type="button" class="btn btn-secondary btn-sm" data-acao="duplicar">⧉ Duplicar</button><button type="button" class="btn btn-secondary btn-sm btn-perigo" data-acao="excluir">🗑 Excluir</button></div>`;
                return;
            }
            if (!el) { box.innerHTML = '<p class="muted">Clique num componente para ver e editar os valores. Duplo clique também abre aqui.</p>'; return; }
            const d = C.DEFS[el.tipo];
            Object.keys(d.props || {}).forEach((k) => { if (el.props[k] === undefined) el.props[k] = d.props[k]; }); // arquivos antigos: completa com o ideal
            const campos = (d.campos || []).filter((c) => !c.se || c.se(el.props));
            const html = (c) => {
                const id = `campo-${c.k}`;
                const v = el.props[c.k];
                if (c.tipo === 'faixa') return `<label class="campo"><span>${esc(c.r)}: <b data-faixa-txt="${c.k}">${Math.round((parseFloat(v) || 0) * 100)} %</b></span><input type="range" min="0" max="1" step="0.01" id="${id}" data-faixa="${c.k}" value="${esc(v)}"></label>`;
                if (c.tipo === 'bool') return `<label class="campo campo-bool"><input type="checkbox" id="${id}" data-campo="${c.k}" ${v ? 'checked' : ''}> ${esc(c.r)}</label>`;
                if (c.tipo === 'sel') return `<label class="campo"><span>${esc(c.r)}</span><select id="${id}" data-campo="${c.k}">${c.op.map(([o, t]) => `<option value="${esc(o)}" ${o === v ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>`;
                if (c.tipo === 'modelo') {
                    const ms = this.lib.modelosDoTipo(c.tipos);
                    return `<label class="campo"><span>${esc(c.r)}</span><select id="${id}" data-campo="${c.k}"><option value="">(padrão do simulador)</option>
                        ${ms.map((m) => `<option value="${esc(m.nome)}" ${m.nome === String(v).toUpperCase() ? 'selected' : ''}>${esc(m.nome)} — ${esc(m.arquivo)}</option>`).join('')}
                        ${v && !ms.some((m) => m.nome === String(v).toUpperCase()) ? `<option value="${esc(v)}" selected>${esc(v)} (não encontrado)</option>` : ''}</select>
                        <button type="button" class="link-botao" data-acao="buscar-modelo" data-busca="${esc(c.tipos[0])}">🔎 buscar na biblioteca</button></label>`;
                }
                if (c.tipo === 'subckt') {
                    const ss = this.lib.subckts();
                    const s = v && this.lib.subckt(v);
                    return `<label class="campo"><span>${esc(c.r)}</span><select id="${id}" data-campo="${c.k}"><option value="">(sem modelo: caixa com pinos)</option>
                        ${ss.map((x) => `<option value="${esc(x.nome)}" ${x.nome === String(v).toUpperCase() ? 'selected' : ''}>${esc(x.nome)} (${x.nos.length} pinos)</option>`).join('')}</select>
                        <button type="button" class="link-botao" data-acao="buscar-modelo" data-busca="subckt">🔎 buscar na biblioteca</button></label>
                        ${s ? `<p class="muted">Pinos: ${s.pinos.map(esc).join(', ')} · arquivo ${esc(s.arquivo)}</p>${s.suporte.ok ? '<p class="ok-txt">✔ roda no tempo real</p>' : `<p class="aviso-txt">⚠ no tempo real faltam: ${esc(s.suporte.falta.join(', '))}</p>`}` : ''}`;
                }
                return `<label class="campo"><span>${esc(c.r)}${c.u ? ` <small>(${esc(c.u)})</small>` : ''}</span><input type="text" id="${id}" data-campo="${c.k}" value="${esc(v)}" spellcheck="false"${c.dica ? ` placeholder="${esc(c.dica)}" title="${esc(c.dica)}"` : ''}></label>${c.dica && c.ni ? `<small class="dica-campo">${esc(c.dica)}</small>` : ''}`;
            };
            // não idealidades ficam num bloco à parte; abre sozinho quando alguma estiver em uso
            const ideal = (c) => { const v = String(el.props[c.k] ?? '').trim(); if (c.ideal !== undefined) return C.num(v) === C.num(c.ideal); return c.texto ? !v : (v === '' || v === '0' || C.num(v) === 0 || C.num(v) === Infinity); };
            const ni = campos.filter((c) => c.ni), emUso = ni.filter((c) => !ideal(c)).length;
            const linhas = campos.filter((c) => !c.ni).map(html).join('') + (ni.length ? `<details class="nao-ideal"${emUso ? ' open' : ''}>
                <summary>Não idealidades ${emUso ? `<span class="etiqueta">${emUso} em uso</span>` : '<small>(todas ideais)</small>'}</summary>
                <p class="muted">Padrão = ideal (0 em série, ∞ em paralelo). Aceita sufixo SPICE e ∞.</p>${ni.map(html).join('')}</details>` : '');
            const inf = this.info(el);
            const vv = d.bipolo ? this.tensaoEl(el, inf) : null;
            const leitura = d.bipolo
                ? `<dl class="leitura"><dt>Tensão</dt><dd id="lei-v">${S.formatar(vv, 'V')}</dd><dt>Corrente</dt><dd id="lei-i">${S.formatar(inf.i, 'A')}</dd><dt>Potência</dt><dd id="lei-p">${S.formatar(Math.abs(vv * inf.i), 'W')}</dd></dl>`
                : `<dl class="leitura">${(d.nomesPinos || (d.nomesPinosDe ? d.nomesPinosDe(el, this.lib) : ['pino'])).map((n, i) => `<dt>${esc(n)}</dt><dd>${S.formatar(inf.v[i], 'V')}</dd>`).join('')}</dl>`;
            box.innerHTML = `<div class="prop-topo"><b>${esc(el.id)}</b> <span>${esc(d.nome)}</span></div>
                ${linhas}
                ${leitura}
                <div class="prop-botoes">
                    <button type="button" class="btn btn-secondary btn-sm" data-acao="osc-v">📈 No osciloscópio (V)</button>
                    ${d.bipolo ? '<button type="button" class="btn btn-secondary btn-sm" data-acao="osc-i">📈 (I)</button><button type="button" class="btn btn-secondary btn-sm" data-acao="osc-p">📈 (P)</button>' : ''}
                    <button type="button" class="btn btn-secondary btn-sm" data-acao="girar" title="Shift+R">⟳ ${d.bipolo ? 'Inverter' : 'Girar'}</button>
                    <button type="button" class="btn btn-secondary btn-sm btn-perigo" data-acao="excluir" title="Delete">🗑 Excluir</button>
                </div>`;
            box.querySelectorAll('[data-faixa]').forEach((inp) => {
                let marcado = false;
                inp.addEventListener('input', () => {
                    if (!marcado) { this.antes(); marcado = true; }
                    el.props[inp.dataset.faixa] = inp.value;
                    box.querySelector(`[data-faixa-txt="${inp.dataset.faixa}"]`).textContent = Math.round(inp.value * 100) + ' %';
                    this.reconstruir(); this.guardar();
                });
                inp.addEventListener('change', () => { marcado = false; });
            });
            box.querySelectorAll('[data-campo]').forEach((inp) => {
                inp.addEventListener('change', () => {
                    this.antes();
                    const k = inp.dataset.campo;
                    const c = campos.find((x) => x.k === k);
                    let val = inp.type === 'checkbox' ? inp.checked : inp.value.trim();
                    if (inp.type === 'text' && !['pinos', 'titulo', 'pontos'].includes(k) && !(c && c.texto) && isNaN(c && c.ni ? C.num(val) : S.valor(val))) { this.aviso(`Valor inválido em ${c.r}: use número com sufixo SPICE (ex.: 4.7k, 10u, 1meg)${c.ni ? ' ou ∞' : ''}.`); inp.value = el.props[k]; return; }
                    el.props[k] = val;
                    this.mudouValor(el);
                });
            });
        },
        atualizarLeitura() {
            const el = this.ed.selecionado();
            if (!el || !C.DEFS[el.tipo].bipolo) return;
            const inf = this.info(el), vv = this.tensaoEl(el, inf);
            const a = $('#lei-v'); if (!a) return;
            a.textContent = S.formatar(vv, 'V'); $('#lei-i').textContent = S.formatar(inf.i, 'A'); $('#lei-p').textContent = S.formatar(Math.abs(vv * inf.i), 'W');
        },
        infoHover(el, pt) {
            const box = $('#hover');
            if (!el) { box.hidden = true; return; }
            const d = C.DEFS[el.tipo], inf = this.info(el);
            let txt = `<b>${esc(el.id)}</b> ${esc(d.curto || d.nome)}`;
            if (d.texto && d.texto(el)) txt += ` · ${esc(d.texto(el))}`;
            if (d.bipolo) { const vv = this.tensaoEl(el, inf); txt += `<br>V = ${S.formatar(vv, 'V')} · I = ${S.formatar(inf.i, 'A')} · P = ${S.formatar(Math.abs(vv * inf.i), 'W')}`; }
            else txt += '<br>' + (d.nomesPinos || (d.nomesPinosDe ? d.nomesPinosDe(el, this.lib) : ['pino'])).map((n, i) => `${esc(n)}: ${S.formatar(inf.v[i], 'V')}`).join(' · ');
            box.innerHTML = txt; box.hidden = false;
            void pt;
        },
        mostrarAvisos() {
            const box = $('#avisos');
            const itens = [];
            if (this.erro) itens.push(`<li class="erro">⛔ ${esc(this.erro)}</li>`);
            (this.avisos || []).forEach((a) => itens.push(`<li>⚠ ${esc(a)}</li>`));
            box.innerHTML = itens.join('');
            box.hidden = !itens.length;
        },
        aviso(t) {
            const a = $('#aviso'); a.textContent = t; a.classList.add('visivel');
            clearTimeout(this._av); this._av = setTimeout(() => a.classList.remove('visivel'), 4200);
        },

        // ------------------------------------------------------------ biblioteca (painel)
        montarBiblioteca() {
            const lerArquivos = (lista) => {
                const fs = [...lista].filter((f) => this.lib.aceitaArquivo(f.name));
                if (!fs.length) { this.aviso('Nenhum arquivo de modelo (.lib, .mod, .sub, .cir, .txt...) na seleção.'); return; }
                let m = 0, s = 0;
                Promise.all(fs.map((f) => f.text().then((t) => { const r = this.lib.adicionar(f.webkitRelativePath || f.name, t, 'pasta'); m += r.modelos; s += r.subckts; }))).then(() => {
                    this.guardarBiblioteca(); this.listarBiblioteca(); this.reconstruir();
                    this.aviso(`${fs.length} arquivo(s): ${m} modelos e ${s} subcircuitos.`);
                    const el = this.ed.selecionado(); if (el) this.mostrarPropriedades(el);
                });
            };
            $('#bib-pasta').addEventListener('change', (ev) => { lerArquivos(ev.target.files); ev.target.value = ''; });
            $('#bib-arquivos').addEventListener('change', (ev) => { lerArquivos(ev.target.files); ev.target.value = ''; });
            $('#bib-busca').addEventListener('input', () => this.listarBiblioteca());
            this.listarBiblioteca();
        },
        listarBiblioteca() {
            const tt = this.lib.totais();
            $('#bib-totais').textContent = `${tt.modelos} modelos · ${tt.subckts} subcircuitos · ${tt.arquivos} arquivo(s)`;
            const r = this.lib.buscar($('#bib-busca').value, 80);
            $('#bib-lista').innerHTML = r.length ? r.map((x) => `<li>
                <div><b>${esc(x.nome)}</b> <span class="etiqueta">${esc(x.tipo)}</span>
                ${x.classe === 'subckt' ? `<small>${x.item.nos.length} pinos: ${esc(x.item.pinos.join(' '))}</small>${x.item.suporte.ok ? '' : ' <small class="aviso-txt" title="' + esc(x.item.suporte.falta.join(', ')) + '">⚠ parcial</small>'}` : ''}
                <small class="bib-arq">${esc(x.arquivo)}</small></div>
                <button type="button" class="btn btn-secondary btn-sm" data-acao="bib-usar" data-classe="${x.classe}" data-nome="${esc(x.nome)}">Usar</button></li>`).join('')
                : '<li class="muted">Nada encontrado.</li>';
            const arqs = Object.entries(this.lib.arquivos);
            $('#bib-arquivos-lista').innerHTML = arqs.map(([k, a]) => `<li><span title="${esc(a.origem)}">${a.origem === 'embutido' ? '📦' : a.origem === 'repositório' ? '🌐' : '📁'} ${esc(k)}</span>
                ${a.origem === 'pasta' || a.origem === 'colado' ? `<button type="button" class="link-botao" data-acao="bib-tirar" data-arquivo="${esc(k)}" title="Tirar da biblioteca">✕</button>` : ''}</li>`).join('');
        },
        colarModelo() {
            const t = $('#bib-texto').value;
            if (!t.trim()) { this.aviso('Cole o texto do .model ou do .subckt na caixa.'); return; }
            const nome = 'colado-' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '.lib';
            const r = this.lib.adicionar(nome, t, 'colado');
            if (!r.modelos && !r.subckts) { this.lib.remover(nome); this.aviso('Não achei .model nem .subckt no texto colado.'); return; }
            $('#bib-texto').value = '';
            this.guardarBiblioteca(); this.listarBiblioteca(); this.reconstruir();
            this.aviso(`Adicionado: ${r.modelos} modelos e ${r.subckts} subcircuitos.`);
        },
        usarDaBiblioteca(classe, nome) {
            const sel = this.ed.selecionado();
            this.antes();
            if (classe === 'subckt') {
                if (sel && sel.tipo === 'caixa') { sel.props.modelo = nome; this.mudouValor(sel); return; }
                const el = this.novo('caixa', { pos: this.ed.centro(), rot: 0 });
                el.props.modelo = nome;
                this.ed.selecionarSo(el); this.selecionou(el); this.mudouTopologia();
                this.aviso(`Caixa ${el.id} criada com ${nome}: arraste para o lugar e ligue os pinos.`);
                return;
            }
            const m = this.lib.modelo(nome);
            const tipoEl = { D: ['diodo', 'led', 'zener'], NPN: ['npn'], PNP: ['pnp'], NMOS: ['nmos'], PMOS: ['pmos'] }[m.tipo];
            if (!tipoEl) { this.aviso(`O modelo ${nome} (${m.tipo}) ainda não tem componente no tempo real.`); return; }
            if (sel && tipoEl.includes(sel.tipo)) { sel.props.modelo = nome; this.mudouValor(sel); return; }
            const c = this.ed.centro();
            const el = C.DEFS[tipoEl[0]].bipolo ? this.novo(tipoEl[0], { p: [c, [c[0] + 64, c[1]]] }) : this.novo(tipoEl[0], { pos: c, rot: 0 });
            el.props.modelo = nome;
            this.ed.selecionarSo(el); this.selecionou(el); this.mudouTopologia();
        },

        // ------------------------------------------------------------ arquivos
        dados() { return { formato: 'simulador-falstad-spice', versao: 1, els: this.ed.els.map((e) => { const c = Object.assign({}, e); delete c._fase; return c; }), dt: this.dt, velocidade: this.velocidade, osc: this.osc.map((o) => ({ el: o.el, g: o.g, escala: o.escala, pos: o.pos })), oscN: this.oscN, oscTdiv: this.oscTdiv, oscTrig: this.oscTrig, oscNivel: this.oscNivel }; },
        guardar() { clearTimeout(this._g); this._g = setTimeout(() => salvarLS(CHAVE_CIRCUITO, this.dados()), 300); },
        abrirDados(d, silencioso) {
            if (!d || !Array.isArray(d.els)) { this.aviso('Arquivo de circuito inválido.'); return; }
            this.ed.els = d.els.filter((e) => C.DEFS[e.tipo]);
            this.dt = d.dt > 0 ? d.dt : 10e-6;
            this.velocidade = VELOCIDADES.some(([v]) => v === d.velocidade) ? d.velocidade : '0.01';
            this.oscN = d.oscN || 5;
            $('#passo').value = S.formatar(this.dt, 's').replace(/ /g, '');
            $('#velocidade').value = this.velocidade;
            this.oscTdiv = d.oscTdiv || 'auto'; this.oscTrig = d.oscTrig || 'livre'; this.oscNivel = d.oscNivel || '';
            $('#osc-tdiv').value = this.oscTdiv; $('#osc-trig').value = this.oscTrig; $('#osc-nivel').value = this.oscNivel;
            this.ed.selecionarSo(null); this.selecionou(null);
            this.reiniciar();
            this.osc = [];
            (d.osc || []).forEach((o) => { const el = this.ed.el(o.el); if (el) this.adicionarOsc(el, o.g, { escala: o.escala || 'auto', pos: o.pos || 0 }); });
            this.listarOsc();
            this.enquadrar();
            if (!silencioso) this.guardar();
        },
        abrirExemplo(id) {
            const ex = Ex.EXEMPLOS.find((e) => e.id === id);
            if (!ex) return;
            this.antes();
            const els = Ex.comIds(ex.els);
            this.abrirDados({ els, dt: ex.passo, velocidade: '0.01', osc: (ex.osc || []).map((o) => ({ el: els[o.el].id, g: o.g })), oscN: 5 });
            this.rodando = true; this.atualizarBotaoRodar();
            this.aviso(ex.dica);
        },
        abrirArquivoCircuito(inp) {
            const f = inp.files[0]; inp.value = '';
            if (!f) return;
            f.text().then((t) => { try { this.antes(); this.abrirDados(JSON.parse(t)); this.aviso(`Aberto: ${f.name}`); } catch (e) { this.aviso('Não consegui ler o arquivo (JSON inválido).'); } });
        },
        baixar(nome, texto, tipo) {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(new Blob([texto], { type: tipo }));
            a.download = nome; document.body.appendChild(a); a.click();
            setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
        },
        enquadrar() {
            const els = this.ed.els;
            if (!els.length) return;
            let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
            els.forEach((e) => { const [x, y, w, h] = this.ed.caixa(e); x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + w); y1 = Math.max(y1, y + h); });
            const W = this.ed.w, H = this.ed.h, m = 40;
            const z = Math.max(0.4, Math.min(1.5, Math.min((W - 2 * m) / (x1 - x0 || 1), (H - 2 * m) / (y1 - y0 || 1))));
            this.ed.vista = { z, ox: (W - (x1 - x0) * z) / 2 - x0 * z, oy: (H - (y1 - y0) * z) / 2 - y0 * z };
        },

        // ------------------------------------------------------------ teclado e menu no celular
        /** Atalhos do teclado no padrão do simulador do Prof. Falstad (ver README). */
        ligarTeclas() {
            document.addEventListener('keydown', (ev) => {
                if (ev.target.closest('input, select, textarea')) return;
                const k = ev.key, ctrl = ev.ctrlKey || ev.metaKey, kl = k.toLowerCase();
                if (ctrl) {
                    const mapa = { z: ev.shiftKey ? 'refazer' : 'desfazer', y: 'refazer', c: 'copiar', x: 'recortar', v: 'colar', d: 'duplicar', a: 'tudo', s: 'salvar', o: 'abrir' };
                    if (mapa[kl]) { ev.preventDefault(); this.acao(mapa[kl]); }
                    return;
                }
                if (ev.altKey) return;
                if (k === 'Escape' || k === ' ') { ev.preventDefault(); this.escolherFerramenta('selecionar'); return; }
                if (k === 'Delete' || k === 'Backspace') { ev.preventDefault(); this.excluirSelecao(); return; }
                const setas = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
                if (setas[k]) { ev.preventDefault(); this.moverSelecao(setas[k][0] * C.GRADE, setas[k][1] * C.GRADE); return; }
                if (k === '+' || k === '=') { this.ed.zoom(1.25); return; }
                if (k === '-') { this.ed.zoom(0.8); return; }
                if (k === '0') { this.ed.zoom(1 / this.ed.vista.z); return; }
                if (k === '/') { ev.preventDefault(); $('#bib-busca').focus(); return; }
                if (k === 'f') { this.enquadrar(); return; }
                const t = Object.entries(C.DEFS).find(([, d]) => d.tecla === k); // diferencia maiúscula: l = LED, L = indutor
                if (t) this.escolherFerramenta(t[0]);
            });
            setInterval(() => this.atualizarLeitura(), 250);
        },
        ligarMenuMovel() {
            const b = $('.sidebar-toggle');
            b.addEventListener('click', () => { const ab = document.body.classList.toggle('sidebar-aberta'); b.setAttribute('aria-expanded', ab); });
            $('.sidebar-fundo').addEventListener('click', () => document.body.classList.remove('sidebar-aberta'));
        }
    };

    window.AppSimulador = App;
    document.addEventListener('DOMContentLoaded', () => App.iniciar());
})();
