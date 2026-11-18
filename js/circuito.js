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
        });
        const avisos = [];
        let ref = 'GND';
        const temTerra = elementos.some((el) => C.DEFS[el.tipo] && C.DEFS[el.tipo].terra);
        if (!temTerra) {
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
        const prims = [], avisos = r.avisos.slice(), primDe = {};
        const internos = {};
        const buscarModelo = (nome, locais) => {
            if (!nome) return null;
            const u = String(nome).toUpperCase();
            const l = (locais || []).find((m) => m.nome === u);
            const m = l || (lib && lib.modelo(u));
            if (!m) avisos.push(`Modelo ${u} não encontrado: usei o padrão`);
            return m || null;
        };
        elementos.forEach((el) => {
            const d = C.DEFS[el.tipo];
            if (!d) { avisos.push(`Componente desconhecido: ${el.tipo}`); return; }
            const n = r.pinos[el.id];
            let primeiro = true;
            const ctx = {
                add(p) { p.nome = p.nome || (el.id + (primeiro ? '' : '.' + prims.length)); if (primeiro) primDe[el.id] = p.nome; primeiro = false; p.dono = el.id; prims.push(p); },
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
        // resistência série dos diodos (RS) vira um nó interno
        prims.slice().forEach((p) => {
            if (p.tipo === 'D' && p.modelo && p.modelo.params && p.modelo.params.RS > 0) {
                const k = nNos++;
                prims.push({ tipo: 'R', nome: p.nome + '.RS', nos: [p.nos[0], k], valor: p.modelo.params.RS, dono: p.dono });
                p.nos = [k, p.nos[1]];
            }
        });
        return { nNos, prims, pinos: r.pinos, primDe, avisos: [...new Set(avisos)] };
    }

    /** Netlist SPICE (.cir) para rodar no ngspice/LTspice. */
    function exportarSpice(elementos, lib, opcoes = {}) {
        const r = nos(elementos, lib);
        const usados = new Set(), subUsados = new Set(), padroes = new Map();
        const nomeNo = (k) => (k === 0 ? '0' : 'N' + k);
        const ctx = {
            nomeModelo(nome, padrao) {
                const m = nome && lib && lib.modelo(nome);
                if (m) { usados.add(m.nome); return m.nome; }
                padroes.set(padrao.nome, padrao);
                return padrao.nome;
            },
            usarSubckt(nome) { subUsados.add(String(nome).toUpperCase()); }
        };
        const linhas = [`* ${opcoes.titulo || 'Circuito'} — exportado pelo Simulador de Circuitos (Falstad + SPICE), Marlon Sigales`];
        elementos.forEach((el) => {
            const d = C.DEFS[el.tipo];
            if (!d) return;
            const l = d.spice(el, (r.pinos[el.id] || []).map(nomeNo), ctx);
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
        padroes.forEach((m) => linhas.push(`.model ${m.nome} ${m.tipo}(${Object.entries(m.params).map(([k, v]) => `${k}=${v}`).join(' ')})`));
        usados.forEach((n) => linhas.push(lib.modelo(n).texto));
        subUsados.forEach((n) => { const s = lib && lib.subckt(n); if (s) linhas.push(s.texto); });
        linhas.push('');
        linhas.push(`.tran ${opcoes.passo || '10u'} ${opcoes.tempo || '10m'}`);
        linhas.push('.end');
        return linhas.join('\n');
    }

    const API = { nos, construir, exportarSpice };
    if (nodeJS) module.exports = API;
    else raiz.Circuito = API;
})(typeof window !== 'undefined' ? window : globalThis);
