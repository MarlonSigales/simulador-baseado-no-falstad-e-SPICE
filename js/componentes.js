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

    const CORES_LED = { vermelho: '#ff2a2a', verde: '#2bd94a', azul: '#3a7bff', amarelo: '#ffd21a', branco: '#ffffff' };

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
            default: return fmt(p.V, 'V');
        }
    };
    const fonteDasProps = (p) => ({
        forma: p.forma || 'dc', dc: S.valor(p.V), amplitude: S.valor(p.amplitude), freq: S.valor(p.freq),
        offset: S.valor(p.offset) || 0, fase: S.valor(p.fase) || 0, duty: isNaN(S.valor(p.duty)) ? 0.5 : S.valor(p.duty)
    });
    const spiceFonte = (p) => {
        const f = fonteDasProps(p);
        if (f.forma === 'seno') return `SIN(${f.offset} ${f.amplitude} ${f.freq} 0 0 ${f.fase})`;
        if (f.forma === 'quadrada') { const per = 1 / f.freq; return `PULSE(${f.offset - f.amplitude} ${f.offset + f.amplitude} 0 1n 1n ${per * f.duty} ${per})`; }
        return `DC ${f.dc}`;
    };
    const CAMPOS_FONTE = [
        { k: 'forma', r: 'Forma de onda', tipo: 'sel', op: [['dc', 'Contínua (DC)'], ['seno', 'Senoidal'], ['quadrada', 'Quadrada']] },
        { k: 'V', r: 'Tensão', u: 'V', se: (p) => p.forma === 'dc' },
        { k: 'amplitude', r: 'Amplitude (pico)', u: 'V', se: (p) => p.forma !== 'dc' },
        { k: 'freq', r: 'Frequência', u: 'Hz', se: (p) => p.forma !== 'dc' },
        { k: 'offset', r: 'Nível médio (offset)', u: 'V', se: (p) => p.forma !== 'dc' },
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

    function modeloTexto(el, padrao) { return el.props.modelo || padrao; }

    // ------------------------------------------------------------ catálogo
    const DEFS = {
        fio: {
            icone: '╱', nome: 'Fio', grupo: 'ferramentas', bipolo: true, tecla: 'w', props: {},
            desenhar(g, el, info) { const [[a, b], [c, d]] = el.p; terminal(g, a, b, c, d, info.cor(info.v[0])); },
            prims(el, n, ctx) { ctx.add({ tipo: 'R', nos: n, valor: 1e-3 }); },
            spice(el, n) { return `${nm('R', el)} ${n[0]} ${n[1]} 1m`; }
        },
        resistor: {
            icone: 'Ω', nome: 'Resistor', grupo: 'passivos', bipolo: true, tecla: 'r', props: { R: '1k' },
            campos: [{ k: 'R', r: 'Resistência', u: 'Ω' }],
            texto: (el) => fmt(el.props.R, 'Ω'),
            desenhar(g, el, info) {
                bipolo(g, el, info, 32, (g, c) => {
                    g.beginPath(); g.moveTo(0, 0);
                    for (let i = 0; i < 8; i++) g.lineTo((i + 0.5) * c / 8, i % 2 ? 6 : -6);
                    g.lineTo(c, 0); g.stroke();
                });
            },
            prims(el, n, ctx) { ctx.add({ tipo: 'R', nos: n, valor: S.valor(el.props.R) }); },
            spice(el, n) { return `${nm('R', el)} ${n[0]} ${n[1]} ${el.props.R}`; }
        },
        capacitor: {
            icone: 'C', nome: 'Capacitor', grupo: 'passivos', bipolo: true, tecla: 'c', props: { C: '10u' },
            campos: [{ k: 'C', r: 'Capacitância', u: 'F' }],
            texto: (el) => fmt(el.props.C, 'F'),
            desenhar(g, el, info) {
                bipolo(g, el, info, 24, (g, c) => {
                    g.lineWidth = 2; linha(g, 0, 0, c / 2 - 4, 0); linha(g, c / 2 + 4, 0, c, 0);
                    g.lineWidth = 3; linha(g, c / 2 - 4, -11, c / 2 - 4, 11); linha(g, c / 2 + 4, -11, c / 2 + 4, 11);
                });
            },
            prims(el, n, ctx) { ctx.add({ tipo: 'C', nos: n, valor: S.valor(el.props.C) }); },
            spice(el, n) { return `${nm('C', el)} ${n[0]} ${n[1]} ${el.props.C}`; }
        },
        indutor: {
            icone: 'L', nome: 'Indutor', grupo: 'passivos', bipolo: true, tecla: 'L', props: { L: '10m' },
            campos: [{ k: 'L', r: 'Indutância', u: 'H' }],
            texto: (el) => fmt(el.props.L, 'H'),
            desenhar(g, el, info) {
                bipolo(g, el, info, 40, (g, c) => {
                    g.beginPath();
                    for (let i = 0; i < 4; i++) g.arc((i + 0.5) * c / 4, 0, c / 8, Math.PI, 0);
                    g.stroke();
                });
            },
            prims(el, n, ctx) { ctx.add({ tipo: 'L', nos: n, valor: S.valor(el.props.L) }); },
            spice(el, n) { return `${nm('L', el)} ${n[0]} ${n[1]} ${el.props.L}`; }
        },
        chave: {
            icone: 'S', nome: 'Chave (clique para abrir/fechar)', curto: 'Chave', grupo: 'passivos', bipolo: true, tecla: 's', props: { ligada: false },
            campos: [{ k: 'ligada', r: 'Fechada', tipo: 'bool' }],
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
            prims(el, n, ctx) { ctx.add({ tipo: 'SW', nos: n, ligada: !!el.props.ligada }); },
            spice(el, n) { return `${nm('R', el)} ${n[0]} ${n[1]} ${el.props.ligada ? '10m' : '1G'}`; }
        },
        fonteV: {
            icone: 'V', nome: 'Fonte de tensão', grupo: 'fontes', bipolo: true, tecla: 'v',
            props: { forma: 'dc', V: '5', amplitude: '5', freq: '60', offset: '0', fase: '0', duty: '0.5' },
            campos: CAMPOS_FONTE,
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
            prims(el, n, ctx) { ctx.add({ tipo: 'V', nos: [n[1], n[0]], fonte: fonteDasProps(el.props) }); },
            spice(el, n) { return `${nm('V', el)} ${n[1]} ${n[0]} ${spiceFonte(el.props)}`; }
        },
        trilho: {
            icone: '+', nome: 'Trilho de tensão (+V)', curto: 'Trilho +V', grupo: 'fontes', bipolo: false, tecla: 'V',
            props: { forma: 'dc', V: '5', amplitude: '5', freq: '60', offset: '0', fase: '0', duty: '0.5' },
            campos: CAMPOS_FONTE,
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
            prims(el, n, ctx) { ctx.add({ tipo: 'V', nos: [n[0], 0], fonte: fonteDasProps(el.props) }); },
            spice(el, n) { return `${nm('V', el)} ${n[0]} 0 ${spiceFonte(el.props)}`; }
        },
        fonteI: {
            icone: 'I', nome: 'Fonte de corrente', grupo: 'fontes', bipolo: true, props: { I: '1m' },
            campos: [{ k: 'I', r: 'Corrente', u: 'A' }],
            texto: (el) => fmt(el.props.I, 'A'),
            desenhar(g, el, info) {
                bipolo(g, el, info, 32, (g, c) => {
                    g.lineWidth = 2; g.fillStyle = '#fff';
                    g.beginPath(); g.arc(c / 2, 0, 15, 0, 7); g.fill(); g.stroke();
                    g.strokeStyle = '#1d2b2b'; g.fillStyle = '#1d2b2b'; g.lineWidth = 1.6;
                    linha(g, c / 2 - 8, 0, c / 2 + 5, 0); triangulo(g, c / 2 + 3, c / 2 + 9, 4, true);
                });
            },
            prims(el, n, ctx) { ctx.add({ tipo: 'I', nos: n, fonte: { forma: 'dc', dc: S.valor(el.props.I) } }); },
            spice(el, n) { return `${nm('I', el)} ${n[0]} ${n[1]} DC ${el.props.I}`; }
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
            icone: '▷', nome: 'Diodo', grupo: 'semicondutores', bipolo: true, tecla: 'd', props: { modelo: '' },
            campos: [{ k: 'modelo', r: 'Modelo SPICE', tipo: 'modelo', tipos: ['D'] }],
            texto: (el) => modeloTexto(el, ''),
            desenhar(g, el, info) { bipolo(g, el, info, 32, (g, c) => desenhaDiodo(g, c, info)); },
            prims(el, n, ctx) { ctx.add({ tipo: 'D', nos: n, modelo: ctx.modelo(el.props.modelo, ['D']) || MODELOS_PADRAO.D }); },
            spice(el, n, ctx) { return `${nm('D', el)} ${n[0]} ${n[1]} ${ctx.nomeModelo(el.props.modelo, MODELOS_PADRAO.D)}`; }
        },
        zener: {
            icone: 'Z', nome: 'Diodo zener', curto: 'Zener', grupo: 'semicondutores', bipolo: true, tecla: 'z', props: { modelo: '' },
            campos: [{ k: 'modelo', r: 'Modelo SPICE (com BV)', tipo: 'modelo', tipos: ['D'] }],
            texto: (el) => el.props.modelo || 'zener 5,6 V',
            desenhar(g, el, info) {
                bipolo(g, el, info, 32, (g, c) => desenhaDiodo(g, c, info, (g, x0, x1) => {
                    g.lineWidth = 3; linha(g, x1, -9, x1 - 5, -13); linha(g, x1, 9, x1 + 5, 13);
                }));
            },
            prims(el, n, ctx) { ctx.add({ tipo: 'D', nos: n, modelo: ctx.modelo(el.props.modelo, ['D']) || MODELOS_PADRAO.ZENER }); },
            spice(el, n, ctx) { return `${nm('D', el)} ${n[0]} ${n[1]} ${ctx.nomeModelo(el.props.modelo, MODELOS_PADRAO.ZENER)}`; }
        },
        led: {
            icone: '✦', nome: 'LED', grupo: 'semicondutores', bipolo: true, tecla: 'l', props: { modelo: '', cor: 'vermelho' },
            campos: [
                { k: 'cor', r: 'Cor', tipo: 'sel', op: Object.keys(CORES_LED).map((c) => [c, c]) },
                { k: 'modelo', r: 'Modelo SPICE', tipo: 'modelo', tipos: ['D'] }
            ],
            texto: (el) => modeloTexto(el, ''),
            desenhar(g, el, info) {
                const i = Math.max(0, info.i || 0);
                bipolo(g, el, info, 32, (g, c) => {
                    const brilho = Math.min(1, i / 0.01);
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
            prims(el, n, ctx) { ctx.add({ tipo: 'D', nos: n, modelo: ctx.modelo(el.props.modelo, ['D']) || MODELOS_PADRAO.LED }); },
            spice(el, n, ctx) { return `${nm('D', el)} ${n[0]} ${n[1]} ${ctx.nomeModelo(el.props.modelo, MODELOS_PADRAO.LED)}`; }
        },
        npn: transistorBJT('npn', 'Transistor NPN', 'NPN', 'n'),
        pnp: transistorBJT('pnp', 'Transistor PNP', 'PNP', 'p'),
        nmos: transistorMOS('nmos', 'MOSFET canal N', 'NMOS'),
        pmos: transistorMOS('pmos', 'MOSFET canal P', 'PMOS'),
        ampop: {
            icone: '△', nome: 'Amp-op ideal (− em cima)', curto: 'Amp-op ideal', grupo: 'integrados', bipolo: false, tecla: 'a', props: { ganho: '100k', vmax: '15', vmin: '-15' },
            campos: [{ k: 'ganho', r: 'Ganho em malha aberta' }, { k: 'vmax', r: 'Saturação positiva', u: 'V' }, { k: 'vmin', r: 'Saturação negativa', u: 'V' }],
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
            prims(el, n, ctx) { ctx.add({ tipo: 'OP', nos: n, ganho: S.valor(el.props.ganho), vmax: S.valor(el.props.vmax), vmin: S.valor(el.props.vmin) }); },
            spice(el, n) { return `${nm('E', el)} ${n[0]} 0 ${n[1]} ${n[2]} ${el.props.ganho}  ; amp-op ideal (sem saturação no SPICE)`; }
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
            icone: '⎍', nome: 'Voltímetro', grupo: 'instrumentos', bipolo: true, tecla: 'm', props: {},
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
            prims() {},
            spice() { return ''; }
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
            nome, icone: pnp ? 'P' : 'N', grupo: 'semicondutores', bipolo: false, tecla, props: { modelo: '' },
            campos: [{ k: 'modelo', r: 'Modelo SPICE', tipo: 'modelo', tipos: [tipo] }],
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
            prims(el, n, ctx) { ctx.add({ tipo: 'Q', nos: n, modelo: ctx.modelo(el.props.modelo, [tipo]) || MODELOS_PADRAO[tipo] }); },
            spice(el, n, ctx) { return `${nm('Q', el)} ${n[0]} ${n[1]} ${n[2]} ${ctx.nomeModelo(el.props.modelo, MODELOS_PADRAO[tipo])}`; },
            correntesPinos: (p) => p ? [p.ic, p.ib, p.ie] : null
        };
    }

    function transistorMOS(id, nome, tipo) {
        const pmos = tipo === 'PMOS';
        return {
            nome, icone: pmos ? 'Mp' : 'Mn', grupo: 'semicondutores', bipolo: false, tecla: pmos ? 'P' : 'N', props: { modelo: '' },
            campos: [{ k: 'modelo', r: 'Modelo SPICE', tipo: 'modelo', tipos: [tipo] }],
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
            prims(el, n, ctx) { ctx.add({ tipo: 'M', nos: n, modelo: ctx.modelo(el.props.modelo, [tipo]) || MODELOS_PADRAO[tipo] }); },
            spice(el, n, ctx) { return `${nm('M', el)} ${n[0]} ${n[1]} ${n[2]} ${n[2]} ${ctx.nomeModelo(el.props.modelo, MODELOS_PADRAO[tipo])}`; },
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

    /** Pinos de qualquer elemento (bipolo: as duas pontas). */
    function pinos(el, lib) {
        const d = DEFS[el.tipo];
        return d.bipolo ? el.p : d.pinos.call(d, el, lib);
    }

    const API = { DEFS, GRUPOS, GRADE, MODELOS_PADRAO, CORES_LED, pinos, girar, rotulo, caixaGirada };
    if (typeof module !== 'undefined' && module.exports) module.exports = API;
    else raiz.Componentes = API;
})(typeof window !== 'undefined' ? window : globalThis);
