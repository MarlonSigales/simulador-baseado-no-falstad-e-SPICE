/**
 * © 2026 Simulador de Circuitos (Falstad + SPICE) — Marlon Sigales. Todos os direitos reservados; copiar, reproduzir ou alterar exige autorização do autor (ver LICENSE).
 *
 * Do desenho para o motor: junta pinos que se tocam em nós, gera os primitivos de cada componente
 * (expandindo subcircuitos da biblioteca) e exporta o netlist SPICE.
 */

'use strict';

(function (raiz) {
    const nodeJS = typeof module !== 'undefined' && module.exports;
    const S = nodeJS ? require('./spice.js') : raiz.Spice;
    const C = nodeJS ? require('./componentes.js') : raiz.Componentes;

    const chave = ([x, y]) => `${x},${y}`;
    /** Propriedades que faltam (arquivos antigos) ficam com o padrão do componente, que é sempre o valor ideal. */
    const completo = (el, d) => Object.assign({}, el, { props: Object.assign({}, d.props, el.props) });

    /** Junta pontos em nós. Devolve { noDe(ponto), nNos, pinos: {id: [nós]}, avisos }. */
    function nos(elementos, lib) {
        const pai = {};
        const raizDe = (k) => { while (pai[k] !== k) { pai[k] = pai[pai[k]]; k = pai[k]; } return k; };
        const juntar = (a, b) => { a = raizDe(a); b = raizDe(b); if (a !== b) pai[a] = b; };
        const ver = (k) => { if (pai[k] === undefined) pai[k] = k; return k; };
        const pinos = {};
        ver('GND');
        elementos.forEach((el) => {
            const d = C.DEFS[el.tipo];
            if (!d) return;
            const ps = C.pinos(el, lib);
            pinos[el.id] = ps.map((p) => ver(chave(p)));
            if (d.terra) juntar(pinos[el.id][0], 'GND');
            if (d.rotuloNo && pinos[el.id].length) { const nome = d.rotuloNo(el); if (nome) juntar(pinos[el.id][0], nome === 'GND' || nome === '0' ? 'GND' : ver('LBL:' + nome)); }
        });
        const avisos = [];
        let ref = 'GND';
        const temTerra = elementos.some((el) => C.DEFS[el.tipo] && C.DEFS[el.tipo].terra);
        // trilhos, portas lógicas, amp-op e microcontroladores já se referem ao terra (como no Falstad): não inventa referência
        const IMPLICITA = /^(trilho|entradaLogica|porta_|ampop|mcu|arduino)/;
        const terraImplicita = elementos.some((el) => IMPLICITA.test(el.tipo));
        if (!temTerra && !terraImplicita) {
            const f = elementos.find((el) => el.tipo === 'fonteV') || elementos.find((el) => pinos[el.id] && pinos[el.id].length);
            if (f) { juntar(pinos[f.id][0], 'GND'); avisos.push(`Sem terra no circuito: o ${f.tipo === 'fonteV' ? 'terminal − de' : 'primeiro pino de'} ${f.id} foi usado como referência (0 V).`); }
        }
        const indice = {};
        indice[raizDe(ref)] = 0;
        let n = 1;
        Object.keys(pai).forEach((k) => { const r = raizDe(k); if (indice[r] === undefined) indice[r] = n++; });
        const pinosNos = {};
        Object.entries(pinos).forEach(([id, ks]) => { pinosNos[id] = ks.map((k) => indice[raizDe(k)]); });
        return { nNos: n, pinos: pinosNos, avisos, noDoPonto: (p) => { const k = chave(p); return pai[k] === undefined ? null : indice[raizDe(k)]; } };
    }

    /**
     * Monta o netlist do motor.
     * Devolve { nNos, prims, pinos: {id:[nós]}, primDe: {id: nome do primitivo principal}, avisos }
     */
    function construir(elementos, lib) {
        const r = nos(elementos, lib);
        let nNos = r.nNos;
        const prims = [], avisos = r.avisos.slice(), primDe = {}, correnteDe = {}, papeis = {};
        const internos = {};
        const buscarModelo = (nome, locais) => {
            if (!nome) return null;
            const u = String(nome).toUpperCase();
            const l = (locais || []).find((m) => m.nome === u);
            const m = l || (lib && lib.modelo(u));
            if (!m) avisos.push(`Modelo ${u} não encontrado: usei o padrão`);
            return m || null;
        };
        elementos.forEach((el0) => {
            const d = C.DEFS[el0.tipo];
            if (!d) { avisos.push(`Componente desconhecido: ${el0.tipo}`); return; }
            const el = completo(el0, d);
            const n = r.pinos[el.id];
            let primeiro = true;
            const ctx = {
                add(p, op) {
                    p.nome = p.nome || (el.id + (primeiro ? '' : '.' + prims.length));
                    if (primeiro) primDe[el.id] = p.nome;
                    if (op && op.corrente) (correnteDe[el.id] = correnteDe[el.id] || []).push(p.nome); // somam na corrente do terminal
                    if (op && op.papel) (papeis[el.id] = papeis[el.id] || {})[op.papel] = p.nome;
                    primeiro = false; p.dono = el.id; prims.push(p);
                },
                novoNo: (suf) => { const k = el.id + '#' + suf; if (internos[k] === undefined) internos[k] = nNos++; return internos[k]; },
                modelo(nome, tipos) {
                    if (!nome) return null;
                    const m = buscarModelo(nome);
                    if (m && tipos && !tipos.includes(m.tipo)) { avisos.push(`${el.id}: o modelo ${m.nome} é ${m.tipo}, esperado ${tipos.join('/')}`); return null; }
                    return m;
                },
                subckt: (nome) => lib && lib.subckt(nome),
                aviso: (t) => avisos.push(t),
                expandir(sub, nosExt) {
                    const ctxE = {
                        prims: [],
                        avisos,
                        no: (nomeGlobal) => { if (internos[nomeGlobal] === undefined) internos[nomeGlobal] = nNos++; return internos[nomeGlobal]; },
                        buscarModelo,
                        buscarSubckt: (nome) => lib && lib.subckt(nome)
                    };
                    S.expandir(sub, nosExt, 'X' + el.id, ctxE);
                    ctxE.prims.forEach((p) => { p.dono = el.id; prims.push(p); });
                    if (primeiro) { primDe[el.id] = null; primeiro = false; }
                }
            };
            d.prims(el, n, ctx);
        });
        // não idealidades dos semicondutores vindas do .model (ou dos ajustes do componente):
        // resistências série viram nós internos; capacitâncias de junção entram como capacitores lineares (aproximação)
        const serie = (p, i, R, suf) => {
            if (!(R > 0) || !isFinite(R)) return;
            const k = nNos++;
            prims.push({ tipo: 'R', nome: p.nome + '.' + suf, nos: [p.nos[i], k], valor: R, dono: p.dono });
            p.nos = p.nos.slice(); p.nos[i] = k;
        };
        const cap = (p, a, b, C, suf) => { if (C > 0 && isFinite(C)) prims.push({ tipo: 'C', nome: p.nome + '.' + suf, nos: [a, b], valor: C, dono: p.dono }); };
        prims.slice().forEach((p) => {
            const m = p.modelo && p.modelo.params;
            if (!m) return;
            if (p.tipo === 'D') { serie(p, 0, m.RS, 'RS'); cap(p, p.nos[0], p.nos[1], m.CJO, 'CJ'); }
            if (p.tipo === 'Q') {
                serie(p, 0, m.RC, 'RC'); serie(p, 1, m.RB, 'RB'); serie(p, 2, m.RE, 'RE');
                cap(p, p.nos[1], p.nos[2], m.CJE, 'CJE'); cap(p, p.nos[1], p.nos[0], m.CJC, 'CJC');
            }
            if (p.tipo === 'M') {
                serie(p, 0, m.RD, 'RD'); serie(p, 2, m.RS, 'RS');
                const W = p.W || m.W || 100e-6;
                cap(p, p.nos[1], p.nos[2], m.CGS ?? (m.CGSO ? m.CGSO * W : 0), 'CGS');
                cap(p, p.nos[1], p.nos[0], m.CGD ?? (m.CGDO ? m.CGDO * W : 0), 'CGD');
            }
        });
        return { nNos, prims, pinos: r.pinos, primDe, correnteDe, papeis, avisos: [...new Set(avisos)] };
    }

    /** Netlist SPICE (.cir) para rodar no ngspice/LTspice. */
    function exportarSpice(elementos, lib, opcoes = {}) {
        const r = nos(elementos, lib);
        const usados = new Set(), subUsados = new Set(), padroes = new Map();
        const nosUsados = new Set();
        const nomeNo = (k) => { if (k === 0) return '0'; nosUsados.add('N' + k); return 'N' + k; };
        let idAtual = '';
        const ctx = {
            modeloDe(nome, padrao) { return (nome && lib && lib.modelo(nome)) || padrao; },
            /** Nome do modelo para o netlist; com ajustes, cria um modelo derivado (MODELO_ID). tirar = parâmetros que não vão no .model */
            nomeModelo(nome, padrao, ajustes, el, tirar) {
                const m = (nome && lib && lib.modelo(nome)) || null;
                const base = m || padrao;
                const aj = C.lerAjustes(ajustes);
                (tirar || []).forEach((k) => delete aj[k]);
                const limpa = (pr) => { const o = Object.assign({}, pr); (tirar || []).forEach((k) => delete o[k]); return o; };
                if (Object.keys(aj).length || (tirar && tirar.some((k) => base.params[k] !== undefined))) {
                    const d = { nome: `${base.nome}_${el.id}`, tipo: base.tipo, params: Object.assign(limpa(base.params), aj) };
                    padroes.set(d.nome, d);
                    return d.nome;
                }
                if (m) { usados.add(m.nome); return m.nome; }
                padroes.set(padrao.nome, padrao);
                return padrao.nome;
            },
            novoNo: (suf) => { const n = `N_${idAtual}_${suf}`; nosUsados.add(n); return n; },
            acFonte: opcoes.acFonte || null,
            usarSubckt(nome) { subUsados.add(String(nome).toUpperCase()); }
        };
        const linhas = [`* ${opcoes.titulo || 'Circuito'} — exportado pelo Simulador de Circuitos (Falstad + SPICE), Marlon Sigales`];
        elementos.forEach((el0) => {
            const d = C.DEFS[el0.tipo];
            if (!d) return;
            const el = completo(el0, d);
            idAtual = el.id;
            const l = d.spice.call(d, el, (r.pinos[el.id] || []).map(nomeNo), ctx);
            if (l) linhas.push(l);
        });
        // subcircuitos usados dentro de subcircuitos
        const pend = [...subUsados];
        while (pend.length) {
            const s = lib && lib.subckt(pend.pop());
            if (!s) continue;
            s.corpo.forEach((l) => {
                if (/^x/i.test(l)) { const t = S.tokens(l).filter((x) => !x.includes('=')); const nm = t[t.length - 1].toUpperCase(); if (!subUsados.has(nm)) { subUsados.add(nm); pend.push(nm); } }
                const mm = l.match(/^[dqm]\S*\s+(?:\S+\s+){1,4}(\S+)/i);
                if (mm && lib.modelo(mm[1]) && !s.modelos.some((x) => x.nome === mm[1].toUpperCase())) usados.add(lib.modelo(mm[1]).nome);
            });
        }
        linhas.push('');
        padroes.forEach((m) => linhas.push(`.model ${m.nome} ${m.tipo}(${Object.entries(m.params).filter(([, v]) => isFinite(v)).map(([k, v]) => `${k}=${v}`).join(' ')})`));
        usados.forEach((n) => linhas.push(lib.modelo(n).texto));
        subUsados.forEach((n) => { const s = lib && lib.subckt(n); if (s) linhas.push(s.texto); });
        linhas.push('');
        // análises: resistência enorme de cada nó ao terra, para nó solto não travar o ngspice (matriz singular)
        if (opcoes.shunt) { linhas.push('* resistências de 1 TΩ ao terra (evitam nó solto)'); [...nosUsados].forEach((n, i) => linhas.push(`RSH${i + 1} ${n} 0 1e12`)); }
        if (opcoes.temp !== undefined && opcoes.temp !== null && opcoes.temp !== '') linhas.push(`.options temp=${opcoes.temp}`);
        if (opcoes.analise) linhas.push(...[].concat(opcoes.analise));
        else linhas.push(`.tran ${opcoes.passo || '10u'} ${opcoes.tempo || '10m'}`);
        linhas.push('.end');
        // só ASCII: o ngspice (e o LTspice) se perdem com acentos, Ω, µ e travessão no netlist
        return linhas.join('\n').replace(/Ω/g, 'ohm').replace(/[µμ]/g, 'u').replace(/[—–]/g, '-').replace(/°/g, ' graus')
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x00-\x7F]/g, '?');
    }

    const API = { nos, construir, exportarSpice };
    if (nodeJS) module.exports = API;
    else raiz.Circuito = API;
})(typeof window !== 'undefined' ? window : globalThis);
