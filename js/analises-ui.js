/**
 * © 2026 Simulador de Circuitos (Falstad + SPICE) — Marlon Sigales. Todos os direitos reservados; copiar, reproduzir ou alterar exige autorização do autor (ver LICENSE).
 *
 * Janela "Análises SPICE": monta o netlist do circuito desenhado, roda no ngspice (js/analises.js) e mostra tabelas e gráficos.
 */

'use strict';

(function () {
    const $ = (s, r = document) => r.querySelector(s);
    const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const A = window.Analises, C = window.Componentes, S = window.Spice, Circ = window.Circuito;

    const TIPOS = [
        ['op', 'Ponto de operação (.op)'], ['ac', 'Resposta em frequência / Bode (.ac)'], ['dc', 'Varredura DC (.dc)'],
        ['tran', 'Transitório (.tran)'], ['noise', 'Ruído (.noise)'], ['four', 'Fourier e THD (do .tran)']
    ];
    const VARIACOES = [['nenhuma', 'Nenhuma'], ['param', 'Paramétrica (vários valores de um componente)'], ['temp', 'Temperatura'], ['mc', 'Monte Carlo (tolerâncias)']];

    const UI = {
        app: null,
        montar(app) {
            this.app = app;
            const d = document.createElement('dialog');
            d.id = 'dlg-analises'; d.className = 'dlg-analises';
            d.innerHTML = `
                <div class="fw-topo"><h2>📊 Análises SPICE (ngspice)</h2><button type="button" class="link-botao" data-an="fechar" aria-label="Fechar">✕</button></div>
                <div class="an-grade">
                    <form class="an-form" id="an-form" onsubmit="return false">
                        <label class="campo"><span>Análise</span><select id="an-tipo">${TIPOS.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select></label>
                        <div id="an-campos"></div>
                        <label class="campo"><span>Variação</span><select id="an-var">${VARIACOES.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select></label>
                        <div id="an-var-campos"></div>
                        <div class="campo" id="an-saidas-box"><span>Saídas (o que mostrar)</span><div class="an-saidas" id="an-saidas"></div></div>
                        <div class="prop-botoes"><button type="button" class="btn btn-primary btn-sm" data-an="rodar">▶ Rodar no ngspice</button>
                            <button type="button" class="btn btn-secondary btn-sm" data-an="netlist" title="Ver o netlist que vai para o ngspice">Ver netlist</button></div>
                        <p class="fw-msg" id="an-msg"></p>
                    </form>
                    <div class="an-resultado" id="an-resultado"><p class="muted">Escolha a análise e clique em Rodar. O ngspice (20 MB) é baixado só na primeira vez.</p></div>
                </div>`;
            document.body.appendChild(d);
            d.addEventListener('click', (ev) => {
                const b = ev.target.closest('[data-an]');
                if (!b) return;
                if (b.dataset.an === 'fechar') d.close();
                if (b.dataset.an === 'rodar') this.rodar();
                if (b.dataset.an === 'netlist') this.mostrarNetlist();
                if (b.dataset.an === 'op-desenho') { this.app.opOverlay = this.ultimoOp; d.close(); this.app.aviso('Tensões do ponto de operação no desenho (somem quando o circuito mudar).'); }
            });
            $('#an-tipo').addEventListener('change', () => this.campos());
            $('#an-var').addEventListener('change', () => this.camposVar());
        },
        abrir() {
            const d = $('#dlg-analises');
            this.campos(); this.camposVar();
            d.showModal();
        },
        fontes() { return this.app.ed.els.filter((e) => e.tipo === 'fonteV' || e.tipo === 'trilho'); },
        campos() {
            const t = $('#an-tipo').value, f = this.fontes();
            const selF = (id, rot) => `<label class="campo"><span>${rot}</span><select id="${id}">${f.map((e) => `<option value="${esc(e.id)}">${esc(e.id)} (${esc(C.DEFS[e.tipo].curto || C.DEFS[e.tipo].nome)})</option>`).join('') || '<option value="">(ponha uma fonte de tensão)</option>'}</select></label>`;
            const inp = (id, rot, v, u) => `<label class="campo"><span>${rot}${u ? ` <small>(${u})</small>` : ''}</span><input type="text" id="${id}" value="${esc(v)}" spellcheck="false"></label>`;
            const html = {
                op: '<p class="muted">Calcula as tensões dos nós e as correntes das fontes em regime DC (capacitores abertos, indutores em curto).</p>',
                ac: selF('an-fonte', 'Entrada (fonte que recebe AC 1 V)') + inp('an-f1', 'Frequência inicial', '10', 'Hz') + inp('an-f2', 'Frequência final', '1meg', 'Hz') + inp('an-ppd', 'Pontos por década', '30'),
                dc: selF('an-fonte', 'Fonte varrida') + inp('an-v1', 'Início', '0', 'V') + inp('an-v2', 'Fim', '5', 'V') + inp('an-dv', 'Passo', '0.05', 'V'),
                tran: inp('an-tf', 'Tempo final', '10m', 's') + inp('an-dt', 'Passo máximo', '10u', 's'),
                noise: selF('an-fonte', 'Fonte de entrada (referência)') + inp('an-f1', 'Frequência inicial', '10', 'Hz') + inp('an-f2', 'Frequência final', '1meg', 'Hz') + inp('an-ppd', 'Pontos por década', '20') + '<p class="muted">Usa a 1ª saída marcada como ponto de medida do ruído.</p>',
                four: inp('an-f0', 'Frequência fundamental', '1k', 'Hz') + inp('an-per', 'Períodos simulados', '10') + '<p class="muted">Simula o transitório e calcula as 9 primeiras harmônicas e a THD nos últimos 4 períodos.</p>'
            }[t];
            $('#an-campos').innerHTML = html;
            $('#an-saidas-box').hidden = t === 'op';
            const ss = A.saidas(this.app.ed.els, this.app.lib);
            const marcadas = new Set(this.app.osc.map((o) => o.el));
            const sel = this.app.ed.sel;
            $('#an-saidas').innerHTML = ss.map((s, i) => `<label class="campo-bool"><input type="checkbox" data-saida="${i}" ${marcadas.has(s.id) || s.id === sel ? 'checked' : ''}> ${esc(s.nome)}</label>`).join('') || '<p class="muted">Sem saídas.</p>';
            this._saidas = ss;
        },
        camposVar() {
            const v = $('#an-var').value, els = this.app.ed.els;
            const comNum = els.filter((e) => (C.DEFS[e.tipo].campos || []).some((c) => !c.tipo && !c.texto && !c.ni));
            const html = {
                nenhuma: '',
                param: `<label class="campo"><span>Componente</span><select id="an-pel">${comNum.map((e) => `<option value="${esc(e.id)}">${esc(e.id)}</option>`).join('')}</select></label>
                    <label class="campo"><span>Propriedade</span><select id="an-pk"></select></label>
                    <label class="campo"><span>Valores (separados por espaço)</span><input type="text" id="an-pvals" value="1k 2.2k 4.7k 10k" spellcheck="false"></label>`,
                temp: '<label class="campo"><span>Temperaturas (°C)</span><input type="text" id="an-temps" value="-40 27 85" spellcheck="false"></label><p class="muted">Muda os semicondutores (IS, Vt) como no SPICE; resistores só mudam se o modelo tiver TC.</p>',
                mc: `<label class="campo"><span>Rodadas</span><input type="text" id="an-mcn" value="20"></label>
                    <label class="campo"><span>Tolerância dos resistores (%)</span><input type="text" id="an-tolr" value="5"></label>
                    <label class="campo"><span>Tolerância dos capacitores (%)</span><input type="text" id="an-tolc" value="10"></label>
                    <label class="campo"><span>Tolerância dos indutores (%)</span><input type="text" id="an-toll" value="10"></label>`
            }[v];
            $('#an-var-campos').innerHTML = html;
            if (v === 'param') {
                const pk = () => {
                    const el = this.app.ed.el($('#an-pel').value);
                    $('#an-pk').innerHTML = el ? (C.DEFS[el.tipo].campos || []).filter((c) => !c.tipo && !c.texto && !c.ni).map((c) => `<option value="${esc(c.k)}">${esc(c.r)}</option>`).join('') : '';
                };
                $('#an-pel').addEventListener('change', pk); pk();
            }
        },
        val(id, padrao) { const e = $('#' + id); return e ? e.value.trim() : padrao; },
        nomeFonte(id) { return String(id).toUpperCase().startsWith('V') ? id : 'V' + id; },
        linhas() {
            const t = $('#an-tipo').value, v = (id) => this.val(id);
            switch (t) {
                case 'op': return ['.op'];
                case 'ac': return [`.ac dec ${v('an-ppd')} ${v('an-f1')} ${v('an-f2')}`];
                case 'dc': return [`.dc ${this.nomeFonte(v('an-fonte'))} ${v('an-v1')} ${v('an-v2')} ${v('an-dv')}`];
                case 'tran': return [`.tran ${v('an-dt')} ${v('an-tf')}`];
                case 'noise': {
                    const s = this.escolhidas()[0];
                    if (!s) throw new Error('Marque uma saída para medir o ruído.');
                    const no = (k) => (k ? 'n' + k : '0');
                    return [`.noise v(${no(s.nos[0])}${s.nos[1] ? ',' + no(s.nos[1]) : ''}) ${this.nomeFonte(v('an-fonte'))} dec ${v('an-ppd')} ${v('an-f1')} ${v('an-f2')}`];
                }
                case 'four': { const f0 = S.valor(v('an-f0')), per = S.valor(v('an-per')) || 10; return [`.tran ${1 / f0 / 400} ${per / f0}`]; }
            }
            return ['.op'];
        },
        escolhidas() { return [...document.querySelectorAll('#an-saidas [data-saida]:checked')].map((c) => this._saidas[+c.dataset.saida]); },
        variantes() {
            const v = $('#an-var').value, els = this.app.ed.els;
            if (v === 'param') {
                const id = this.val('an-pel'), k = this.val('an-pk');
                return this.val('an-pvals').split(/[\s,;]+/).filter(Boolean).map((x) => { const c = A.clonar(els); const e = c.find((y) => y.id === id); if (e) e.props[k] = x; return { nome: `${id}.${k} = ${x}`, els: c }; });
            }
            if (v === 'temp') return this.val('an-temps').split(/[\s,;]+/).filter(Boolean).map((x) => ({ nome: `${x} °C`, els, temp: S.valor(x) }));
            if (v === 'mc') {
                const n = Math.min(200, Math.max(1, parseInt(this.val('an-mcn'), 10) || 20));
                const tol = { R: S.valor(this.val('an-tolr')) || 0, C: S.valor(this.val('an-tolc')) || 0, L: S.valor(this.val('an-toll')) || 0 };
                return Array.from({ length: n }, (_, i) => ({ nome: `rodada ${i + 1}`, els: A.sortear(els, tol) }));
            }
            return [{ nome: 'nominal', els }];
        },
        netlist(els, temp) {
            const t = $('#an-tipo').value;
            return Circ.exportarSpice(els, this.app.lib, { analise: this.linhas(), acFonte: t === 'ac' || t === 'noise' ? this.val('an-fonte') : null, temp, shunt: true, titulo: 'Análise ' + t });
        },
        mostrarNetlist() {
            try {
                const v = this.variantes()[0];
                $('#an-resultado').innerHTML = `<pre class="an-netlist">${esc(this.netlist(v.els, v.temp))}</pre>`;
            } catch (e) { this.msg('⚠ ' + e.message, true); }
        },
        msg(t, erro) { const m = $('#an-msg'); m.textContent = t; m.className = 'fw-msg' + (erro ? ' erro' : ''); },
        async rodar() {
            const tipo = $('#an-tipo').value;
            let vars, saidas;
            try { vars = this.variantes(); saidas = this.escolhidas(); this.linhas(); } catch (e) { this.msg('⚠ ' + e.message, true); return; }
            if (tipo !== 'op' && !saidas.length) { this.msg('⚠ Marque ao menos uma saída.', true); return; }
            if (this.app.ed.els.some((e) => C.DEFS[e.tipo].criarExecucao)) this.msg('Aviso: microcontroladores não entram no netlist (os pinos ficam soltos).');
            let sim;
            try { this.msg('Carregando o ngspice…'); sim = await A.carregarNgspice(); } catch (e) { this.msg('⚠ ' + e.message, true); return; }
            const res = [];
            for (let i = 0; i < vars.length; i++) {
                this.msg(`Rodando ${i + 1} de ${vars.length}…`);
                try {
                    const r = await A.rodar(sim, this.netlist(vars[i].els, vars[i].temp));
                    if (!r || !r.data) throw new Error('o ngspice não devolveu resultado');
                    res.push({ v: vars[i], r });
                } catch (e) { this.msg(`⚠ ${vars[i].nome}: ${e.message || e}`, true); return; }
            }
            const erros = res.flatMap((x) => x.r.erros || []);
            this.msg(erros.length ? '⚠ ngspice: ' + erros.slice(0, 3).join(' | ') : `✔ Pronto (${res.length} ${res.length > 1 ? 'simulações' : 'simulação'}).`, !!erros.length);
            this.mostrar(tipo, res, saidas);
        },
        mostrar(tipo, res, saidas) {
            const box = $('#an-resultado');
            const multi = res.length > 1;
            const curvas = (f) => { const out = []; res.forEach((x, i) => saidas.forEach((s, j) => out.push(Object.assign({ nome: (multi ? x.v.nome + ' · ' : '') + s.nome.split(':')[0], cor: A.cor(multi ? i : j, multi ? res.length : saidas.length) }, f(x.r, s))))); return out; };
            if (tipo === 'op') {
                const ss = A.saidas(this.app.ed.els, this.app.lib);
                const fontes = res[0].r.data.filter((d) => /^i\(/.test(d.name));
                box.innerHTML = `<table class="osc-tabela"><thead><tr><th>Saída</th>${res.map((x) => `<th>${esc(x.v.nome)}</th>`).join('')}</tr></thead><tbody>
                    ${ss.map((s) => `<tr><td>${esc(s.nome)}</td>${res.map((x) => `<td>${S.formatar(A.valoresSaida(x.r, s)[0], 'V')}</td>`).join('')}</tr>`).join('')}
                    ${fontes.map((f) => `<tr><td>corrente em ${esc(f.name.slice(2, -1).toUpperCase())} (entra no +)</td>${res.map((x) => { const d = x.r.data.find((y) => y.name === f.name); return `<td>${S.formatar(d ? d.values[0] : NaN, 'A')}</td>`; }).join('')}</tr>`).join('')}
                    </tbody></table><div class="prop-botoes"><button type="button" class="btn btn-secondary btn-sm" data-an="op-desenho">Mostrar no desenho</button></div>`;
                const nos = {};
                ss.forEach((s) => { if (!s.nos[1]) nos[s.nos[0]] = A.valoresSaida(res[0].r, s)[0]; });
                this.ultimoOp = nos;
                return;
            }
            if (tipo === 'ac') {
                box.innerHTML = '<canvas class="an-graf" id="an-g1"></canvas><canvas class="an-graf" id="an-g2"></canvas>';
                const f = (r) => r.data[0].values.map((x) => (typeof x === 'object' ? x.real : x));
                A.plotar($('#an-g1'), { curvas: curvas((r, s) => ({ x: f(r), y: A.valoresSaida(r, s).map((c) => 20 * Math.log10(Math.hypot(c.real, c.img) || 1e-30)) })), logx: true, unX: 'Hz', unY: ' dB', semSI: true, rotX: 'frequência', rotY: 'ganho (dB)' });
                A.plotar($('#an-g2'), { curvas: curvas((r, s) => ({ x: f(r), y: A.valoresSaida(r, s).map((c) => Math.atan2(c.img, c.real) * 180 / Math.PI) })), logx: true, unX: 'Hz', unY: '°', semSI: true, rotX: 'frequência', rotY: 'fase (°)' });
                return;
            }
            if (tipo === 'dc' || tipo === 'tran') {
                box.innerHTML = '<canvas class="an-graf an-graf-alto" id="an-g1"></canvas>';
                A.plotar($('#an-g1'), { curvas: curvas((r, s) => ({ x: r.data[0].values, y: A.valoresSaida(r, s) })), unX: tipo === 'dc' ? 'V' : 's', unY: 'V', rotX: tipo === 'dc' ? 'tensão da fonte' : 'tempo', rotY: 'tensão' });
                return;
            }
            if (tipo === 'noise') {
                box.innerHTML = '<canvas class="an-graf an-graf-alto" id="an-g1"></canvas>';
                const cs = [];
                res.forEach((x, i) => { const fr = x.r.data[0].values, on = x.r.data.find((d) => d.name === 'onoise_spectrum'), inn = x.r.data.find((d) => d.name === 'inoise_spectrum');
                    if (on) cs.push({ nome: (multi ? x.v.nome + ' · ' : '') + 'ruído na saída', x: fr, y: on.values, cor: A.cor(2 * i, 2 * res.length) });
                    if (inn) cs.push({ nome: (multi ? x.v.nome + ' · ' : '') + 'ruído referido à entrada', x: fr, y: inn.values, cor: A.cor(2 * i + 1, 2 * res.length) }); });
                A.plotar($('#an-g1'), { curvas: cs, logx: true, logy: true, unX: 'Hz', unY: 'V/√Hz', rotX: 'frequência', rotY: 'densidade de ruído' });
                return;
            }
            if (tipo === 'four') {
                const f0 = S.valor(this.val('an-f0'));
                const linhas = [];
                res.forEach((x) => saidas.forEach((s) => { const fo = A.fourier(x.r.data[0].values, A.valoresSaida(x.r, s), f0); linhas.push({ nome: (multi ? x.v.nome + ' · ' : '') + s.nome.split(':')[0], fo }); }));
                box.innerHTML = `<table class="osc-tabela"><thead><tr><th>Saída</th><th>THD</th><th>DC</th>${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((h) => `<th>H${h}</th>`).join('')}</tr></thead><tbody>
                    ${linhas.map((l) => `<tr><td>${esc(l.nome)}</td><td><b>${(l.fo.thd * 100).toFixed(2).replace('.', ',')} %</b></td><td>${S.formatar(l.fo.dc, 'V')}</td>${l.fo.harm.map((h) => `<td>${S.formatar(h.amp, 'V')}</td>`).join('')}</tr>`).join('')}
                    </tbody></table><canvas class="an-graf" id="an-g1"></canvas>`;
                A.plotar($('#an-g1'), { curvas: curvas((r, s) => ({ x: r.data[0].values, y: A.valoresSaida(r, s) })), unX: 's', unY: 'V', rotX: 'tempo', rotY: 'tensão' });
            }
        }
    };
    window.AnalisesUI = UI;
})();
