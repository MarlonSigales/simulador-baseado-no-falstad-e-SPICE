/**
 * © 2026 Simulador de Circuitos (Falstad + SPICE) — Marlon Sigales. Todos os direitos reservados; copiar, reproduzir ou alterar exige autorização do autor (ver LICENSE).
 *
 * Leitura de modelos SPICE (.model e .subckt), valores com sufixo SPICE e expansão de subcircuitos em primitivos do motor.
 * Funciona no navegador (global Spice) e no Node (require).
 */

'use strict';

(function (raiz) {
    const SUFIXOS = { t: 1e12, g: 1e9, meg: 1e6, k: 1e3, mil: 25.4e-6, m: 1e-3, u: 1e-6, 'µ': 1e-6, n: 1e-9, p: 1e-12, f: 1e-15 };

    /** "10k" → 10000; "2.2uF" → 2.2e-6; "1meg" → 1e6. Devolve NaN se não for número. */
    function valor(txt) {
        if (typeof txt === 'number') return txt;
        const s = String(txt ?? '').trim().toLowerCase().replace(',', '.');
        const m = s.match(/^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(meg|mil|[tgkmuµnpf])?/);
        if (!m) return NaN;
        return parseFloat(m[1]) * (m[2] ? SUFIXOS[m[2]] : 1);
    }

    /** 0.0047 → "4,7m"; usado nas telas. */
    function formatar(v, unidade = '') {
        if (v === null || v === undefined || typeof v !== 'number' || !isFinite(v)) return '—';
        if (v === 0) return '0 ' + unidade;
        const a = Math.abs(v);
        const tab = [[1e9, 'G'], [1e6, 'M'], [1e3, 'k'], [1, ''], [1e-3, 'm'], [1e-6, 'µ'], [1e-9, 'n'], [1e-12, 'p'], [1e-15, 'f']];
        for (const [f, p] of tab) {
            if (a >= f * 0.9995) {
                const n = v / f;
                const casas = Math.abs(n) >= 100 ? 0 : Math.abs(n) >= 10 ? 1 : 2;
                let t = n.toFixed(casas);
                if (t.includes('.')) t = t.replace(/\.?0+$/, '');
                return t.replace('.', ',') + ' ' + p + unidade;
            }
        }
        return v.toExponential(2).replace('.', ',') + ' ' + unidade;
    }

    /** Junta linhas "+", tira comentários; devolve [{linha, comentariosAntes:[...]}]. */
    function linhas(texto) {
        const brutas = String(texto).replace(/\r/g, '').split('\n');
        const out = [];
        let coment = [];
        for (let l of brutas) {
            const t = l.trim();
            if (!t) { coment = []; continue; }
            if (t[0] === '*') { coment.push(t.slice(1).trim()); continue; }
            if (t[0] === '+' && out.length) { out[out.length - 1].linha += ' ' + limpaInline(t.slice(1)); continue; }
            out.push({ linha: limpaInline(t), comentarios: coment });
            coment = [];
        }
        return out.filter((x) => x.linha);
    }
    function limpaInline(t) { return t.replace(/\s;.*$|^;.*$|\s\$\s.*$/, '').trim(); }

    /** Separa em palavras, mantendo "SIN(1 2 3)" e "D(IS=1n N=2)" juntos quando houver parênteses. */
    function tokens(l) {
        return l.replace(/\(/g, ' ( ').replace(/\)/g, ' ) ').replace(/\s*=\s*/g, '=').split(/\s+/).filter(Boolean);
    }

    function lerParametros(lista) {
        const p = {};
        lista.forEach((t) => { const i = t.indexOf('='); if (i > 0) p[t.slice(0, i).toUpperCase()] = valor(t.slice(i + 1)); });
        return p;
    }

    const TIPOS_MODELO = ['D', 'NPN', 'PNP', 'NMOS', 'PMOS', 'NJF', 'PJF', 'SW', 'CSW', 'R', 'C', 'L'];

    function lerModelo(l) {
        const t = tokens(l).filter((x) => x !== '(' && x !== ')');
        if (t.length < 3) return null;
        const nome = t[1].toUpperCase();
        let tipo = t[2].toUpperCase();
        const resto = t.slice(3);
        const params = lerParametros(resto);
        if (params.LEVEL === undefined) delete params.LEVEL;
        return { nome, tipo, params, suportado: ['D', 'NPN', 'PNP', 'NMOS', 'PMOS'].includes(tipo) };
    }

    /** Nomes dos pinos a partir de comentários como "* pinos: IN+ IN- VCC VEE OUT". */
    function pinosDosComentarios(coments, n) {
        for (const c of coments.slice().reverse()) {
            const m = c.match(/^(?:pinos?|pins?|connections?|conex(?:ões|oes)|nodes?|n[óo]s)\s*[:=]?\s*(.+)$/i);
            if (m) { const p = m[1].split(/[\s,]+/).filter(Boolean); if (p.length === n) return p; }
        }
        return null;
    }

    /**
     * Lê um arquivo de biblioteca (.lib, .mod, .sub, .cir, .txt).
     * Devolve { modelos: [...], subckts: [...], avisos: [...] }.
     */
    function lerBiblioteca(texto, arquivo = '') {
        const L = linhas(texto);
        const modelos = [], subckts = [], avisos = [];
        let atual = null;
        L.forEach(({ linha, comentarios }) => {
            const low = linha.toLowerCase();
            if (low.startsWith('.subckt')) {
                const t = tokens(linha).filter((x) => x !== '(' && x !== ')');
                const nome = (t[1] || '').toUpperCase();
                const nos = [];
                let temParams = false;
                for (const x of t.slice(2)) {
                    if (/^params:?$/i.test(x) || x.includes('=')) { temParams = true; break; }
                    nos.push(x.toUpperCase());
                }
                const nomesPinos = pinosDosComentarios(comentarios, nos.length) || nos;
                atual = { nome, nos, pinos: nomesPinos, corpo: [], modelos: [], arquivo, temParams, texto: linha };
                return;
            }
            if (low.startsWith('.ends')) {
                if (atual) { atual.texto += '\n' + atual.corpo.join('\n') + '\n.ENDS'; subckts.push(atual); }
                atual = null;
                return;
            }
            if (low.startsWith('.model')) {
                const m = lerModelo(linha);
                if (m) { m.arquivo = arquivo; m.texto = linha; (atual ? atual.modelos : modelos).push(m); if (atual) atual.corpo.push(linha); }
                return;
            }
            if (atual) { atual.corpo.push(linha); return; }
        });
        if (atual) avisos.push(`${arquivo}: subcircuito ${atual.nome} sem .ENDS`);
        subckts.forEach((s) => { s.suporte = verificarSuporte(s); });
        return { modelos, subckts, avisos };
    }

    const SUPORTADOS = 'RCLVIDEGFHQMX';
    /** Lista o que o motor em tempo real ainda não roda dentro do subcircuito. */
    function verificarSuporte(sub) {
        const falta = new Set();
        if (sub.temParams) falta.add('parâmetros (PARAMS:)');
        sub.corpo.forEach((l) => {
            const c = l[0].toUpperCase();
            if (c === '.') { if (!/^\.model/i.test(l)) falta.add(l.split(/\s/)[0].toUpperCase()); return; }
            if (!SUPORTADOS.includes(c)) falta.add(`elemento ${c}`);
            if (l.includes('{')) falta.add('expressões {…}');
            if ((c === 'E' || c === 'G') && /\b(value|poly|table|laplace)\b/i.test(l)) falta.add(`${c} com VALUE/POLY/TABLE`);
        });
        return { ok: falta.size === 0, falta: [...falta] };
    }

    /** Lê a fonte: "DC 5", "5", "SIN(0 1 60)", "PULSE(0 5 0 1n 1n 1m 2m)". */
    function lerFonte(resto) {
        const t = resto.filter((x) => x !== '(' && x !== ')');
        const f = { forma: 'dc', dc: 0 };
        for (let i = 0; i < t.length; i++) {
            const u = t[i].toUpperCase();
            if (u === 'DC') { f.dc = valor(t[++i]); continue; }
            if (u === 'AC') { i++; continue; }
            if (u === 'SIN') { const a = t.slice(i + 1).map(valor); Object.assign(f, { forma: 'seno', offset: a[0] || 0, amplitude: a[1] || 0, freq: a[2] || 0, atraso: a[3] || 0, fase: a[5] || 0 }); break; }
            if (u === 'PULSE') { const a = t.slice(i + 1).map(valor); Object.assign(f, { forma: 'pulso', v1: a[0] || 0, v2: a[1] || 0, td: a[2] || 0, tr: a[3] || 1e-9, tf: a[4] || 1e-9, pw: a[5] || 1, per: a[6] || 2 }); break; }
            if (!isNaN(valor(t[i])) && f.forma === 'dc') f.dc = valor(t[i]);
        }
        return f;
    }

    /**
     * Expande um subcircuito em primitivos.
     * ctx: { no(nomeGlobal) → índice, prims: [], buscarModelo(nome, locais), buscarSubckt(nome), avisos: [] }
     */
    function expandir(sub, nosExternos, prefixo, ctx, profundidade = 0) {
        if (profundidade > 20) throw new Error('Subcircuitos aninhados demais (laço?)');
        const mapa = {};
        sub.nos.forEach((n, i) => { mapa[n] = nosExternos[i]; });
        const no = (nome) => {
            const u = nome.toUpperCase();
            if (u === '0' || u === 'GND') return 0;
            if (mapa[u] === undefined) mapa[u] = ctx.no(prefixo + '.' + u);
            return mapa[u];
        };
        sub.corpo.forEach((l) => {
            if (l[0] === '.') return;
            const t = tokens(l);
            const nome = prefixo + '.' + t[0].toUpperCase();
            const c = t[0][0].toUpperCase();
            const limpos = t.filter((x) => x !== '(' && x !== ')');
            const modelo = (n) => ctx.buscarModelo(n, sub.modelos);
            switch (c) {
                case 'R': ctx.prims.push({ tipo: 'R', nome, nos: [no(t[1]), no(t[2])], valor: valor(limpos[3]) }); break;
                case 'C': ctx.prims.push({ tipo: 'C', nome, nos: [no(t[1]), no(t[2])], valor: valor(limpos[3]) }); break;
                case 'L': ctx.prims.push({ tipo: 'L', nome, nos: [no(t[1]), no(t[2])], valor: valor(limpos[3]) }); break;
                case 'V': case 'I': ctx.prims.push({ tipo: c, nome, nos: [no(t[1]), no(t[2])], fonte: lerFonte(t.slice(3)) }); break;
                case 'E': case 'G': ctx.prims.push({ tipo: c, nome, nos: [no(limpos[1]), no(limpos[2]), no(limpos[3]), no(limpos[4])], valor: valor(limpos[5]) }); break;
                case 'F': case 'H': ctx.prims.push({ tipo: c, nome, nos: [no(limpos[1]), no(limpos[2])], ref: prefixo + '.' + limpos[3].toUpperCase(), valor: valor(limpos[4]) }); break;
                case 'D': ctx.prims.push({ tipo: 'D', nome, nos: [no(limpos[1]), no(limpos[2])], modelo: modelo(limpos[3]) }); break;
                case 'Q': {
                    // Q c b e [s] modelo
                    let mi = 4; if (limpos[5] && !limpos[5].includes('=') && isNaN(valor(limpos[5]))) mi = 5;
                    ctx.prims.push({ tipo: 'Q', nome, nos: [no(limpos[1]), no(limpos[2]), no(limpos[3])], modelo: modelo(limpos[mi]) });
                    break;
                }
                case 'M': {
                    const p = lerParametros(limpos.slice(6));
                    ctx.prims.push({ tipo: 'M', nome, nos: [no(limpos[1]), no(limpos[2]), no(limpos[3])], modelo: modelo(limpos[5]), W: p.W, L: p.L });
                    break;
                }
                case 'X': {
                    const resto = limpos.slice(1).filter((x) => !x.includes('=') && !/^params:?$/i.test(x));
                    const s = ctx.buscarSubckt(resto[resto.length - 1]);
                    if (!s) throw new Error(`Subcircuito ${resto[resto.length - 1]} não encontrado (usado em ${nome})`);
                    expandir(s, resto.slice(0, -1).map(no), nome, ctx, profundidade + 1);
                    break;
                }
                default: ctx.avisos.push(`${nome}: elemento ${c} ignorado no modo tempo real`);
            }
        });
    }

    const API = { valor, formatar, linhas, tokens, lerBiblioteca, lerModelo, lerFonte, verificarSuporte, expandir, TIPOS_MODELO };
    if (typeof module !== 'undefined' && module.exports) module.exports = API;
    else raiz.Spice = API;
})(typeof window !== 'undefined' ? window : globalThis);
