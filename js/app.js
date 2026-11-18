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
        osc: [], oscN: 5, oscCont: 0,
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
            const letra = { fio: 'W', resistor: 'R', capacitor: 'C', indutor: 'L', chave: 'S', fonteV: 'V', trilho: 'V', fonteI: 'I', terra: 'GND', diodo: 'D', zener: 'DZ', led: 'LED', npn: 'Q', pnp: 'Q', nmos: 'M', pmos: 'M', ampop: 'U', caixa: 'X', voltimetro: 'VM' }[tipo] || 'E';
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
            this.osc.forEach((o) => { o.dados = []; });
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
            if (p) i = p.i;
            return { v, i, cor: vazio.cor, prim: p };
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
        adicionarOsc(el, g) {
            if (this.osc.some((o) => o.el === el.id && o.g === g)) return;
            if (this.osc.length >= 4) this.osc.shift();
            const usadas = this.osc.map((o) => o.cor);
            this.osc.push({ el: el.id, g, cor: CORES_OSC.find((c) => !usadas.includes(c)) || CORES_OSC[0], dados: [] });
            this.listarOsc();
        },
        valorOsc(o) {
            const el = this.ed.el(o.el);
            if (!el) return NaN;
            const inf = this.info(el);
            if (o.g === 'I') return inf.i;
            return inf.v.length >= 2 ? inf.v[1] - inf.v[0] : inf.v[0];
        },
        amostrarOsc() {
            if (!this.osc.length) return;
            if (++this.oscCont < this.oscN) return;
            this.oscCont = 0;
            this.osc.forEach((o) => { o.dados.push(this.valorOsc(o)); if (o.dados.length > 3000) o.dados.splice(0, o.dados.length - 3000); });
        },
        listarOsc() {
            $('#osc-traços').innerHTML = this.osc.length ? this.osc.map((o, i) => `<span class="osc-chip" style="--c:${o.cor}">
                ${o.g === 'V' ? 'Tensão' : 'Corrente'} em ${esc(o.el)} <button type="button" data-tirar-osc="${i}" title="Tirar do osciloscópio">✕</button></span>`).join('')
                : '<span class="muted">Selecione um componente e clique em “No osciloscópio”.</span>';
        },
        desenharOsc() {
            const cv = $('#osc'), wrap = cv.parentElement;
            const dpr = window.devicePixelRatio || 1, w = wrap.clientWidth, h = wrap.clientHeight;
            if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); cv.style.width = w + 'px'; cv.style.height = h + 'px'; }
            const g = cv.getContext('2d');
            g.setTransform(dpr, 0, 0, dpr, 0, 0);
            g.fillStyle = '#0d2b2c'; g.fillRect(0, 0, w, h);
            g.strokeStyle = 'rgba(255,255,255,.08)'; g.lineWidth = 1;
            for (let i = 1; i < 10; i++) { g.beginPath(); g.moveTo(i * w / 10, 0); g.lineTo(i * w / 10, h); g.stroke(); }
            for (let i = 1; i < 6; i++) { g.beginPath(); g.moveTo(0, i * h / 6); g.lineTo(w, i * h / 6); g.stroke(); }
            g.strokeStyle = 'rgba(255,255,255,.22)'; g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
            const n = Math.floor(w);
            g.font = '11px Segoe UI, Roboto, Arial'; g.textBaseline = 'top';
            this.osc.forEach((o, k) => {
                const d = o.dados.slice(-n);
                if (!d.length) return;
                let mx = -Infinity, mn = Infinity;
                d.forEach((x) => { if (isFinite(x)) { mx = Math.max(mx, x); mn = Math.min(mn, x); } });
                if (!isFinite(mx)) return;
                const lim = Math.max(Math.abs(mx), Math.abs(mn), o.g === 'V' ? 1e-3 : 1e-9) * 1.1;
                g.strokeStyle = o.cor; g.lineWidth = 1.6; g.beginPath();
                d.forEach((x, i) => { const y = h / 2 - (x / lim) * (h / 2 - 6); i ? g.lineTo(i * w / n, y) : g.moveTo(0, y); });
                g.stroke();
                g.fillStyle = o.cor;
                const u = o.g === 'V' ? 'V' : 'A';
                g.fillText(`${o.el} ${o.g}: ${S.formatar(d[d.length - 1], u)}  (máx ${S.formatar(mx, u)}, mín ${S.formatar(mn, u)}, escala ±${S.formatar(lim, u)})`, 6, 4 + k * 14);
            });
            g.fillStyle = 'rgba(255,255,255,.55)'; g.textBaseline = 'bottom'; g.textAlign = 'right';
            g.fillText(`tela = ${S.formatar(n * this.oscN * this.dt, 's')}  ·  ${S.formatar(n * this.oscN * this.dt / 10, 's')}/div`, w - 6, h - 4);
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
            $('#osc-n').addEventListener('change', (ev) => { this.oscN = parseInt(ev.target.value, 10) || 5; this.osc.forEach((o) => { o.dados = []; }); });
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
            const campos = (d.campos || []).filter((c) => !c.se || c.se(el.props));
            const linhas = campos.map((c) => {
                const id = `campo-${c.k}`;
                const v = el.props[c.k];
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
                return `<label class="campo"><span>${esc(c.r)}${c.u ? ` <small>(${esc(c.u)})</small>` : ''}</span><input type="text" id="${id}" data-campo="${c.k}" value="${esc(v)}" spellcheck="false"></label>`;
            }).join('');
            const inf = this.info(el);
            const vv = inf.v.length >= 2 && d.bipolo ? inf.v[1] - inf.v[0] : null;
            const leitura = d.bipolo
                ? `<dl class="leitura"><dt>Tensão (p1 − p0)</dt><dd id="lei-v">${S.formatar(vv, 'V')}</dd><dt>Corrente</dt><dd id="lei-i">${S.formatar(inf.i, 'A')}</dd><dt>Potência</dt><dd id="lei-p">${S.formatar(Math.abs(vv * inf.i), 'W')}</dd></dl>`
                : `<dl class="leitura">${(d.nomesPinos || (d.nomesPinosDe ? d.nomesPinosDe(el, this.lib) : ['pino'])).map((n, i) => `<dt>${esc(n)}</dt><dd>${S.formatar(inf.v[i], 'V')}</dd>`).join('')}</dl>`;
            box.innerHTML = `<div class="prop-topo"><b>${esc(el.id)}</b> <span>${esc(d.nome)}</span></div>
                ${linhas}
                ${leitura}
                <div class="prop-botoes">
                    <button type="button" class="btn btn-secondary btn-sm" data-acao="osc-v">📈 No osciloscópio (V)</button>
                    ${d.bipolo ? '<button type="button" class="btn btn-secondary btn-sm" data-acao="osc-i">📈 (I)</button>' : ''}
                    <button type="button" class="btn btn-secondary btn-sm" data-acao="girar" title="Shift+R">⟳ ${d.bipolo ? 'Inverter' : 'Girar'}</button>
                    <button type="button" class="btn btn-secondary btn-sm btn-perigo" data-acao="excluir" title="Delete">🗑 Excluir</button>
                </div>`;
            box.querySelectorAll('[data-campo]').forEach((inp) => {
                inp.addEventListener('change', () => {
                    this.antes();
                    const k = inp.dataset.campo;
                    const c = campos.find((x) => x.k === k);
                    let val = inp.type === 'checkbox' ? inp.checked : inp.value.trim();
                    if (inp.type === 'text' && !['pinos', 'titulo'].includes(k) && isNaN(S.valor(val))) { this.aviso(`Valor inválido em ${c.r}: use número com sufixo SPICE (ex.: 4.7k, 10u, 1meg).`); inp.value = el.props[k]; return; }
                    el.props[k] = val;
                    this.mudouValor(el);
                });
            });
        },
        atualizarLeitura() {
            const el = this.ed.selecionado();
            if (!el || !C.DEFS[el.tipo].bipolo) return;
            const inf = this.info(el), vv = inf.v[1] - inf.v[0];
            const a = $('#lei-v'); if (!a) return;
            a.textContent = S.formatar(vv, 'V'); $('#lei-i').textContent = S.formatar(inf.i, 'A'); $('#lei-p').textContent = S.formatar(Math.abs(vv * inf.i), 'W');
        },
        infoHover(el, pt) {
            const box = $('#hover');
            if (!el) { box.hidden = true; return; }
            const d = C.DEFS[el.tipo], inf = this.info(el);
            let txt = `<b>${esc(el.id)}</b> ${esc(d.curto || d.nome)}`;
            if (d.texto && d.texto(el)) txt += ` · ${esc(d.texto(el))}`;
            if (d.bipolo) { const vv = inf.v[1] - inf.v[0]; txt += `<br>V = ${S.formatar(vv, 'V')} · I = ${S.formatar(inf.i, 'A')} · P = ${S.formatar(Math.abs(vv * inf.i), 'W')}`; }
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
        dados() { return { formato: 'simulador-falstad-spice', versao: 1, els: this.ed.els.map((e) => { const c = Object.assign({}, e); delete c._fase; return c; }), dt: this.dt, velocidade: this.velocidade, osc: this.osc.map((o) => ({ el: o.el, g: o.g })), oscN: this.oscN }; },
        guardar() { clearTimeout(this._g); this._g = setTimeout(() => salvarLS(CHAVE_CIRCUITO, this.dados()), 300); },
        abrirDados(d, silencioso) {
            if (!d || !Array.isArray(d.els)) { this.aviso('Arquivo de circuito inválido.'); return; }
            this.ed.els = d.els.filter((e) => C.DEFS[e.tipo]);
            this.dt = d.dt > 0 ? d.dt : 10e-6;
            this.velocidade = VELOCIDADES.some(([v]) => v === d.velocidade) ? d.velocidade : '0.01';
            this.oscN = d.oscN || 5;
            $('#passo').value = S.formatar(this.dt, 's').replace(/ /g, '');
            $('#velocidade').value = this.velocidade;
            $('#osc-n').value = String(this.oscN);
            this.ed.selecionarSo(null); this.selecionou(null);
            this.reiniciar();
            this.osc = [];
            (d.osc || []).forEach((o) => { const el = this.ed.el(o.el); if (el) this.adicionarOsc(el, o.g); });
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
                if (k === 'R' && ev.shiftKey) { this.acao('girar'); return; }
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
