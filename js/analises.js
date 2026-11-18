/**
 * © 2026 Simulador de Circuitos (Falstad + SPICE) — Marlon Sigales. Todos os direitos reservados; copiar, reproduzir ou alterar exige autorização do autor (ver LICENSE).
 *
 * Análises SPICE completas com o ngspice compilado para WebAssembly (vendor/eecircuit, eecircuit-engine MIT + ngspice BSD).
 * O motor (20 MB) só é carregado na primeira análise. Usa o mesmo netlist do botão "Netlist SPICE".
 * Análises: ponto de operação (.op), AC/Bode (.ac), varredura DC (.dc), transitório (.tran), ruído (.noise),
 * Fourier/THD (calculado do .tran), paramétrica (vários valores de um componente), temperatura e Monte Carlo.
 */

'use strict';

(function (raiz) {
    const nodeJS = typeof module !== 'undefined' && module.exports;
    const Circ = nodeJS ? require('./circuito.js') : raiz.Circuito;
    const C = nodeJS ? require('./componentes.js') : raiz.Componentes;
    const S = nodeJS ? require('./spice.js') : raiz.Spice;

    // ------------------------------------------------------------ motor ngspice
    let simPromessa = null, fila = Promise.resolve();
    function carregarNgspice(url = 'vendor/eecircuit/eecircuit-engine.mjs') {
        if (simPromessa) return simPromessa;
        // módulo ES carregado sob demanda (import dinâmico funciona a partir de script comum)
        const abs = new URL(url, document.baseURI).href;
        simPromessa = import(abs).then(async (M) => { const s = new M.Simulation(); await s.start(); return s; })
            .catch((e) => { simPromessa = null; throw new Error('Não consegui carregar o ngspice (vendor/eecircuit): ' + (e.message || e)); });
        return simPromessa;
    }
    /** Roda um netlist (uma simulação por vez). */
    function rodar(sim, netlist) {
        const p = fila.then(async () => {
            sim.setNetList(netlist);
            let relogio;
            const limite = new Promise((_, falha) => { relogio = setTimeout(() => { simPromessa = null; falha(new Error('o ngspice não respondeu em 30 s (circuito sem solução?); ele será recarregado na próxima análise')); }, 30000); });
            const r = await Promise.race([sim.runSim(), limite]);
            clearTimeout(relogio);
            const err = sim.getError ? sim.getError() : [];
            if (err && err.length) r.erros = err;
            return r;
        });
        fila = p.catch(() => {});
        return p;
    }

    // ------------------------------------------------------------ saídas (o que dá para plotar)
    /** Lista de saídas: tensão de cada bipolo e de cada pino (contra o terra), sem repetir nó. */
    function saidas(els, lib) {
        const r = Circ.nos(els, lib), lista = [], vistos = new Set();
        els.forEach((el) => {
            const d = C.DEFS[el.tipo], n = r.pinos[el.id] || [];
            if (!d || !n.length) return;
            if (d.bipolo && el.tipo !== 'fio') lista.push({ id: `${el.id}`, nome: `${el.id}: tensão (${d.curto || d.nome})`, nos: d.tensaoInvertida ? [n[1], n[0]] : [n[0], n[1]] });
            if (!d.bipolo) {
                const nomes = d.nomesPinos || (d.nomesPinosDe ? d.nomesPinosDe(el, lib) : null) || n.map((_, i) => 'pino ' + (i + 1));
                n.forEach((k, i) => { if (k && !vistos.has(k)) { vistos.add(k); lista.push({ id: `${el.id}.${i}`, nome: `${el.id}.${nomes[i] || i}: nó (${d.curto || d.nome})`, nos: [k, 0] }); } });
            }
        });
        return lista;
    }
    const vetor = (res, k) => {
        if (k === 0) return null;
        const d = res.data.find((x) => x.name.toLowerCase() === `v(n${k})`);
        return d ? d.values : null;
    };
    /** Valores de uma saída num resultado (real ou complexo). */
    function valoresSaida(res, s) {
        const a = vetor(res, s.nos[0]), b = vetor(res, s.nos[1]);
        const n = res.numPoints;
        const out = [];
        for (let i = 0; i < n; i++) {
            const va = a ? a[i] : (res.dataType === 'complex' ? { real: 0, img: 0 } : 0);
            const vb = b ? b[i] : (res.dataType === 'complex' ? { real: 0, img: 0 } : 0);
            out.push(res.dataType === 'complex' ? { real: va.real - vb.real, img: va.img - vb.img } : va - vb);
        }
        return out;
    }

    // ------------------------------------------------------------ Fourier
    /** Harmônicas 1..n de y(t) (t não uniforme) nos últimos k períodos de f0. */
    function fourier(t, y, f0, n = 9, periodos = 4) {
        const T = 1 / f0, tf = t[t.length - 1], t0 = Math.max(t[0], tf - periodos * T);
        const N = 2048, dt = (tf - t0) / N, ys = [];
        let j = 0;
        for (let i = 0; i < N; i++) {
            const tt = t0 + i * dt;
            while (j < t.length - 2 && t[j + 1] < tt) j++;
            const a = t[j], b = t[j + 1];
            ys.push(b > a ? y[j] + (y[j + 1] - y[j]) * (tt - a) / (b - a) : y[j]);
        }
        const per = Math.max(1, Math.round((tf - t0) * f0));
        const harm = [];
        let dc = 0; ys.forEach((v) => { dc += v; }); dc /= N;
        for (let h = 1; h <= n; h++) {
            let re = 0, im = 0;
            for (let i = 0; i < N; i++) { const ang = 2 * Math.PI * h * per * i / N; re += ys[i] * Math.cos(ang); im -= ys[i] * Math.sin(ang); }
            harm.push({ h, f: h * f0, amp: 2 * Math.hypot(re, im) / N, fase: Math.atan2(im, re) * 180 / Math.PI });
        }
        const thd = Math.sqrt(harm.slice(1).reduce((s, x) => s + x.amp * x.amp, 0)) / (harm[0].amp || 1e-30);
        return { dc, harm, thd };
    }

    // ------------------------------------------------------------ variações (paramétrica, Monte Carlo)
    const clonar = (els) => JSON.parse(JSON.stringify(els));
    /** Monte Carlo: cada R, C e L muda por uma distribuição uniforme dentro da tolerância. */
    function sortear(els, tol, aleat = Math.random) {
        const c = clonar(els);
        c.forEach((el) => {
            const k = { resistor: 'R', capacitor: 'C', eletrolitico: 'C', indutor: 'L', potenciometro: 'R' }[el.tipo];
            const t = tol[k];
            if (!k || !t) return;
            const v = S.valor(el.props[k]);
            if (isFinite(v)) el.props[k] = String(v * (1 + (t / 100) * (2 * aleat() - 1)));
        });
        return c;
    }

    // ------------------------------------------------------------ gráfico
    function nice(v) { const p = Math.pow(10, Math.floor(Math.log10(Math.abs(v) || 1))); for (const m of [1, 2, 5, 10]) if (m * p >= Math.abs(v)) return m * p; return 10 * p; }
    /**
     * Desenha curvas. op: { x, curvas: [{ nome, y, cor }], logx, logy, rotX, rotY }
     */
    function plotar(cv, op) {
        const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
        cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
        const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.fillStyle = '#0d2b2c'; g.fillRect(0, 0, w, h);
        const m = { e: 62, d: 14, c: 14, b: 34 };
        const fx = op.logx ? (v) => Math.log10(Math.max(v, 1e-30)) : (v) => v;
        const fy = op.logy ? (v) => Math.log10(Math.max(Math.abs(v), 1e-30)) : (v) => v;
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
        op.curvas.forEach((c) => c.y.forEach((v, i) => { const xv = fx((c.x || op.x)[i]), yv = fy(v); if (isFinite(xv) && isFinite(yv)) { x0 = Math.min(x0, xv); x1 = Math.max(x1, xv); y0 = Math.min(y0, yv); y1 = Math.max(y1, yv); } }));
        if (!isFinite(x0)) return;
        if (y1 - y0 < 1e-12) { y0 -= 1; y1 += 1; }
        const pad = (y1 - y0) * 0.06; y0 -= pad; y1 += pad;
        const X = (v) => m.e + (fx(v) - x0) / (x1 - x0 || 1) * (w - m.e - m.d), Y = (v) => h - m.b - (fy(v) - y0) / (y1 - y0) * (h - m.b - m.c);
        g.strokeStyle = 'rgba(255,255,255,.1)'; g.fillStyle = 'rgba(255,255,255,.65)'; g.font = '10px Segoe UI, Roboto, Arial'; g.lineWidth = 1;
        // marcas
        const marcas = (a, b, log) => {
            const out = [];
            if (log) { for (let e = Math.floor(a); e <= Math.ceil(b); e++) if (e >= a - 1e-9 && e <= b + 1e-9) out.push(Math.pow(10, e)); return out; }
            const passo = nice((b - a) / 6); for (let v = Math.ceil(a / passo) * passo; v <= b + 1e-12; v += passo) out.push(v); return out;
        };
        g.textAlign = 'center'; g.textBaseline = 'top';
        marcas(x0, x1, op.logx).forEach((v) => { const px = op.logx ? m.e + (Math.log10(v) - x0) / (x1 - x0) * (w - m.e - m.d) : X(v); g.beginPath(); g.moveTo(px, m.c); g.lineTo(px, h - m.b); g.stroke(); g.fillText(S.formatar(v, op.unX || ''), px, h - m.b + 4); });
        g.textAlign = 'right'; g.textBaseline = 'middle';
        marcas(y0, y1, op.logy).forEach((v) => { const py = op.logy ? h - m.b - (Math.log10(v) - y0) / (y1 - y0) * (h - m.b - m.c) : Y(v); g.beginPath(); g.moveTo(m.e, py); g.lineTo(w - m.d, py); g.stroke(); g.fillText(op.unY === '' || op.semSI ? (Math.abs(v) < 1e-9 ? '0' : +v.toPrecision(3)) + (op.unY || '') : S.formatar(v, op.unY || ''), m.e - 4, py); });
        g.textAlign = 'center'; g.textBaseline = 'bottom'; g.fillText(op.rotX || '', (m.e + w - m.d) / 2, h - 2);
        op.curvas.forEach((c) => {
            g.strokeStyle = c.cor; g.lineWidth = 1.6; g.beginPath(); let p = false;
            c.y.forEach((v, i) => { const xv = (c.x || op.x)[i]; const px = X(xv), py = Y(v); if (!isFinite(px) || !isFinite(py)) { p = false; return; } p ? g.lineTo(px, py) : g.moveTo(px, py); p = true; });
            g.stroke();
        });
        g.textAlign = 'left'; g.textBaseline = 'top';
        op.curvas.slice(0, 8).forEach((c, i) => { g.fillStyle = c.cor; g.fillText(c.nome, m.e + 6, m.c + 2 + i * 13); });
        if (op.curvas.length > 8) { g.fillStyle = 'rgba(255,255,255,.6)'; g.fillText(`… +${op.curvas.length - 8} curvas`, m.e + 6, m.c + 2 + 8 * 13); }
        g.save(); g.translate(12, (m.c + h - m.b) / 2); g.rotate(-Math.PI / 2); g.textAlign = 'center'; g.fillStyle = 'rgba(255,255,255,.65)'; g.fillText(op.rotY || '', 0, 0); g.restore();
    }
    const CORES = ['#a8e156', '#ffd166', '#ff8a80', '#7cc4ff', '#c792ea', '#80cbc4', '#f78c6c', '#ffcb6b'];
    const cor = (i, n) => (n > CORES.length ? `hsl(${Math.round(90 + 270 * i / Math.max(1, n - 1))}, 70%, 65%)` : CORES[i % CORES.length]);

    const API = { carregarNgspice, rodar, saidas, valoresSaida, fourier, sortear, clonar, plotar, cor };
    if (nodeJS) module.exports = API;
    else raiz.Analises = API;
})(typeof window !== 'undefined' ? window : globalThis);
