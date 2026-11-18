/**
 * © 2026 Simulador de Circuitos (Falstad + SPICE) — Marlon Sigales. Todos os direitos reservados; copiar, reproduzir ou alterar exige autorização do autor (ver LICENSE).
 *
 * Catálogo de componentes: pinos, propriedades, desenho no canvas, primitivos do motor e linha SPICE.
 * Para pôr um componente novo, basta acrescentar um bloco em DEFS (e, se quiser, um item no GRUPOS).
 */

'use strict';

(function (raiz) {
    const S = (typeof module !== 'undefined' && module.exports) ? require('./spice.js') : raiz.Spice;
    const GRADE = 16;

    // Modelos "padrão" quando o componente não tem modelo da biblioteca
    const MODELOS_PADRAO = {
        D: { nome: 'D_PADRAO', tipo: 'D', params: { IS: 1e-14, N: 1 } },
        LED: { nome: 'LED_PADRAO', tipo: 'D', params: { IS: 1e-20, N: 1.5, RS: 2 } },
        NPN: { nome: 'NPN_PADRAO', tipo: 'NPN', params: { IS: 1e-14, BF: 100, BR: 1 } },
        PNP: { nome: 'PNP_PADRAO', tipo: 'PNP', params: { IS: 1e-14, BF: 100, BR: 1 } },
        NMOS: { nome: 'NMOS_PADRAO', tipo: 'NMOS', params: { VTO: 1.5, KP: 0.02 } },
        PMOS: { nome: 'PMOS_PADRAO', tipo: 'PMOS', params: { VTO: -1.5, KP: 0.02 } },
        ZENER: { nome: 'ZENER_PADRAO', tipo: 'D', params: { IS: 1e-14, N: 1, BV: 5.6, IBV: 5e-3 } }
    };

    // LED sem modelo da biblioteca: modelo pela cor, com a tensão direta típica a 10 mA (N = 2, RS = 5 Ω)
    // vermelho 1,8 V · amarelo 2,0 V · verde 2,1 V · azul 3,0 V · branco 3,1 V
    const LED_COR = {
        vermelho: { nome: 'LED_VERMELHO_PADRAO', tipo: 'D', params: { IS: 1.98e-17, N: 2, RS: 5 } },
        amarelo: { nome: 'LED_AMARELO_PADRAO', tipo: 'D', params: { IS: 4.1e-19, N: 2, RS: 5 } },
        verde: { nome: 'LED_VERDE_PADRAO', tipo: 'D', params: { IS: 6e-20, N: 2, RS: 5 } },
        azul: { nome: 'LED_AZUL_PADRAO', tipo: 'D', params: { IS: 1.65e-27, N: 2, RS: 5 } },
        branco: { nome: 'LED_BRANCO_PADRAO', tipo: 'D', params: { IS: 2.4e-28, N: 2, RS: 5 } }
    };
    const CORES_LED = { vermelho: '#ff2a2a', verde: '#2bd94a', azul: '#3a7bff', amarelo: '#ffd21a', branco: '#ffe9a0' }; // branco brilha amarelado para aparecer no fundo claro

    // ------------------------------------------------------------ geometria
    function girar([dx, dy], rot) {
        for (let i = 0; i < ((rot % 4) + 4) % 4; i++) [dx, dy] = [-dy, dx];
        return [dx, dy];
    }
    function pinosPorOffsets(el, offs) { return offs.map((o) => { const [dx, dy] = girar(o, el.rot || 0); return [el.pos[0] + dx, el.pos[1] + dy]; }); }

    // ------------------------------------------------------------ desenho
    /** Desenha um bipolo: terminais coloridos pela tensão e o corpo no meio. corpo(g, comprimento, info) em coordenadas locais. */
    function bipolo(g, el, info, tam, corpo) {
        const [[x1, y1], [x2, y2]] = el.p;
        const L = Math.hypot(x2 - x1, y2 - y1);
        if (L < 1) return;
        g.save();
        g.translate(x1, y1);
        g.rotate(Math.atan2(y2 - y1, x2 - x1));
        const c = Math.min(tam, L);
        const a = (L - c) / 2, b = (L + c) / 2;
        g.lineWidth = 3;
        g.strokeStyle = info.cor(info.v[0]); linha(g, 0, 0, a, 0);
        g.strokeStyle = info.cor(info.v[1]); linha(g, b, 0, L, 0);
        g.translate(a, 0);
        const grad = g.createLinearGradient(0, 0, c, 0);
        grad.addColorStop(0, info.cor(info.v[0])); grad.addColorStop(1, info.cor(info.v[1]));
        g.strokeStyle = grad; g.fillStyle = grad; g.lineWidth = 2.5;
        corpo(g, c, info);
        g.restore();
    }
    function linha(g, x1, y1, x2, y2) { g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); }
    /** Texto do valor ao lado do corpo, sempre de pé. */
    function rotulo(g, el, texto) {
        if (!texto) return;
        const [[x1, y1], [x2, y2]] = el.p;
        const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
        const L = Math.hypot(x2 - x1, y2 - y1) || 1;
        let nx = -(y2 - y1) / L, ny = (x2 - x1) / L;
        if (ny > 0 || (ny === 0 && nx > 0)) { nx = -nx; ny = -ny; }
        g.save();
        g.fillStyle = '#1d2b2b'; g.font = '12px Segoe UI, Roboto, Arial, sans-serif';
        g.textAlign = Math.abs(nx) > 0.5 ? (nx > 0 ? 'left' : 'right') : 'center';
        g.textBaseline = Math.abs(ny) > 0.5 ? (ny > 0 ? 'top' : 'bottom') : 'middle';
        g.fillText(texto, mx + nx * 18, my + ny * 18);
        g.restore();
    }
    function terminal(g, x1, y1, x2, y2, cor) { g.strokeStyle = cor; g.lineWidth = 3; linha(g, x1, y1, x2, y2); }

    const fmt = (v, u) => S.formatar(S.valor(v), u);
    const textoFonte = (p) => {
        switch (p.forma) {
            case 'seno': return `${fmt(p.amplitude, 'V')} ${fmt(p.freq, 'Hz')}`;
            case 'quadrada': return `⎍ ${fmt(p.amplitude, 'V')} ${fmt(p.freq, 'Hz')}`;
            case 'pwl': return 'PWL';
            default: return fmt(p.V, 'V');
        }
    };
    const fonteDasProps = (p) => ({
        forma: p.forma || 'dc', dc: S.valor(p.V), amplitude: S.valor(p.amplitude), freq: S.valor(p.freq),
        offset: S.valor(p.offset) || 0, fase: S.valor(p.fase) || 0, duty: isNaN(S.valor(p.duty)) ? 0.5 : S.valor(p.duty),
        pwl: lerPWL(p.pontos), repetir: !!p.repetir
    });
    /** "0 0, 1m 5, 2m 0" → [[0,0],[0.001,5],[0.002,0]] (pares tempo valor, em ordem de tempo) */
    function lerPWL(txt) {
        const v = String(txt || '').split(/[\s,;()]+/).filter(Boolean).map(S.valor).filter((x) => !isNaN(x));
        const pts = [];
        for (let i = 0; i + 1 < v.length; i += 2) pts.push([v[i], v[i + 1]]);
        return pts.sort((a, b) => a[0] - b[0]);
    }
    const spiceFonte = (p) => {
        const f = fonteDasProps(p);
        if (f.forma === 'seno') return `SIN(${f.offset} ${f.amplitude} ${f.freq} 0 0 ${f.fase})`;
        if (f.forma === 'quadrada') { const per = 1 / f.freq; return `PULSE(${f.offset - f.amplitude} ${f.offset + f.amplitude} 0 1n 1n ${per * f.duty} ${per})`; }
        if (f.forma === 'pwl') return `PWL(${f.pwl.map(([t, v]) => `${t} ${v}`).join(' ')})${f.repetir ? ' r=0' : ''}`;
        return `DC ${f.dc}`;
    };
    const CAMPOS_FONTE = [
        { k: 'forma', r: 'Forma de onda', tipo: 'sel', op: [['dc', 'Contínua (DC)'], ['seno', 'Senoidal'], ['quadrada', 'Quadrada'], ['pwl', 'Por pontos (PWL)']] },
        { k: 'V', r: 'Tensão', u: 'V', se: (p) => p.forma === 'dc' },
        { k: 'pontos', r: 'Pontos: tempo valor, tempo valor…', texto: true, dica: 'ex.: 0 0, 1m 5, 2m 5, 3m 0', se: (p) => p.forma === 'pwl' },
        { k: 'repetir', r: 'Repetir', tipo: 'bool', se: (p) => p.forma === 'pwl' },
        { k: 'amplitude', r: 'Amplitude (pico)', u: 'V', se: (p) => p.forma !== 'dc' && p.forma !== 'pwl' },
        { k: 'freq', r: 'Frequência', u: 'Hz', se: (p) => p.forma !== 'dc' && p.forma !== 'pwl' },
        { k: 'offset', r: 'Nível médio (offset)', u: 'V', se: (p) => p.forma !== 'dc' && p.forma !== 'pwl' },
        { k: 'fase', r: 'Fase', u: '°', se: (p) => p.forma === 'seno' },
        { k: 'duty', r: 'Ciclo de trabalho (0–1)', se: (p) => p.forma === 'quadrada' }
    ];

    function triangulo(g, x0, x1, h, cheio) {
        g.beginPath(); g.moveTo(x0, -h); g.lineTo(x1, 0); g.lineTo(x0, h); g.closePath();
        if (cheio) g.fill(); g.stroke();
    }

    function desenhaDiodo(g, c, info, extra) {
        const x0 = c / 2 - 8, x1 = c / 2 + 8;
        g.lineWidth = 2; linha(g, 0, 0, x0, 0); linha(g, x1, 0, c, 0);
        triangulo(g, x0, x1, 8, true);
        g.lineWidth = 3; linha(g, x1, -9, x1, 9);
        if (extra) extra(g, x0, x1);
    }

    /** Nome SPICE: usa o id se já começar com a letra certa (R1 → R1, LED1 → DLED1). */
    const nm = (letra, el) => (String(el.id).toUpperCase().startsWith(letra) ? el.id : letra + el.id);


    // ------------------------------------------------------------ não idealidades
    // Todos os parâmetros começam no valor ideal (0 em série, ∞ em paralelo) e podem ser ajustados.
    const RMIN = 1e-4; // menor resistência que o motor usa no lugar do "0" de fios e chaves (evita matriz singular)
    /** "∞", "inf", "" → Infinity; senão valor SPICE. */
    function num(v) {
        const t = String(v ?? '').trim().toLowerCase();
        if (t === '' || t === '∞' || t === 'inf' || t === 'infinito') return Infinity;
        return S.valor(v);
    }
    const ativo0 = (v) => { const x = num(v); return isFinite(x) && x > 0; };   // série: ativo se > 0
    const ativoInf = (v) => { const x = num(v); return isFinite(x) && x > 0; }; // paralelo: ativo se finito
    const NI = (k, r, u, dica) => ({ k, r, u, ni: true, dica });

    /**
     * Rede de um bipolo: elementos em série entre p0 e p1 (o 1º é o principal) e elementos em paralelo.
     * Itens: { t: 'R'|'L'|'C', v: número, suf: 'ESR' }. Itens com valor 0 em série ou ∞ em paralelo não entram.
     * modo 'prims' (motor) ou 'spice' (netlist). Devolve as linhas no modo spice.
     */
    function rede(el, n, ctx, serie, paralelo, modo) {
        const ser = serie.filter((x) => x.fixo || (isFinite(x.v) && x.v > 0));
        const par = (paralelo || []).filter((x) => isFinite(x.v) && x.v > 0);
        const linhas = [];
        let a = n[0];
        ser.forEach((x, i) => {
            const b = i === ser.length - 1 ? n[1] : ctx.novoNo(x.suf || String(i));
            if (modo === 'spice') linhas.push(`${nomeSpice(x.t, el, x.suf, i === 0)} ${a} ${b} ${x.v}`);
            else ctx.add({ tipo: x.t, nos: [a, b], valor: x.v }, { corrente: i === 0 });
            a = b;
        });
        par.forEach((x) => {
            if (modo === 'spice') linhas.push(`${nomeSpice(x.t, el, x.suf, false)} ${n[0]} ${n[1]} ${x.v}`);
            else ctx.add({ tipo: x.t, nos: [n[0], n[1]], valor: x.v }, { corrente: true });
        });
        return linhas.join('\n');
    }
    function nomeSpice(letra, el, suf, principal) { return principal ? nm(letra, el) : `${letra}${el.id}_${suf}`; }

    /** "RS=0.5 CJO=4p" → { RS: 0.5, CJO: 4e-12 } */
    function lerAjustes(txt) {
        const o = {};
        String(txt || '').split(/[\s,;]+/).forEach((t) => { const i = t.indexOf('='); if (i > 0) { const v = num(t.slice(i + 1)); if (!isNaN(v)) o[t.slice(0, i).toUpperCase()] = v; } });
        return o;
    }
    /** Modelo com os ajustes do componente por cima (não altera a biblioteca). */
    function comAjustes(m, txt, el) {
        const aj = lerAjustes(txt);
        if (!Object.keys(aj).length) return m;
        return { nome: `${m.nome}_${el.id}`, tipo: m.tipo, params: Object.assign({}, m.params, aj) };
    }
    const CAMPO_AJUSTES = (dica) => ({ k: 'ajustes', r: 'Ajustes do modelo (sobrescrevem o .model)', ni: true, texto: true, dica });

    function modeloTexto(el, padrao) { return el.props.modelo || padrao; }

    // ------------------------------------------------------------ catálogo
    const DEFS = {
        fio: {
            icone: '╱', nome: 'Fio', grupo: 'ferramentas', bipolo: true, tecla: 'w', props: { R: '0' },
            campos: [NI('R', 'Resistência do fio', 'Ω', '0 = ideal')],
            desenhar(g, el, info) { const [[a, b], [c, d]] = el.p; terminal(g, a, b, c, d, info.cor(info.v[0])); },
            prims(el, n, ctx) { ctx.add({ tipo: 'R', nos: n, valor: Math.max(num(el.props.R) || 0, RMIN) }); },
            spice(el, n) { return `${nm('R', el)} ${n[0]} ${n[1]} ${Math.max(num(el.props.R) || 0, RMIN)}`; }
        },
        resistor: {
            icone: 'Ω', nome: 'Resistor', grupo: 'passivos', bipolo: true, tecla: 'r', props: { R: '1k', ESL: '0', Cp: '0' },
            campos: [{ k: 'R', r: 'Resistência', u: 'Ω' }, NI('ESL', 'Indutância série (ESL)', 'H', '0 = ideal'), NI('Cp', 'Capacitância em paralelo', 'F', '0 = ideal')],
            texto: (el) => fmt(el.props.R, 'Ω'),
            desenhar(g, el, info) {
                bipolo(g, el, info, 32, (g, c) => {
                    g.beginPath(); g.moveTo(0, 0);
                    for (let i = 0; i < 8; i++) g.lineTo((i + 0.5) * c / 8, i % 2 ? 6 : -6);
                    g.lineTo(c, 0); g.stroke();
                });
            },
            rede(el) { return [[{ t: 'R', v: S.valor(el.props.R), fixo: true }, { t: 'L', v: num(el.props.ESL), suf: 'ESL' }], [{ t: 'C', v: num(el.props.Cp), suf: 'CP' }]]; },
            prims(el, n, ctx) { const [a, b] = this.rede(el); rede(el, n, ctx, a, b, 'prims'); },
            spice(el, n, ctx) { const [a, b] = this.rede(el); return rede(el, n, ctx, a, b, 'spice'); }
        },
        capacitor: {
            icone: 'C', nome: 'Capacitor', grupo: 'passivos', bipolo: true, tecla: 'c', props: { C: '10u', ESR: '0', ESL: '0', Rfuga: '∞' },
            campos: [{ k: 'C', r: 'Capacitância', u: 'F' }, NI('ESR', 'Resistência série (ESR)', 'Ω', '0 = ideal'), NI('ESL', 'Indutância série (ESL)', 'H', '0 = ideal'), NI('Rfuga', 'Resistência de fuga (paralelo)', 'Ω', '∞ = ideal')],
            texto: (el) => fmt(el.props.C, 'F'),
            desenhar(g, el, info) {
                bipolo(g, el, info, 24, (g, c) => {
                    g.lineWidth = 2; linha(g, 0, 0, c / 2 - 4, 0); linha(g, c / 2 + 4, 0, c, 0);
                    g.lineWidth = 3; linha(g, c / 2 - 4, -11, c / 2 - 4, 11); linha(g, c / 2 + 4, -11, c / 2 + 4, 11);
                });
            },
            rede(el) { return [[{ t: 'C', v: S.valor(el.props.C), fixo: true }, { t: 'R', v: num(el.props.ESR), suf: 'ESR' }, { t: 'L', v: num(el.props.ESL), suf: 'ESL' }], [{ t: 'R', v: num(el.props.Rfuga), suf: 'FUGA' }]]; },
            prims(el, n, ctx) { const [a, b] = this.rede(el); rede(el, n, ctx, a, b, 'prims'); },
            spice(el, n, ctx) { const [a, b] = this.rede(el); return rede(el, n, ctx, a, b, 'spice'); }
        },
        indutor: {
            icone: 'L', nome: 'Indutor', grupo: 'passivos', bipolo: true, tecla: 'L', props: { L: '10m', DCR: '0', Cp: '0', Rp: '∞' },
            campos: [{ k: 'L', r: 'Indutância', u: 'H' }, NI('DCR', 'Resistência do enrolamento (DCR)', 'Ω', '0 = ideal'), NI('Cp', 'Capacitância entre espiras (paralelo)', 'F', '0 = ideal'), NI('Rp', 'Perdas no núcleo (R em paralelo)', 'Ω', '∞ = ideal')],
            texto: (el) => fmt(el.props.L, 'H'),
            desenhar(g, el, info) {
                bipolo(g, el, info, 40, (g, c) => {
                    g.beginPath();
                    for (let i = 0; i < 4; i++) g.arc((i + 0.5) * c / 4, 0, c / 8, Math.PI, 0);
                    g.stroke();
                });
            },
            rede(el) { return [[{ t: 'L', v: S.valor(el.props.L), fixo: true }, { t: 'R', v: num(el.props.DCR), suf: 'DCR' }], [{ t: 'C', v: num(el.props.Cp), suf: 'CP' }, { t: 'R', v: num(el.props.Rp), suf: 'RP' }]]; },
            prims(el, n, ctx) { const [a, b] = this.rede(el); rede(el, n, ctx, a, b, 'prims'); },
            spice(el, n, ctx) { const [a, b] = this.rede(el); return rede(el, n, ctx, a, b, 'spice'); }
        },
        chave: {
            icone: 'S', nome: 'Chave (clique para abrir/fechar)', curto: 'Chave', grupo: 'passivos', bipolo: true, tecla: 's', props: { ligada: false, Ron: '0', Roff: '∞' },
            campos: [{ k: 'ligada', r: 'Fechada', tipo: 'bool' }, NI('Ron', 'Resistência fechada (Ron)', 'Ω', '0 = ideal'), NI('Roff', 'Resistência aberta (Roff)', 'Ω', '∞ = ideal')],
            texto: (el) => el.props.ligada ? 'fechada' : 'aberta',
            clicavel: true,
            clicar(el) { el.props.ligada = !el.props.ligada; },
            desenhar(g, el, info) {
                bipolo(g, el, info, 32, (g, c) => {
                    g.lineWidth = 2.5;
                    g.beginPath(); g.arc(0, 0, 2.5, 0, 7); g.fill(); g.beginPath(); g.arc(c, 0, 2.5, 0, 7); g.fill();
                    if (el.props.ligada) linha(g, 0, 0, c, 0); else linha(g, 0, 0, c - 3, -14);
                });
            },
            prims(el, n, ctx) { ctx.add({ tipo: 'SW', nos: n, ligada: !!el.props.ligada, ron: Math.max(num(el.props.Ron) || 0, RMIN), roff: num(el.props.Roff) }); },
            spice(el, n) {
                const r = el.props.ligada ? Math.max(num(el.props.Ron) || 0, RMIN) : num(el.props.Roff);
                return isFinite(r) ? `${nm('R', el)} ${n[0]} ${n[1]} ${r}` : `* ${el.id}: chave aberta ideal`;
            }
        },
        fonteV: {
            icone: 'V', nome: 'Fonte de tensão', grupo: 'fontes', bipolo: true, tecla: 'v', tensaoInvertida: true,
            props: { forma: 'dc', V: '5', amplitude: '5', freq: '60', offset: '0', fase: '0', duty: '0.5', pontos: '0 0, 1m 5, 2m 5, 3m 0', repetir: true },
            campos: CAMPOS_FONTE.concat([NI('Rint', 'Resistência interna (série)', 'Ω', '0 = ideal')]),
            texto: (el) => textoFonte(el.props),
            desenhar(g, el, info) {
                // p[0] = negativo, p[1] = positivo (como no Falstad: desenha do − para o +)
                bipolo(g, el, info, 32, (g, c) => {
                    g.lineWidth = 2; g.fillStyle = '#fff';
                    g.beginPath(); g.arc(c / 2, 0, 15, 0, 7); g.fill(); g.stroke();
                    g.fillStyle = '#1d2b2b'; g.strokeStyle = '#1d2b2b'; g.lineWidth = 1.6;
                    if (el.props.forma === 'seno') {
                        g.beginPath(); for (let i = -9; i <= 9; i++) g.lineTo(c / 2 + i, -6 * Math.sin(i / 9 * Math.PI)); g.stroke();
                    } else if (el.props.forma === 'quadrada') {
                        g.beginPath(); g.moveTo(c / 2 - 9, 5); g.lineTo(c / 2 - 9, -5); g.lineTo(c / 2, -5); g.lineTo(c / 2, 5); g.lineTo(c / 2 + 9, 5); g.lineTo(c / 2 + 9, -5); g.stroke();
                    } else {
                        linha(g, c / 2 + 4, -5, c / 2 + 4, 5); linha(g, c / 2 + 9, 0, c / 2 - 1, 0); // + perto do terminal positivo
                        linha(g, c / 2 - 6, -4, c / 2 - 6, 4); // −
                    }
                });
            },
            prims(el, n, ctx) {
                const r = num(el.props.Rint), k = r > 0 && isFinite(r) ? ctx.novoNo('INT') : n[1];
                ctx.add({ tipo: 'V', nos: [k, n[0]], fonte: fonteDasProps(el.props) }, { corrente: true });
                if (k !== n[1]) ctx.add({ tipo: 'R', nos: [k, n[1]], valor: r });
            },
            spice(el, n, ctx) {
                const r = num(el.props.Rint), k = r > 0 && isFinite(r) ? ctx.novoNo('INT') : n[1];
                return `${nm('V', el)} ${k} ${n[0]} ${spiceFonte(el.props)}${ctx.acFonte === el.id ? ' AC 1' : ''}` + (k !== n[1] ? `\nR${el.id}_INT ${k} ${n[1]} ${r}` : '');
            }
        },
        trilho: {
            icone: '+', nome: 'Trilho de tensão (+V)', curto: 'Trilho +V', grupo: 'fontes', bipolo: false, tecla: 'V',
            props: { forma: 'dc', V: '5', amplitude: '5', freq: '60', offset: '0', fase: '0', duty: '0.5', pontos: '0 0, 1m 5, 2m 5, 3m 0', repetir: true },
            campos: CAMPOS_FONTE.concat([NI('Rint', 'Resistência interna (série)', 'Ω', '0 = ideal')]),
            pinos: (el) => pinosPorOffsets(el, [[0, 0]]),
            caixa: (el) => caixaGirada(el, -24, -36, 48, 36),
            desenhar(g, el, info) {
                comGiro(g, el, () => {
                    terminal(g, 0, 0, 0, -16, info.cor(info.v[0]));
                    g.fillStyle = '#1d2b2b'; g.beginPath(); g.arc(0, -16, 3, 0, 7); g.fill();
                    g.translate(0, -28); g.rotate(-(el.rot || 0) * Math.PI / 2);
                    g.font = 'bold 12px Segoe UI, Roboto, Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
                    g.fillText(textoFonte(el.props), 0, 0);
                });
            },
            prims(el, n, ctx) {
                const r = num(el.props.Rint), k = r > 0 && isFinite(r) ? ctx.novoNo('INT') : n[0];
                ctx.add({ tipo: 'V', nos: [k, 0], fonte: fonteDasProps(el.props) });
                if (k !== n[0]) ctx.add({ tipo: 'R', nos: [k, n[0]], valor: r });
            },
            spice(el, n, ctx) {
                const r = num(el.props.Rint), k = r > 0 && isFinite(r) ? ctx.novoNo('INT') : n[0];
                return `${nm('V', el)} ${k} 0 ${spiceFonte(el.props)}${ctx.acFonte === el.id ? ' AC 1' : ''}` + (k !== n[0] ? `\nR${el.id}_INT ${k} ${n[0]} ${r}` : '');
            }
        },
        fonteI: {
            icone: 'I', nome: 'Fonte de corrente', grupo: 'fontes', bipolo: true, props: { I: '1m', Rp: '∞' },
            campos: [{ k: 'I', r: 'Corrente', u: 'A' }, NI('Rp', 'Resistência interna (paralelo)', 'Ω', '∞ = ideal')],
            texto: (el) => fmt(el.props.I, 'A'),
            desenhar(g, el, info) {
                bipolo(g, el, info, 32, (g, c) => {
                    g.lineWidth = 2; g.fillStyle = '#fff';
                    g.beginPath(); g.arc(c / 2, 0, 15, 0, 7); g.fill(); g.stroke();
                    g.strokeStyle = '#1d2b2b'; g.fillStyle = '#1d2b2b'; g.lineWidth = 1.6;
                    linha(g, c / 2 - 8, 0, c / 2 + 5, 0); triangulo(g, c / 2 + 3, c / 2 + 9, 4, true);
                });
            },
            prims(el, n, ctx) {
                ctx.add({ tipo: 'I', nos: n, fonte: { forma: 'dc', dc: S.valor(el.props.I) } }, { corrente: true });
                if (ativoInf(el.props.Rp)) ctx.add({ tipo: 'R', nos: n, valor: num(el.props.Rp) }, { corrente: true });
            },
            spice(el, n) { return `${nm('I', el)} ${n[0]} ${n[1]} DC ${el.props.I}` + (ativoInf(el.props.Rp) ? `\nR${el.id}_P ${n[0]} ${n[1]} ${num(el.props.Rp)}` : ''); }
        },
        terra: {
            icone: '⏚', nome: 'Terra', grupo: 'fontes', bipolo: false, tecla: 'g', props: {},
            pinos: (el) => pinosPorOffsets(el, [[0, 0]]),
            caixa: (el) => [el.pos[0] - 12, el.pos[1], 24, 22],
            desenhar(g, el, info) {
                const [x, y] = el.pos;
                terminal(g, x, y, x, y + 10, info.cor(0));
                g.strokeStyle = '#5f6f6d'; g.lineWidth = 2;
                linha(g, x - 11, y + 10, x + 11, y + 10); linha(g, x - 7, y + 15, x + 7, y + 15); linha(g, x - 3, y + 20, x + 3, y + 20);
            },
            terra: true,
            prims() {},
            spice() { return ''; }
        },
        diodo: {
            icone: '▷', nome: 'Diodo', grupo: 'semicondutores', bipolo: true, tecla: 'd', props: { modelo: '', ajustes: '' },
            campos: [{ k: 'modelo', r: 'Modelo SPICE', tipo: 'modelo', tipos: ['D'] }, CAMPO_AJUSTES('ex.: RS=0.5 CJO=4p N=1.8 BV=100 (vazio = como no modelo)')],
            texto: (el) => modeloTexto(el, ''),
            desenhar(g, el, info) { bipolo(g, el, info, 32, (g, c) => desenhaDiodo(g, c, info)); },
            prims(el, n, ctx) { ctx.add({ tipo: 'D', nos: n, modelo: comAjustes(ctx.modelo(el.props.modelo, ['D']) || MODELOS_PADRAO.D, el.props.ajustes, el) }); },
            spice(el, n, ctx) { return `${nm('D', el)} ${n[0]} ${n[1]} ${ctx.nomeModelo(el.props.modelo, MODELOS_PADRAO.D, el.props.ajustes, el)}`; }
        },
        zener: {
            icone: 'Z', nome: 'Diodo zener', curto: 'Zener', grupo: 'semicondutores', bipolo: true, tecla: 'z', props: { modelo: '', ajustes: '' },
            campos: [{ k: 'modelo', r: 'Modelo SPICE (com BV)', tipo: 'modelo', tipos: ['D'] }, CAMPO_AJUSTES('ex.: RS=0.5 CJO=4p N=1.8 BV=100 (vazio = como no modelo)')],
            texto: (el) => el.props.modelo || 'zener 5,6 V',
            desenhar(g, el, info) {
                bipolo(g, el, info, 32, (g, c) => desenhaDiodo(g, c, info, (g, x0, x1) => {
                    g.lineWidth = 3; linha(g, x1, -9, x1 - 5, -13); linha(g, x1, 9, x1 + 5, 13);
                }));
            },
            prims(el, n, ctx) { ctx.add({ tipo: 'D', nos: n, modelo: comAjustes(ctx.modelo(el.props.modelo, ['D']) || MODELOS_PADRAO.ZENER, el.props.ajustes, el) }); },
            spice(el, n, ctx) { return `${nm('D', el)} ${n[0]} ${n[1]} ${ctx.nomeModelo(el.props.modelo, MODELOS_PADRAO.ZENER, el.props.ajustes, el)}`; }
        },
        led: {
            icone: '✦', nome: 'LED', grupo: 'semicondutores', bipolo: true, tecla: 'l', props: { modelo: '', cor: 'vermelho', ajustes: '' },
            campos: [
                { k: 'cor', r: 'Cor (sem modelo, define a tensão direta típica)', tipo: 'sel', op: [['vermelho', 'vermelho (≈1,8 V)'], ['amarelo', 'amarelo (≈2,0 V)'], ['verde', 'verde (≈2,1 V)'], ['azul', 'azul (≈3,0 V)'], ['branco', 'branco (≈3,1 V)']] },
                { k: 'modelo', r: 'Modelo SPICE', tipo: 'modelo', tipos: ['D'] },
                CAMPO_AJUSTES('ex.: RS=0.5 CJO=4p N=1.8 BV=100 (vazio = como no modelo)')
            ],
            texto: (el) => modeloTexto(el, ''),
            desenhar(g, el, info) {
                const i = Math.max(0, info.i || 0);
                bipolo(g, el, info, 32, (g, c) => {
                    const brilho = Math.min(1, Math.sqrt(i / 0.01)); // 1 mA já aparece; 10 mA = brilho total
                    if (brilho > 0.02) {
                        g.save(); g.globalAlpha = 0.25 + 0.6 * brilho; g.fillStyle = CORES_LED[el.props.cor] || '#f22';
                        g.beginPath(); g.arc(c / 2, 0, 12 + 6 * brilho, 0, 7); g.fill(); g.restore();
                    }
                    desenhaDiodo(g, c, info, (g, x0, x1) => {
                        g.lineWidth = 1.5; g.strokeStyle = '#1d2b2b';
                        linha(g, x0 + 2, -12, x0 + 8, -20); linha(g, x1 - 2, -12, x1 + 4, -20);
                    });
                });
            },
            prims(el, n, ctx) { ctx.add({ tipo: 'D', nos: n, modelo: comAjustes(ctx.modelo(el.props.modelo, ['D']) || LED_COR[el.props.cor] || LED_COR.vermelho, el.props.ajustes, el) }); },
            spice(el, n, ctx) { return `${nm('D', el)} ${n[0]} ${n[1]} ${ctx.nomeModelo(el.props.modelo, LED_COR[el.props.cor] || LED_COR.vermelho, el.props.ajustes, el)}`; }
        },
        npn: transistorBJT('npn', 'Transistor NPN', 'NPN', 'n'),
        pnp: transistorBJT('pnp', 'Transistor PNP', 'PNP', 'p'),
        nmos: transistorMOS('nmos', 'MOSFET canal N', 'NMOS'),
        pmos: transistorMOS('pmos', 'MOSFET canal P', 'PMOS'),
        ampop: {
            icone: '△', nome: 'Amp-op ideal (− em cima)', curto: 'Amp-op ideal', grupo: 'integrados', bipolo: false, tecla: 'a', props: { ganho: '100k', vmax: '15', vmin: '-15', Rin: '∞', Rout: '0', GBW: '∞', SR: '∞', Vos: '0', Ib: '0' },
            campos: [{ k: 'ganho', r: 'Ganho em malha aberta' }, { k: 'vmax', r: 'Saturação positiva', u: 'V' }, { k: 'vmin', r: 'Saturação negativa', u: 'V' },
                NI('Rin', 'Resistência de entrada (diferencial)', 'Ω', '∞ = ideal'), NI('Rout', 'Resistência de saída', 'Ω', '0 = ideal'),
                NI('GBW', 'Produto ganho × banda (GBW)', 'Hz', '∞ = ideal'), NI('SR', 'Taxa de subida (slew rate)', 'V/s', '∞ = ideal; ex.: 0.5meg = 0,5 V/µs'),
                NI('Vos', 'Tensão de offset', 'V', '0 = ideal'), NI('Ib', 'Corrente de polarização das entradas', 'A', '0 = ideal')],
            // pinos: saída, entrada +, entrada −
            pinos: (el) => pinosPorOffsets(el, [[48, 0], [-32, 16], [-32, -16]]),
            nomesPinos: ['saída', 'entrada +', 'entrada −'],
            caixa: (el) => caixaGirada(el, -32, -28, 80, 56),
            desenhar(g, el, info) {
                comGiro(g, el, () => {
                    terminal(g, -32, -16, -16, -16, info.cor(info.v[2]));
                    terminal(g, -32, 16, -16, 16, info.cor(info.v[1]));
                    terminal(g, 32, 0, 48, 0, info.cor(info.v[0]));
                    g.strokeStyle = '#1d2b2b'; g.fillStyle = '#fff'; g.lineWidth = 2;
                    g.beginPath(); g.moveTo(-16, -28); g.lineTo(32, 0); g.lineTo(-16, 28); g.closePath(); g.fill(); g.stroke();
                    g.lineWidth = 1.6; linha(g, -12, -16, -6, -16); linha(g, -12, 16, -6, 16); linha(g, -9, 13, -9, 19);
                });
            },
            /**
             * Amp-op: estágio com ganho e saturação (OP) → [polo do GBW com limite de corrente = slew rate] → buffer → Rout.
             * Só cria o que não for ideal.
             */
            prims(el, n, ctx) {
                const [out, ip, im] = n, p = el.props;
                const A = S.valor(p.ganho), gbw = num(p.GBW), sr = num(p.SR), rout = num(p.Rout), rin = num(p.Rin), ib = num(p.Ib), vos = num(p.Vos) || 0;
                const temPolo = isFinite(gbw) || isFinite(sr);
                const usaRout = isFinite(rout) && rout > 0;
                const k1 = temPolo || usaRout ? ctx.novoNo('A') : out;
                // com polo, a saturação fica no estágio de saída (o nó interno do polo não satura, como num amp-op real)
                const vmax = S.valor(p.vmax), vmin = S.valor(p.vmin);
                ctx.add({ tipo: 'OP', nos: [k1, ip, im], ganho: A, vmax: temPolo ? 1e30 : vmax, vmin: temPolo ? -1e30 : vmin, vos });
                let k = k1;
                if (temPolo) {
                    const fp = (isFinite(gbw) ? gbw : 1e12) / A;   // só slew rate: polo bem alto
                    const R = 1000, C = 1 / (2 * Math.PI * fp * R);
                    const k2 = ctx.novoNo('P');
                    if (isFinite(sr)) ctx.add({ tipo: 'RLIM', nos: [k1, k2], valor: R, imax: sr * C }); else ctx.add({ tipo: 'R', nos: [k1, k2], valor: R });
                    ctx.add({ tipo: 'C', nos: [k2, 0], valor: C });
                    const k3 = usaRout ? ctx.novoNo('B') : out;
                    ctx.add({ tipo: 'OP', nos: [k3, k2, 0], ganho: 1, vmax, vmin }); // buffer de saída com os trilhos
                    k = k3;
                }
                if (usaRout) ctx.add({ tipo: 'R', nos: [k, out], valor: rout });
                if (isFinite(rin) && rin > 0) ctx.add({ tipo: 'R', nos: [ip, im], valor: rin });
                if (ib) { ctx.add({ tipo: 'I', nos: [ip, 0], fonte: { forma: 'dc', dc: ib } }); ctx.add({ tipo: 'I', nos: [im, 0], fonte: { forma: 'dc', dc: ib } }); }
            },
            spice(el, n, ctx) {
                const [out, ip, im] = n, p = el.props, id = el.id;
                const A = S.valor(p.ganho), gbw = num(p.GBW), rout = num(p.Rout), rin = num(p.Rin), ib = num(p.Ib), vos = num(p.Vos) || 0;
                const L = [`* ${id}: amp-op (a saturação em ${p.vmin} V e ${p.vmax} V e o slew rate não vão para o netlist linear)`];
                const ipx = vos ? ctx.novoNo('VOS') : ip;
                if (vos) L.push(`V${id}_OS ${ipx} ${ip} ${vos}`);
                const usaRout = isFinite(rout) && rout > 0;
                if (isFinite(gbw)) {
                    const a = ctx.novoNo('A'), pp = ctx.novoNo('P'), b = usaRout ? ctx.novoNo('B') : out;
                    const R = 1000, C = 1 / (2 * Math.PI * (gbw / A) * R);
                    L.push(`E${id} ${a} 0 ${ipx} ${im} ${A}`, `R${id}_P ${a} ${pp} ${R}`, `C${id}_P ${pp} 0 ${C}`, `E${id}_B ${b} 0 ${pp} 0 1`);
                    if (usaRout) L.push(`R${id}_OUT ${b} ${out} ${rout}`);
                } else if (usaRout) { const a = ctx.novoNo('A'); L.push(`E${id} ${a} 0 ${ipx} ${im} ${A}`, `R${id}_OUT ${a} ${out} ${rout}`); }
                else L.push(`E${id} ${out} 0 ${ipx} ${im} ${A}`);
                if (isFinite(rin) && rin > 0) L.push(`R${id}_IN ${ip} ${im} ${rin}`);
                if (ib) L.push(`I${id}_BP ${ip} 0 ${ib}`, `I${id}_BN ${im} 0 ${ib}`);
                return L.join('\n');
            }
        },
        caixa: {
            icone: '▭', nome: 'Caixa SPICE (subcircuito)', curto: 'Caixa SPICE', grupo: 'integrados', bipolo: false, tecla: 'x',
            props: { modelo: '', pinos: 'A, B, C, D', titulo: '', simbolo: 'auto' },
            campos: [
                { k: 'modelo', r: 'Subcircuito (.subckt)', tipo: 'subckt' },
                { k: 'simbolo', r: 'Símbolo', tipo: 'sel', op: [['auto', 'Automático (triângulo se for amp-op)'], ['ampop', 'Amp-op (triângulo)'], ['caixa', 'Caixa retangular']] },
                { k: 'pinos', r: 'Nomes dos pinos (em ordem, separados por vírgula)', se: (p) => !p.modelo },
                { k: 'titulo', r: 'Título na caixa' }
            ],
            nomesPinosDe(el, lib) {
                const s = el.props.modelo && lib && lib.subckt(el.props.modelo);
                if (s) return s.pinos;
                return String(el.props.pinos || '').split(',').map((x) => x.trim()).filter(Boolean);
            },
            geometria(el, lib) {
                const nomes = this.nomesPinosDe(el, lib);
                const papeis = el.props.simbolo !== 'caixa' ? papeisAmpop(nomes) : null;
                if (papeis && (el.props.simbolo === 'ampop' || el.props.simbolo === 'auto' || !el.props.simbolo)) {
                    // símbolo triangular da bibliografia: − em cima, + embaixo, saída na ponta, alimentações em cima/embaixo
                    const pos = { inm: [-48, -16], inp: [-48, 16], out: [64, 0], vcc: [0, -48], vee: [0, 48] };
                    return { ampop: true, nomes, papeis, offs: papeis.map((p) => pos[p]) };
                }
                const esq = Math.ceil(nomes.length / 2), dir = nomes.length - esq;
                const linhas = Math.max(esq, dir, 1);
                const h = (linhas + 1) * 32, w = 112;
                const offs = nomes.map((_, i) => i < esq ? [-w / 2 - 16, -h / 2 + 32 * (i + 1)] : [w / 2 + 16, -h / 2 + 32 * (i - esq + 1)]);
                return { nomes, offs, w, h, esq };
            },
            pinos(el, lib) { return pinosPorOffsets(el, this.geometria(el, lib).offs); },
            caixa(el, lib) {
                const gm = this.geometria(el, lib);
                if (gm.ampop) return caixaGirada(el, -48, -48, 112, 96);
                return caixaGirada(el, -gm.w / 2 - 16, -gm.h / 2, gm.w + 32, gm.h);
            },
            desenhar(g, el, info, lib) {
                const gm = this.geometria(el, lib);
                if (gm.ampop) { desenhaAmpop(g, el, info, gm); return; }
                comGiro(g, el, () => {
                    gm.offs.forEach((o, i) => {
                        const x2 = o[0] < 0 ? -gm.w / 2 : gm.w / 2;
                        terminal(g, o[0], o[1], x2, o[1], info.cor(info.v[i]));
                    });
                    g.fillStyle = '#fff'; g.strokeStyle = el.props.modelo ? '#085357' : '#b3261e'; g.lineWidth = 2;
                    if (!el.props.modelo) g.setLineDash([5, 4]);
                    g.fillRect(-gm.w / 2, -gm.h / 2, gm.w, gm.h); g.strokeRect(-gm.w / 2, -gm.h / 2, gm.w, gm.h);
                    g.setLineDash([]);
                    g.fillStyle = '#1d2b2b'; g.font = '11px Segoe UI, Roboto, Arial'; g.textBaseline = 'middle';
                    gm.offs.forEach((o, i) => {
                        g.textAlign = o[0] < 0 ? 'left' : 'right';
                        g.fillText(gm.nomes[i], o[0] < 0 ? -gm.w / 2 + 4 : gm.w / 2 - 4, o[1]);
                    });
                    g.textAlign = 'center'; g.font = 'bold 11px Segoe UI, Roboto, Arial';
                    g.fillStyle = el.props.modelo ? '#085357' : '#b3261e';
                    g.fillText(el.props.titulo || el.props.modelo || 'sem modelo', 0, -gm.h / 2 + 12);
                });
            },
            prims(el, n, ctx) {
                if (!el.props.modelo) { ctx.aviso(`${el.id}: caixa sem modelo SPICE (pinos soltos)`); return; }
                const s = ctx.subckt(el.props.modelo);
                if (!s) { ctx.aviso(`${el.id}: subcircuito ${el.props.modelo} não está na biblioteca`); return; }
                if (s.nos.length !== n.length) { ctx.aviso(`${el.id}: ${s.nome} tem ${s.nos.length} pinos`); return; }
                if (!s.suporte.ok) ctx.aviso(`${el.id} (${s.nome}): no tempo real faltam ${s.suporte.falta.join(', ')}; use a análise SPICE (ngspice) quando estiver disponível`);
                ctx.expandir(s, n);
            },
            spice(el, n, ctx) { if (!el.props.modelo) return `* ${el.id}: caixa sem modelo`; ctx.usarSubckt(el.props.modelo); return `${nm('X', el)} ${n.join(' ')} ${el.props.modelo}`; }
        },
        voltimetro: {
            icone: '⎍', nome: 'Voltímetro', grupo: 'instrumentos', bipolo: true, tecla: 'm', tensaoInvertida: true, props: { Rin: '∞' },
            campos: [NI('Rin', 'Resistência de entrada', 'Ω', '∞ = ideal; multímetro comum: 10meg')],
            texto: () => '',
            desenhar(g, el, info) {
                bipolo(g, el, info, 32, (g, c) => {
                    g.lineWidth = 2; g.fillStyle = '#fff';
                    g.beginPath(); g.arc(c / 2, 0, 15, 0, 7); g.fill(); g.stroke();
                });
                const [[x1, y1], [x2, y2]] = el.p;
                g.save(); g.fillStyle = '#1d2b2b'; g.font = 'bold 13px Segoe UI, Roboto, Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
                g.fillText('V', (x1 + x2) / 2, (y1 + y2) / 2 + 1); g.restore();
                rotulo(g, el, S.formatar(info.v[1] - info.v[0], 'V'));
            },
            prims(el, n, ctx) { if (ativoInf(el.props.Rin)) ctx.add({ tipo: 'R', nos: n, valor: num(el.props.Rin) }, { corrente: true }); },
            spice(el, n) { return ativoInf(el.props.Rin) ? `R${el.id}_IN ${n[0]} ${n[1]} ${num(el.props.Rin)}` : ''; }
        }
    };

    /** Reconhece pinos de amp-op pelos nomes (IN+, IN−, OUT, VCC, VEE e variações). Devolve os papéis ou null. */
    function papeisAmpop(nomes) {
        if (nomes.length !== 5 && nomes.length !== 3) return null;
        const papel = (n) => {
            const u = String(n).toUpperCase().replace(/\s/g, '');
            if (/^(IN\+|\+IN|INP|IN_P|INPUT\+|NONINV|NI|\+)$/.test(u)) return 'inp';
            if (/^(IN-|-IN|INM|INN|IN_N|INPUT-|INV|-)$/.test(u)) return 'inm';
            if (/^(OUT|OUTPUT|VO|VOUT|O)$/.test(u)) return 'out';
            if (/^(VCC|V\+|VDD|VP|VS\+|VPOS|V\+S)$/.test(u)) return 'vcc';
            if (/^(VEE|V-|VSS|VN|VS-|VNEG|V-S)$/.test(u)) return 'vee';
            return null;
        };
        const p = nomes.map(papel);
        const precisa = nomes.length === 5 ? ['inp', 'inm', 'out', 'vcc', 'vee'] : ['inp', 'inm', 'out'];
        return precisa.every((x) => p.filter((y) => y === x).length === 1) ? p : null;
    }

    /** Amp-op com modelo SPICE desenhado com o triângulo da bibliografia. */
    function desenhaAmpop(g, el, info, gm) {
        const ini = { inm: [-32, -16], inp: [-32, 16], out: [48, 0], vcc: [0, -24], vee: [0, 24] };
        comGiro(g, el, () => {
            gm.offs.forEach((o, i) => { const f = ini[gm.papeis[i]]; terminal(g, o[0], o[1], f[0], f[1], info.cor(info.v[i])); });
            g.fillStyle = '#fff'; g.strokeStyle = '#1d2b2b'; g.lineWidth = 2;
            g.beginPath(); g.moveTo(-32, -40); g.lineTo(48, 0); g.lineTo(-32, 40); g.closePath(); g.fill(); g.stroke();
            g.lineWidth = 1.6;
            linha(g, -27, -16, -19, -16);                       // −
            linha(g, -27, 16, -19, 16); linha(g, -23, 12, -23, 20); // +
            g.save(); g.rotate(-(el.rot || 0) * Math.PI / 2);
            g.fillStyle = '#085357'; g.font = 'bold 9px Segoe UI, Roboto, Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
            const t = el.props.titulo || el.props.modelo || '';
            if (t && !(el.rot % 2)) { g.font = 'bold 8px Segoe UI, Roboto, Arial'; g.fillText(t, 2, 0, 46); } // cabe dentro do triângulo
            g.restore();
            if (gm.papeis.includes('vcc')) {
                g.fillStyle = '#5f6f6d'; g.font = '9px Segoe UI, Roboto, Arial'; g.textAlign = 'left'; g.textBaseline = 'middle';
                g.fillText('V+', 4, -36); g.fillText('V−', 4, 36);
            }
        });
    }

    function comGiro(g, el, f) { g.save(); g.translate(el.pos[0], el.pos[1]); g.rotate((el.rot || 0) * Math.PI / 2); f(); g.restore(); }
    function caixaGirada(el, x, y, w, h) {
        const cs = [[x, y], [x + w, y], [x, y + h], [x + w, y + h]].map((p) => girar(p, el.rot || 0));
        const xs = cs.map((p) => p[0]), ys = cs.map((p) => p[1]);
        const x0 = Math.min(...xs), y0 = Math.min(...ys);
        return [el.pos[0] + x0, el.pos[1] + y0, Math.max(...xs) - x0, Math.max(...ys) - y0];
    }

    function transistorBJT(id, nome, tipo, tecla) {
        const pnp = tipo === 'PNP';
        return {
            nome, icone: pnp ? 'P' : 'N', grupo: 'semicondutores', bipolo: false, tecla, props: { modelo: '', ajustes: '' },
            campos: [{ k: 'modelo', r: 'Modelo SPICE', tipo: 'modelo', tipos: [tipo] }, CAMPO_AJUSTES('ex.: BF=150 VAF=50 RB=10 RC=1 RE=0.5 CJE=20p CJC=8p (vazio = como no modelo)')],
            // pinos: coletor, base, emissor
            pinos: (el) => pinosPorOffsets(el, [[16, -32], [-32, 0], [16, 32]]),
            nomesPinos: ['coletor', 'base', 'emissor'],
            caixa: (el) => caixaGirada(el, -32, -32, 48, 64),
            desenhar(g, el, info) {
                comGiro(g, el, () => {
                    terminal(g, -32, 0, -6, 0, info.cor(info.v[1]));
                    g.strokeStyle = info.cor(info.v[0]); g.lineWidth = 3; g.beginPath(); g.moveTo(16, -32); g.lineTo(16, -18); g.lineTo(-5, -7); g.stroke();
                    g.strokeStyle = info.cor(info.v[2]); g.beginPath(); g.moveTo(16, 32); g.lineTo(16, 18); g.lineTo(-5, 7); g.stroke();
                    g.strokeStyle = '#1d2b2b'; g.lineWidth = 3.5; linha(g, -6, -14, -6, 14);
                    g.lineWidth = 1.5; g.beginPath(); g.arc(2, 0, 22, 0, 7); g.stroke();
                    // seta do emissor
                    g.fillStyle = '#1d2b2b';
                    const [ax, ay, bx, by] = pnp ? [8, 14.5, -1, 9] : [-1, 9, 14, 17];
                    const ang = Math.atan2(by - ay, bx - ax);
                    g.save(); g.translate(bx, by); g.rotate(ang); g.beginPath(); g.moveTo(0, 0); g.lineTo(-8, -4); g.lineTo(-8, 4); g.closePath(); g.fill(); g.restore();
                    g.font = '10px Segoe UI, Roboto, Arial'; g.textAlign = 'left'; g.textBaseline = 'middle';
                    if (el.props.modelo) { g.save(); g.rotate(-(el.rot || 0) * Math.PI / 2); g.fillText(el.props.modelo, 22, 0); g.restore(); }
                });
            },
            prims(el, n, ctx) { ctx.add({ tipo: 'Q', nos: n, modelo: comAjustes(ctx.modelo(el.props.modelo, [tipo]) || MODELOS_PADRAO[tipo], el.props.ajustes, el) }); },
            spice(el, n, ctx) { return `${nm('Q', el)} ${n[0]} ${n[1]} ${n[2]} ${ctx.nomeModelo(el.props.modelo, MODELOS_PADRAO[tipo], el.props.ajustes, el)}`; },
            correntesPinos: (p) => p ? [p.ic, p.ib, p.ie] : null
        };
    }

    function transistorMOS(id, nome, tipo) {
        const pmos = tipo === 'PMOS';
        return {
            nome, icone: pmos ? 'Mp' : 'Mn', grupo: 'semicondutores', bipolo: false, tecla: pmos ? 'P' : 'N', props: { modelo: '', ajustes: '' },
            campos: [{ k: 'modelo', r: 'Modelo SPICE', tipo: 'modelo', tipos: [tipo] }, CAMPO_AJUSTES('ex.: VTO=2 KP=0.1 LAMBDA=0.02 RD=0.1 RS=0.05 CGS=1n CGD=200p (vazio = como no modelo)')],
            // pinos: dreno, porta, fonte (corpo ligado à fonte)
            pinos: (el) => pinosPorOffsets(el, [[16, -32], [-32, 0], [16, 32]]),
            nomesPinos: ['dreno', 'porta', 'fonte'],
            caixa: (el) => caixaGirada(el, -32, -32, 48, 64),
            desenhar(g, el, info) {
                comGiro(g, el, () => {
                    terminal(g, -32, 0, -10, 0, info.cor(info.v[1]));
                    g.strokeStyle = '#1d2b2b'; g.lineWidth = 3; linha(g, -10, -14, -10, 14);
                    g.lineWidth = 3; linha(g, -3, -16, -3, -6); linha(g, -3, -4, -3, 4); linha(g, -3, 6, -3, 16);
                    g.strokeStyle = info.cor(info.v[0]); g.beginPath(); g.moveTo(16, -32); g.lineTo(16, -11); g.lineTo(-3, -11); g.stroke();
                    g.strokeStyle = info.cor(info.v[2]); g.beginPath(); g.moveTo(16, 32); g.lineTo(16, 11); g.lineTo(-3, 11); g.stroke();
                    g.beginPath(); g.moveTo(16, 11); g.lineTo(16, 0); g.lineTo(-3, 0); g.stroke();
                    g.fillStyle = '#1d2b2b';
                    g.save(); g.translate(pmos ? 10 : 0, 0); g.rotate(pmos ? 0 : Math.PI); g.beginPath(); g.moveTo(0, 0); g.lineTo(7, -4); g.lineTo(7, 4); g.closePath(); g.fill(); g.restore();
                    if (el.props.modelo) { g.save(); g.rotate(-(el.rot || 0) * Math.PI / 2); g.font = '10px Segoe UI, Roboto, Arial'; g.textBaseline = 'middle'; g.fillText(el.props.modelo, 22, 0); g.restore(); }
                });
            },
            prims(el, n, ctx) { ctx.add({ tipo: 'M', nos: n, modelo: comAjustes(ctx.modelo(el.props.modelo, [tipo]) || MODELOS_PADRAO[tipo], el.props.ajustes, el) }); },
            spice(el, n, ctx) {
                // CGS/CGD diretos (não existem no MOS1 do SPICE) saem como capacitores à parte
                const aj = lerAjustes(el.props.ajustes), m = ctx.modeloDe(el.props.modelo, MODELOS_PADRAO[tipo]);
                const cgs = aj.CGS ?? (m && m.params.CGS), cgd = aj.CGD ?? (m && m.params.CGD);
                let l = `${nm('M', el)} ${n[0]} ${n[1]} ${n[2]} ${n[2]} ${ctx.nomeModelo(el.props.modelo, MODELOS_PADRAO[tipo], el.props.ajustes, el, ['CGS', 'CGD'])}`;
                if (cgs > 0) l += `\nC${el.id}_GS ${n[1]} ${n[2]} ${cgs}`;
                if (cgd > 0) l += `\nC${el.id}_GD ${n[1]} ${n[0]} ${cgd}`;
                return l;
            },
            correntesPinos: (p) => p ? [p.idr, 0, -p.idr] : null
        };
    }

    const GRUPOS = [
        { id: 'ferramentas', nome: 'Ferramentas' },
        { id: 'passivos', nome: 'Passivos' },
        { id: 'fontes', nome: 'Fontes e terra' },
        { id: 'semicondutores', nome: 'Semicondutores' },
        { id: 'integrados', nome: 'Integrados e SPICE' },
        { id: 'instrumentos', nome: 'Instrumentos' }
    ];

    // componentes extras (componentes-extra.js): registram-se aqui com os mesmos auxiliares
    const extra = (typeof module !== 'undefined' && module.exports) ? require('./componentes-extra.js') : raiz.ComponentesExtra;
    if (extra) extra({ DEFS, GRUPOS, S, GRADE, bipolo, linha, terminal, rotulo, comGiro, caixaGirada, pinosPorOffsets, num, NI, rede, nm, fmt, triangulo, RMIN, ativoInf });

    /** Pinos de qualquer elemento (bipolo: as duas pontas). */
    function pinos(el, lib) {
        const d = DEFS[el.tipo];
        return d.bipolo ? el.p : d.pinos ? d.pinos.call(d, el, lib) : [];
    }

    const API = { DEFS, GRUPOS, GRADE, MODELOS_PADRAO, CORES_LED, LED_COR, RMIN, pinos, girar, rotulo, caixaGirada, num, lerAjustes, comAjustes };
    if (typeof module !== 'undefined' && module.exports) module.exports = API;
    else raiz.Componentes = API;
})(typeof window !== 'undefined' ? window : globalThis);
