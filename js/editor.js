/**
 * © 2026 Simulador de Circuitos (Falstad + SPICE) — Marlon Sigales. Todos os direitos reservados; copiar, reproduzir ou alterar exige autorização do autor (ver LICENSE).
 *
 * Editor no canvas, com a usabilidade do simulador do Prof. Falstad: arrastar para pôr componentes na grade,
 * cores pela tensão, pontos andando pela corrente, clique na chave para abrir/fechar, passar o mouse para ver valores.
 */

'use strict';

(function (raiz) {
    const C = raiz.Componentes, S = raiz.Spice;
    const G = C.GRADE;

    class Editor {
        constructor(canvas, app) {
            this.cv = canvas;
            this.g = canvas.getContext('2d');
            this.app = app;
            this.els = [];
            this.sel = null;          // principal (painel de propriedades)
            this.sels = new Set();    // seleção (vários com área, Shift+clique ou Ctrl+A)
            this.ferramenta = 'selecionar';
            this.vista = { ox: 40, oy: 20, z: 1 };
            this.arrasto = null;
            this.mouse = null;
            this.ligar();
            this.redimensionar();
            new ResizeObserver(() => this.redimensionar()).observe(canvas.parentElement);
        }

        // ------------------------------------------------------------ coordenadas
        redimensionar() {
            const r = this.cv.parentElement.getBoundingClientRect();
            const dpr = window.devicePixelRatio || 1;
            this.w = Math.max(200, r.width); this.h = Math.max(200, r.height);
            this.cv.width = Math.round(this.w * dpr); this.cv.height = Math.round(this.h * dpr);
            this.cv.style.width = this.w + 'px'; this.cv.style.height = this.h + 'px';
            this.dpr = dpr;
        }
        mundo(ev) {
            const r = this.cv.getBoundingClientRect();
            return [(ev.clientX - r.left - this.vista.ox) / this.vista.z, (ev.clientY - r.top - this.vista.oy) / this.vista.z];
        }
        grade([x, y]) { return [Math.round(x / G) * G, Math.round(y / G) * G]; }
        centro() { return this.grade([(this.w / 2 - this.vista.ox) / this.vista.z, (this.h / 2 - this.vista.oy) / this.vista.z]); }

        el(id) { return this.els.find((e) => e.id === id) || null; }
        selecionarSo(el) { this.sels = new Set(el ? [el.id] : []); this.sel = el ? el.id : null; }
        selecionados() { return this.els.filter((e) => this.sels.has(e.id)); }
        selecionado() { return this.sel ? this.el(this.sel) : null; }

        // ------------------------------------------------------------ teste de clique
        distSeg([px, py], [[x1, y1], [x2, y2]]) {
            const dx = x2 - x1, dy = y2 - y1, L2 = dx * dx + dy * dy;
            let t = L2 ? ((px - x1) * dx + (py - y1) * dy) / L2 : 0;
            t = Math.max(0, Math.min(1, t));
            return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
        }
        caixa(el) {
            const d = C.DEFS[el.tipo];
            if (d.bipolo) {
                const [[x1, y1], [x2, y2]] = el.p;
                return [Math.min(x1, x2) - 8, Math.min(y1, y2) - 8, Math.abs(x2 - x1) + 16, Math.abs(y2 - y1) + 16];
            }
            return d.caixa.call(d, el, this.app.lib);
        }
        acertar(pt, qualquerPonta) {
            const tol = 8 / this.vista.z;
            // pontas de bipolos (para esticar)
            for (let i = this.els.length - 1; i >= 0; i--) {
                const e = this.els[i];
                if (!C.DEFS[e.tipo].bipolo) continue;
                for (let k = 0; k < 2; k++) if (Math.hypot(pt[0] - e.p[k][0], pt[1] - e.p[k][1]) < tol && (e.id === this.sel || this.ferramenta === 'selecionar')) {
                    // só pega a ponta se o mouse estiver de fato sobre ela e o elemento estiver selecionado ou for fio
                    if (e.id === this.sel || e.tipo === 'fio' || qualquerPonta) return { el: e, ponta: k };
                }
            }
            // corpos: componentes antes dos fios
            const ordem = this.els.slice().sort((a, b) => (a.tipo === 'fio') - (b.tipo === 'fio'));
            for (const e of ordem) {
                const d = C.DEFS[e.tipo];
                if (d.bipolo) { if (this.distSeg(pt, e.p) < tol + (e.tipo === 'fio' ? 0 : 6)) return { el: e }; }
                else { const [x, y, w, h] = this.caixa(e); if (pt[0] >= x && pt[0] <= x + w && pt[1] >= y && pt[1] <= y + h) return { el: e }; }
            }
            return null;
        }

        // ------------------------------------------------------------ eventos
        ligar() {
            const cv = this.cv;
            cv.addEventListener('pointerdown', (ev) => this.baixo(ev));
            cv.addEventListener('pointermove', (ev) => this.mover(ev));
            cv.addEventListener('pointerup', (ev) => this.cima(ev));
            cv.addEventListener('pointerleave', () => { this.mouse = null; this.app.infoHover(null); });
            cv.addEventListener('dblclick', (ev) => { const h = this.acertar(this.mundo(ev)); if (h) { this.selecionarSo(h.el); this.app.selecionou(h.el, true); } });
            cv.addEventListener('wheel', (ev) => {
                ev.preventDefault();
                this.zoom(ev.deltaY < 0 ? 1.15 : 1 / 1.15, ev);
            }, { passive: false });
            cv.addEventListener('contextmenu', (ev) => ev.preventDefault());
        }

        zoom(f, ev) {
            const r = this.cv.getBoundingClientRect();
            const mx = ev ? ev.clientX - r.left : this.w / 2, my = ev ? ev.clientY - r.top : this.h / 2;
            const z = Math.max(0.3, Math.min(4, this.vista.z * f));
            this.vista.ox = mx - (mx - this.vista.ox) * z / this.vista.z;
            this.vista.oy = my - (my - this.vista.oy) * z / this.vista.z;
            this.vista.z = z;
        }

        baixo(ev) {
            this.cv.setPointerCapture(ev.pointerId);
            const pt = this.mundo(ev), gp = this.grade(pt);
            const fer = this.ferramenta;
            // como no Falstad: botão direito/do meio ou Alt+arrastar movem a vista
            if (ev.button === 1 || ev.button === 2 || ev.altKey) { this.arrasto = { tipo: 'pan', x: ev.clientX, y: ev.clientY, ox: this.vista.ox, oy: this.vista.oy }; return; }
            if (fer !== 'selecionar') {
                const d = C.DEFS[fer];
                this.app.antes();
                if (d.bipolo) {
                    const el = this.app.novo(fer, { p: [gp, gp.slice()] });
                    this.arrasto = { tipo: 'criar', el, inicio: gp, moveu: false };
                } else {
                    const el = this.app.novo(fer, { pos: gp, rot: 0 });
                    this.arrasto = { tipo: 'mover', grupo: [el], el, ultimo: gp, criado: true, moveu: true };
                }
                return;
            }
            const h = this.acertar(pt, ev.ctrlKey || ev.metaKey);
            if (h && h.ponta !== undefined) { this.app.antes(); this.selecionarSo(h.el); this.app.selecionou(h.el); this.arrasto = { tipo: 'ponta', el: h.el, ponta: h.ponta, moveu: false }; return; }
            if (h) {
                if (ev.shiftKey) { // Shift+clique: põe/tira da seleção
                    if (this.sels.has(h.el.id)) this.sels.delete(h.el.id); else this.sels.add(h.el.id);
                    this.sel = this.sels.size ? [...this.sels].pop() : null;
                    this.app.selecionou(this.selecionado());
                    return;
                }
                if (!this.sels.has(h.el.id)) this.selecionarSo(h.el); else this.sel = h.el.id;
                this.app.selecionou(h.el);
                this.arrasto = { tipo: 'mover', grupo: this.selecionados(), el: h.el, ultimo: gp, moveu: false, snapshot: JSON.stringify(this.els) };
                return;
            }
            // fundo: no toque move a vista; com mouse faz seleção por área (Shift soma à seleção)
            if (ev.pointerType === 'touch') { this.selecionarSo(null); this.app.selecionou(null); this.arrasto = { tipo: 'pan', x: ev.clientX, y: ev.clientY, ox: this.vista.ox, oy: this.vista.oy }; return; }
            const base = ev.shiftKey ? new Set(this.sels) : new Set();
            if (!ev.shiftKey) { this.selecionarSo(null); this.app.selecionou(null); }
            this.arrasto = { tipo: 'area', inicio: pt, atual: pt, base };
        }

        mover(ev) {
            const pt = this.mundo(ev), gp = this.grade(pt);
            this.mouse = pt;
            const a = this.arrasto;
            if (!a) { const h = this.acertar(pt); this.cv.style.cursor = this.ferramenta !== 'selecionar' ? 'crosshair' : h ? (h.ponta !== undefined ? 'move' : (C.DEFS[h.el.tipo].clicavel ? 'pointer' : 'grab')) : 'default'; this.app.infoHover(h ? h.el : null, pt); return; }
            if (a.tipo === 'pan') { this.vista.ox = a.ox + ev.clientX - a.x; this.vista.oy = a.oy + ev.clientY - a.y; return; }
            if (a.tipo === 'area') {
                a.atual = pt;
                const x0 = Math.min(a.inicio[0], pt[0]), x1 = Math.max(a.inicio[0], pt[0]), y0 = Math.min(a.inicio[1], pt[1]), y1 = Math.max(a.inicio[1], pt[1]);
                this.sels = new Set(a.base);
                this.els.forEach((e) => { const [x, y, w, h] = this.caixa(e); if (x <= x1 && x + w >= x0 && y <= y1 && y + h >= y0) this.sels.add(e.id); });
                return;
            }
            if (a.tipo === 'criar') {
                let q = gp;
                // como no Falstad: ângulos retos por padrão (Shift solta)
                if (!ev.shiftKey && a.el.tipo !== 'fio') { const dx = gp[0] - a.inicio[0], dy = gp[1] - a.inicio[1]; q = Math.abs(dx) >= Math.abs(dy) ? [gp[0], a.inicio[1]] : [a.inicio[0], gp[1]]; }
                if (q[0] !== a.el.p[1][0] || q[1] !== a.el.p[1][1]) { a.el.p[1] = q; a.moveu = true; }
                return;
            }
            if (a.tipo === 'ponta') { if (gp[0] !== a.el.p[a.ponta][0] || gp[1] !== a.el.p[a.ponta][1]) { a.el.p[a.ponta] = gp; a.moveu = true; this.app.mudouTopologia(); } return; }
            if (a.tipo === 'mover') {
                const dx = gp[0] - a.ultimo[0], dy = gp[1] - a.ultimo[1];
                if (!dx && !dy) return;
                if (!a.moveu && a.snapshot) this.app.antes(a.snapshot);
                a.moveu = true; a.ultimo = gp;
                this.deslocar(a.grupo || [a.el], dx, dy);
                this.app.mudouTopologia();
            }
        }

        deslocar(els, dx, dy) {
            els.forEach((e) => { if (e.p) e.p.forEach((p) => { p[0] += dx; p[1] += dy; }); else { e.pos[0] += dx; e.pos[1] += dy; } });
        }

        cima() {
            const a = this.arrasto;
            this.arrasto = null;
            if (!a) return;
            if (a.tipo === 'area') {
                this.sel = this.sels.size === 1 ? [...this.sels][0] : (this.sels.size ? [...this.sels].pop() : null);
                this.app.selecionou(this.selecionado());
                return;
            }
            if (a.tipo === 'criar') {
                if (!a.moveu) { a.el.p[1] = [a.inicio[0] + 4 * G, a.inicio[1]]; } // clique simples: tamanho padrão
                this.selecionarSo(a.el); this.app.selecionou(a.el); this.app.mudouTopologia();
            } else if (a.tipo === 'mover' && !a.moveu && !a.criado) {
                const d = C.DEFS[a.el.tipo];
                if (d.clicavel) { this.app.antes(); d.clicar(a.el); this.app.mudouValor(a.el); }
                else if (this.sels.size > 1) { this.selecionarSo(a.el); this.app.selecionou(a.el); }
            } else if (a.tipo === 'mover' && a.criado) { this.selecionarSo(a.el); this.app.selecionou(a.el); this.app.mudouTopologia(); }
            else if (a.tipo === 'ponta') {
                const e = a.el;
                if (e.p[0][0] === e.p[1][0] && e.p[0][1] === e.p[1][1]) this.app.excluir(e.id);
            }
        }

        // ------------------------------------------------------------ desenho
        desenhar() {
            const g = this.g, v = this.vista, app = this.app;
            g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
            g.fillStyle = '#fbfdfc'; g.fillRect(0, 0, this.w, this.h);
            // grade
            const passo = G * v.z;
            if (passo >= 8) {
                g.fillStyle = '#d5e0dd';
                const x0 = ((v.ox % passo) + passo) % passo, y0 = ((v.oy % passo) + passo) % passo;
                for (let x = x0; x < this.w; x += passo) for (let y = y0; y < this.h; y += passo) g.fillRect(x - 0.75, y - 0.75, 1.5, 1.5);
            }
            g.setTransform(this.dpr * v.z, 0, 0, this.dpr * v.z, this.dpr * v.ox, this.dpr * v.oy);
            g.lineCap = 'round'; g.lineJoin = 'round';

            const contagem = {};
            g.save(); g.lineWidth = 1 / v.z; g.setLineDash([4 / v.z, 3 / v.z]);
            this.selecionados().forEach((sel) => {
                const [x, y, w, h] = this.caixa(sel);
                g.fillStyle = sel.id === this.sel ? 'rgba(168,225,86,.30)' : 'rgba(168,225,86,.18)'; g.strokeStyle = 'rgba(64,149,128,.8)';
                g.fillRect(x - 3, y - 3, w + 6, h + 6); g.strokeRect(x - 3, y - 3, w + 6, h + 6);
            });
            if (this.arrasto && this.arrasto.tipo === 'area') {
                const { inicio: [x0, y0], atual: [x1, y1] } = this.arrasto;
                g.strokeStyle = '#085357'; g.fillStyle = 'rgba(8,83,87,.06)';
                g.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
                g.strokeRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
            }
            g.restore();
            const ordem = this.els.slice().sort((a, b) => (b.tipo === 'fio') - (a.tipo === 'fio'));
            for (const el of ordem) {
                const d = C.DEFS[el.tipo];
                if (!d) continue;
                const info = app.info(el);
                g.save();
                try { d.desenhar.call(d, g, el, info, app.lib); } catch (e) { /* desenho nunca derruba a simulação */ }
                g.restore();
                if (d.bipolo && d.texto) C.rotulo(g, el, d.texto(el));
                if (d.bipolo && el.tipo !== 'voltimetro') this.pontosCorrente(el, info);
                C.pinos(el, app.lib).forEach((p) => { const k = p[0] + ',' + p[1]; contagem[k] = (contagem[k] || 0) + 1; });
            }
            // nós com 3 ou mais ligações e pinos soltos
            g.fillStyle = '#1d2b2b';
            Object.entries(contagem).forEach(([k, n]) => {
                const [x, y] = k.split(',').map(Number);
                if (n >= 3) { g.beginPath(); g.arc(x, y, 3.5, 0, 7); g.fill(); }
                else if (n === 1) { g.save(); g.strokeStyle = '#b3261e'; g.lineWidth = 1.2; g.beginPath(); g.arc(x, y, 3, 0, 7); g.stroke(); g.restore(); }
            });
            // ponto sob o mouse
            if (this.mouse && this.ferramenta !== 'selecionar' && !this.arrasto) {
                const [x, y] = this.grade(this.mouse);
                g.strokeStyle = '#409580'; g.lineWidth = 1.5; g.beginPath(); g.arc(x, y, 5, 0, 7); g.stroke();
            }
            g.setTransform(1, 0, 0, 1, 0, 0);
        }

        pontosCorrente(el, info) {
            const i = info.i;
            if (!isFinite(i) || Math.abs(i) < 1e-6 || !this.app.mostrarCorrente) return; // abaixo de 1 µA não desenha (chave aberta, isolação)
            const [[x1, y1], [x2, y2]] = el.p;
            const L = Math.hypot(x2 - x1, y2 - y1);
            if (L < 1) return;
            const fase = el._fase || 0;
            const g = this.g;
            g.fillStyle = '#e0a800';
            for (let s = fase; s < L; s += G) {
                const t = s / L;
                g.beginPath(); g.arc(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, 2.3, 0, 7); g.fill();
            }
        }

        /** Faz os pontos andarem proporcionalmente à corrente (dtReal em s). */
        animarCorrente(dtReal) {
            const k = this.app.fatorCorrente;
            this.els.forEach((el) => {
                if (!C.DEFS[el.tipo] || !C.DEFS[el.tipo].bipolo) return;
                const i = this.app.info(el).i;
                if (!isFinite(i)) return;
                let vel = k * i;                       // px/s
                vel = Math.max(-220, Math.min(220, vel));
                el._fase = (((el._fase || 0) + vel * dtReal) % G + G) % G;
            });
        }
    }

    raiz.Editor = Editor;
})(window);
