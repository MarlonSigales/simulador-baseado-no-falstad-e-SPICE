/**
 * © 2026 Simulador de Circuitos (Falstad + SPICE) — Marlon Sigales. Todos os direitos reservados; copiar, reproduzir ou alterar exige autorização do autor (ver LICENSE).
 *
 * Importa circuitos do simulador do Prof. Falstad no formato de texto ("File → Export As Text", começa com "$ ")
 * ou por link (falstad.com/circuit/circuitjs.html?ctz=... ou ?cct=...).
 * Só lê o formato público de texto; nenhum código do Falstad foi copiado. Componentes de vários pinos são postos
 * com a geometria deste app e ligados por fios aos pontos de ligação do desenho original.
 */

'use strict';

(function (raiz) {
    const nodeJS = typeof module !== 'undefined' && module.exports;
    const C = nodeJS ? require('./componentes.js') : raiz.Componentes;
    const LZ = () => raiz.LZString || (nodeJS ? (() => { require('vm').runInThisContext(require('fs').readFileSync(require('path').join(__dirname, '../vendor/lz-string/lz-string.min.js'), 'utf8')); return globalThis.LZString; })() : null);

    const desescapar = (t) => String(t || '').replace(/\\s/g, ' ').replace(/\\n/g, '\n').replace(/\\p/g, '+').replace(/\\q/g, '=').replace(/\\\\/g, '\\');
    const num = (t, p = 0) => { const v = parseFloat(t); return isFinite(v) ? v : p; };

    /** Texto a partir de um link do Falstad (ctz comprimido ou cct puro); senão devolve o próprio texto. */
    function textoDoLink(entrada) {
        const s = String(entrada).trim();
        const m = s.match(/[?&](ctz|cct)=([^&#\s]+)/);
        if (!m) return s;
        if (m[1] === 'cct') return decodeURIComponent(m[2].replace(/\+/g, ' '));
        const L = LZ();
        if (!L) throw new Error('Descompressor do link (vendor/lz-string) não carregou');
        const t = L.decompressFromEncodedURIComponent(m[2]);
        if (!t) throw new Error('Link do Falstad inválido');
        return t;
    }

    // vetor perpendicular unitário (dy, −dx)/dn, como o Falstad usa para os pinos laterais
    const perp = (x1, y1, x2, y2) => { const dx = x2 - x1, dy = y2 - y1, dn = Math.hypot(dx, dy) || 1; return [dy / dn, -dx / dn]; };
    const sinal = (dx, dy) => (dy === 0 ? Math.sign(dx) : Math.sign(dy));
    const arred = (p) => [Math.floor(p[0] + 0.48), Math.floor(p[1] + 0.48)];
    /** giro deste app (0 = para a direita) a partir da direção ponto1 → ponto2 */
    const giroDe = (dx, dy) => (Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 0 : 2) : (dy >= 0 ? 1 : 3));

    const COR_LED = (r, g, b) => {
        if (r > 0.8 && g > 0.8 && b > 0.8) return 'branco';
        if (b > r && b > g) return 'azul';
        if (g > r && g > b) return 'verde';
        if (r > 0.7 && g > 0.5) return 'amarelo';
        return 'vermelho';
    };

    function fonteDoFalstad(rest) {
        // waveform freq maxV bias phase duty
        const wf = num(rest[0]), f = num(rest[1], 60), v = num(rest[2], 5), bias = num(rest[3]), fase = num(rest[4]) * 180 / Math.PI, duty = num(rest[5], 0.5);
        const p = { forma: 'dc', V: String(v + bias), amplitude: String(v), freq: String(f), offset: String(bias), fase: String(+fase.toFixed(3)), duty: String(duty) };
        if (wf === 1) p.forma = 'seno';
        else if (wf === 2) p.forma = 'quadrada';
        else if (wf !== 0) return { props: Object.assign(p, { forma: 'seno' }), aviso: 'forma de onda do Falstad sem equivalente (virou senoidal)' };
        return { props: p };
    }

    /**
     * Converte o texto do Falstad em elementos deste app.
     * Devolve { els, avisos, dt }.
     */
    function importar(texto) {
        const linhas = textoDoLink(texto).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        const els = [], avisos = [], ignorados = {};
        let dt = null;
        const cont = {};
        const id = (l) => { cont[l] = (cont[l] || 0) + 1; return l + cont[l]; };
        const fio = (a, b) => { if (a[0] !== b[0] || a[1] !== b[1]) els.push({ id: id('W'), tipo: 'fio', p: [a.slice(), b.slice()], props: {} }); };
        const bip = (tipo, l, x1, y1, x2, y2, props) => els.push({ id: id(l), tipo, p: [[x1, y1], [x2, y2]], props: Object.assign({}, C.DEFS[tipo].props, props) });
        /** componente de vários pinos: posiciona e liga por fios cada pino aos pontos do Falstad */
        const multi = (tipo, l, pos, rot, props, alvos) => {
            const el = { id: id(l), tipo, pos: arred(pos), rot, props: Object.assign({}, C.DEFS[tipo].props, props) };
            els.push(el);
            const meus = C.pinos(el);
            alvos.forEach((a, i) => { if (a && meus[i]) fio(meus[i], arred(a)); });
            return el;
        };
        const deslocar = (x, y, rot, off) => { const [dx, dy] = C.girar(off, rot); return [x - dx, y - dy]; };

        linhas.forEach((ln) => {
            const t = ln.split(/\s+/);
            const tipo = t[0];
            if (tipo === '$') { dt = num(t[2], null); return; }
            if (['o', 'h', '%', '?', '!', '&', '/', 'O'].includes(tipo) || tipo.startsWith('#')) return; // osciloscópio, dicas, ajustes
            const [x1, y1, x2, y2] = t.slice(1, 5).map(Number);
            const fl = num(t[5]), r = t.slice(6);
            if ([x1, y1, x2, y2].some((v) => !isFinite(v))) return;
            const dx = x2 - x1, dy = y2 - y1, [nx, ny] = perp(x1, y1, x2, y2), rot = giroDe(dx, dy);
            switch (tipo) {
                case 'w': fio([x1, y1], [x2, y2]); break;
                case 'r': bip('resistor', 'R', x1, y1, x2, y2, { R: r[0] }); break;
                case 'c': bip('capacitor', 'C', x1, y1, x2, y2, { C: r[0] }); break;
                case '209': bip('eletrolitico', 'C', x1, y1, x2, y2, { C: r[0] }); break;
                case 'l': bip('indutor', 'L', x1, y1, x2, y2, { L: r[0] }); break;
                case 'i': bip('fonteI', 'I', x1, y1, x2, y2, { I: r[0] }); break;
                case 's': bip('chave', 'S', x1, y1, x2, y2, { ligada: r[0] === '0' }); break; // no Falstad, posição 0 = fechada
                case '181': bip('lampada', 'LP', x1, y1, x2, y2, { Pn: String(num(r[1], 100)), Vn: String(num(r[2], 120)) }); break;
                case '370': bip('amperimetro', 'AM', x1, y1, x2, y2, {}); break;
                case 'v': { const f = fonteDoFalstad(r); bip('fonteV', 'V', x1, y1, x2, y2, f.props); if (f.aviso) avisos.push(f.aviso); break; }
                case 'R': { const f = fonteDoFalstad(r); multi('trilho', 'V', [x1, y1], (rot + 1) % 4, f.props, []); if (f.aviso) avisos.push(f.aviso); break; } // trilho daqui aponta para cima no giro 0
                case 'g': multi('terra', 'GND', [x1, y1], 0, {}, []); break;
                case 'd': case 'z': {
                    const props = {};
                    if (r[0] && isNaN(parseFloat(r[0]))) props.ajustes = ''; // nome de modelo do Falstad: usa o padrão daqui
                    bip(tipo === 'z' ? 'zener' : 'diodo', tipo === 'z' ? 'DZ' : 'D', x1, y1, x2, y2, props);
                    break;
                }
                case '162': bip('led', 'LED', x1, y1, x2, y2, { cor: COR_LED(num(r[0], 1), num(r[1]), num(r[2])) }); break;
                case 'L': multi('entradaLogica', 'IN', [x1, y1], [2, 3, 0, 1][rot], { alto: r[0] === '1' || r[0] === 'true', VDD: '5' }, []); break;
                case 'M': multi('saidaLogica', 'OUT', [x1, y1], rot, {}, []); break;
                case '207': multi('rotuloNo', 'LBL', [x1, y1], rot, { nome: desescapar(r.join(' ')) || 'N' }, []); break;
                case 'x': els.push({ id: id('TXT'), tipo: 'texto', pos: [x1, y1], rot: 0, props: { texto: desescapar(r.slice(1).join(' ')), tamanho: String(num(r[0], 14)) } }); break;
                case 't': {
                    // pinos do Falstad: base = ponto1; coletor/emissor = ponto2 ± 16·sinal·pnp na perpendicular
                    const pnp = num(r[0], 1) === -1 ? -1 : 1;
                    const hs = 16 * sinal(dx, dy) * pnp * ((fl & 1) ? -1 : 1);
                    const col = [x2 + hs * nx, y2 + hs * ny], emi = [x2 - hs * nx, y2 - hs * ny];
                    const beta = num(r[3], 100);
                    multi(pnp === 1 ? 'npn' : 'pnp', 'Q', deslocar(x1, y1, rot, [-32, 0]), rot, { ajustes: beta !== 100 ? `BF=${beta}` : '' }, [col, [x1, y1], emi]);
                    break;
                }
                case 'f': {
                    const pmos = (fl & 1) !== 0, hs2 = 16 * sinal(dx, dy) * ((fl & 8) ? -1 : 1);
                    const fonte = [x2 - hs2 * nx, y2 - hs2 * ny], dreno = [x2 + hs2 * nx, y2 + hs2 * ny];
                    const vt = num(r[0], 1.5), beta = num(r[1], 0.02);
                    multi(pmos ? 'pmos' : 'nmos', 'M', deslocar(x1, y1, rot, [-32, 0]), rot, { ajustes: `VTO=${pmos ? -Math.abs(vt) : vt} KP=${beta}` }, [dreno, [x1, y1], fonte]);
                    break;
                }
                case 'a': {
                    // entradas: − em ponto1 + h·n, + em ponto1 − h·n (h = 16, ou 8 se pequeno; troca com a flag 1); saída = ponto2
                    let h = ((fl & 2) ? 8 : 16) * sinal(dx, dy); if (fl & 1) h = -h;
                    const menos = [x1 + h * nx, y1 + h * ny], mais = [x1 - h * nx, y1 - h * ny];
                    multi('ampop', 'U', deslocar(x1, y1, rot, [-32, 0]), rot, { vmax: String(num(r[0], 15)), vmin: String(num(r[1], -15)), ganho: String(num(r[5], 1e5)) }, [[x2, y2], mais, menos]);
                    break;
                }
                case '150': case '151': case '152': case '153': case '154': {
                    const n = num(r[0], 2);
                    if (n !== 2) { avisos.push(`porta com ${n} entradas: importada com 2`); }
                    const h = ((fl & 1) ? 8 : 16);
                    const e0 = [x1 - h * nx, y1 - h * ny], e1 = [x1 + h * nx, y1 + h * ny];
                    const t2 = { 150: 'porta_and', 151: 'porta_nand', 152: 'porta_or', 153: 'porta_nor', 154: 'porta_xor' }[tipo];
                    multi(t2, 'U', deslocar(x1, y1, rot, [-48, 0]), rot, { VDD: String(num(r[2], 5)) }, [[x2, y2], e1, e0]);
                    break;
                }
                case 'I': multi('porta_not', 'U', deslocar(x1, y1, rot, [-48, 0]), rot, {}, [[x2, y2], [x1, y1]]); break;
                case '174': {
                    // potenciômetro: ponto2 vai para o múltiplo de 32 na direção principal; cursor no meio, deslocado na perpendicular
                    const G = 16;
                    let p2, off;
                    if (Math.abs(dx) > Math.abs(dy)) { p2 = [x1 + 2 * G * Math.sign(dx) * Math.ceil(Math.abs(dx) / (2 * G)), y1]; off = dx < 0 ? dy : -dy; }
                    else { p2 = [x1, y1 + 2 * G * Math.sign(dy) * Math.ceil(Math.abs(dy) / (2 * G))]; off = dy > 0 ? dx : -dx; }
                    if (!off) off = G;
                    const [px, py] = perp(x1, y1, p2[0], p2[1]);
                    const cur = [(x1 + p2[0]) / 2 + off * px, (y1 + p2[1]) / 2 + off * py];
                    multi('potenciometro', 'P', [(x1 + p2[0]) / 2, (y1 + p2[1]) / 2], giroDe(p2[0] - x1, p2[1] - y1), { R: r[0] || '1000', pos: String(num(r[1], 0.5)) }, [[x1, y1], p2, cur]);
                    break;
                }
                case 'p': bip('voltimetro', 'VM', x2, y2, x1, y1, {}); break; // ponta de prova: o Falstad mostra v(p1) − v(p2)
                case '172': { const f = fonteDoFalstad(r); multi('trilho', 'V', [x1, y1], (rot + 1) % 4, f.props, []); avisos.push('trilho variável do Falstad importado com a tensão máxima'); break; }
                case 'S': {
                    if (num(r[2], 2) !== 2) { ignorados['S (mais de 2 posições)'] = (ignorados['S (mais de 2 posições)'] || 0) + 1; break; }
                    const a0 = [x2 + 16 * nx, y2 + 16 * ny], a1 = [x2 - 16 * nx, y2 - 16 * ny];
                    multi('chave2', 'S', deslocar(x1, y1, rot, [-32, 0]), rot, { posicao: r[0] === '1' ? 'B' : 'A' }, [[x1, y1], a0, a1]);
                    break;
                }
                default: ignorados[tipo] = (ignorados[tipo] || 0) + 1;
            }
        });
        Object.entries(ignorados).forEach(([k, n]) => avisos.push(`${n} elemento(s) do tipo "${k}" do Falstad ainda não têm equivalente e ficaram de fora`));
        return { els, avisos: [...new Set(avisos)], dt };
    }

    const API = { importar, textoDoLink };
    if (nodeJS) module.exports = API;
    else raiz.ImportarFalstad = API;
})(typeof window !== 'undefined' ? window : globalThis);
