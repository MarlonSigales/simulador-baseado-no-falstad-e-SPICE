/**
 * © 2026 Simulador de Circuitos (Falstad + SPICE) — Marlon Sigales. Todos os direitos reservados; copiar, reproduzir ou alterar exige autorização do autor (ver LICENSE).
 *
 * Motor em tempo real: análise nodal modificada (MNA), passo fixo, integração trapezoidal e Newton-Raphson
 * para os não lineares. Os primitivos seguem as equações dos modelos SPICE (diodo, BJT Ebers-Moll/Gummel-Poon
 * simplificado sem cargas, MOSFET nível 1) e as fontes controladas E, G, F, H.
 *
 * Primitivo: { tipo, nome, nos:[...], valor | fonte | modelo | ref, ... }  (nó 0 = terra)
 */

'use strict';

(function (raiz) {
    const VT = 0.025852;          // kT/q a 27 °C
    const GMIN = 1e-12;
    const MAX_ITER = 120;

    const PADRAO = {
        D: { IS: 1e-14, N: 1, RS: 0, BV: Infinity, IBV: 1e-3 },
        Q: { IS: 1e-16, BF: 100, BR: 1, NF: 1, NR: 1, VAF: Infinity },
        M: { VTO: 0, KP: 2e-5, LAMBDA: 0 }
    };
    const modeloCom = (padrao, m) => Object.assign({}, padrao, m ? m.params : {});

    function valorFonte(f, t) {
        if (!f) return 0;
        switch (f.forma) {
            case 'seno': {
                if (t < (f.atraso || 0)) return (f.offset || 0) + f.amplitude * Math.sin((f.fase || 0) * Math.PI / 180);
                return (f.offset || 0) + f.amplitude * Math.sin(2 * Math.PI * f.freq * (t - (f.atraso || 0)) + (f.fase || 0) * Math.PI / 180);
            }
            case 'quadrada': {
                const per = 1 / (f.freq || 1);
                const fr = ((t % per) + per) % per / per;
                return (f.offset || 0) + (fr < (f.duty ?? 0.5) ? f.amplitude : -f.amplitude);
            }
            case 'pwl': {
                const p = f.pwl || [];
                if (!p.length) return 0;
                let tt = t;
                const fim = p[p.length - 1][0];
                if (f.repetir && fim > 0) tt = t % fim;
                if (tt <= p[0][0]) return p[0][1];
                for (let i = 1; i < p.length; i++) if (tt <= p[i][0]) { const [t0, v0] = p[i - 1], [t1, v1] = p[i]; return t1 > t0 ? v0 + (v1 - v0) * (tt - t0) / (t1 - t0) : v1; }
                return p[p.length - 1][1];
            }
            case 'pulso': {
                if (t < f.td) return f.v1;
                const tt = (t - f.td) % f.per;
                if (tt < f.tr) return f.v1 + (f.v2 - f.v1) * tt / f.tr;
                if (tt < f.tr + f.pw) return f.v2;
                if (tt < f.tr + f.pw + f.tf) return f.v2 + (f.v1 - f.v2) * (tt - f.tr - f.pw) / f.tf;
                return f.v1;
            }
            default: return f.dc || 0;
        }
    }

    /** Limitação de tensão de junção (pnjlim do SPICE), evita estouro de exp() no Newton. */
    function pnjlim(vnew, vold, vt, vcrit) {
        if (vnew > vcrit && Math.abs(vnew - vold) > 2 * vt) {
            if (vold > 0) {
                const arg = 1 + (vnew - vold) / vt;
                vnew = arg > 0 ? vold + vt * Math.log(arg) : vcrit;
            } else vnew = vt * Math.log(vnew / vt);
        }
        return vnew;
    }

    function resolver(A, b, n) {
        // eliminação de Gauss com pivotamento parcial (A em linha, n×n)
        for (let k = 0; k < n; k++) {
            let p = k, max = Math.abs(A[k * n + k]);
            for (let i = k + 1; i < n; i++) { const v = Math.abs(A[i * n + k]); if (v > max) { max = v; p = i; } }
            if (max < 1e-30) return false;
            if (p !== k) {
                for (let j = 0; j < n; j++) { const t = A[k * n + j]; A[k * n + j] = A[p * n + j]; A[p * n + j] = t; }
                const t = b[k]; b[k] = b[p]; b[p] = t;
            }
            const piv = A[k * n + k];
            for (let i = k + 1; i < n; i++) {
                const f = A[i * n + k] / piv;
                if (f === 0) continue;
                for (let j = k; j < n; j++) A[i * n + j] -= f * A[k * n + j];
                b[i] -= f * b[k];
            }
        }
        for (let i = n - 1; i >= 0; i--) {
            let s = b[i];
            for (let j = i + 1; j < n; j++) s -= A[i * n + j] * b[j];
            b[i] = s / A[i * n + i];
        }
        return true;
    }

    class Motor {
        /**
         * @param {{nNos:number, prims:Array}} net
         * @param {Object} [estadoAnterior] estados de C/L por nome (para não zerar ao editar um valor)
         */
        constructor(net, estadoAnterior) {
            this.nNos = net.nNos;
            this.prims = net.prims.map((p) => Object.assign({}, p));
            this.t = 0;
            this.avisos = [];
            this.naoConvergiu = 0;
            let ramo = 0;
            const porNome = {};
            this.naoLineares = false;
            this.prims.forEach((p) => {
                porNome[p.nome] = p;
                if (['V', 'E', 'H', 'OP', 'VD', 'PINO'].includes(p.tipo)) p.ramo = ramo++;
                if (p.tipo === 'K2') {
                    // indutores acoplados: Γ = inversa de [[L1, M], [M, L2]]
                    const det = p.L1 * p.L2 - p.M * p.M;
                    p.gam = [[p.L2 / det, -p.M / det], [-p.M / det, p.L1 / det]];
                    const e = estadoAnterior && estadoAnterior[p.nome];
                    p.ant = e ? e.ant : { v1: 0, v2: 0, i1: 0, i2: 0 };
                }
                if (p.tipo === 'LAMP') { const e = estadoAnterior && estadoAnterior[p.nome]; p.teta = e ? e.teta : 0; }
                if (p.tipo === 'VD' && p.saida === undefined) p.saida = 0;
                if (p.tipo === 'D') { p.m = modeloCom(PADRAO.D, p.modelo); p.vd = 0; this.naoLineares = true; }
                if (p.tipo === 'Q') { p.m = modeloCom(PADRAO.Q, p.modelo); p.pol = p.modelo && p.modelo.tipo === 'PNP' ? -1 : (p.pol || 1); p.vbe = 0; p.vbc = 0; this.naoLineares = true; }
                if (p.tipo === 'M') {
                    p.m = modeloCom(PADRAO.M, p.modelo);
                    p.pol = p.modelo && p.modelo.tipo === 'PMOS' ? -1 : (p.pol || 1);
                    p.beta = p.m.KP * (p.W || p.m.W || 1) / (p.L || p.m.L || 1);
                    this.naoLineares = true;
                }
                if (p.tipo === 'OP' || p.tipo === 'RLIM') this.naoLineares = true;
                if (p.tipo === 'VD' || p.tipo === 'RELE' || p.tipo === 'PINO') this.temDigitais = true;
                if (p.tipo === 'RELE') { const e = estadoAnterior && estadoAnterior[p.nome]; p.ligado = e ? e.ligado : false; }
                if (p.tipo === 'C' || p.tipo === 'L') {
                    const e = estadoAnterior && estadoAnterior[p.nome];
                    p.vant = e ? e.v : 0; p.iant = e ? e.i : 0;
                }
                p.i = 0;
            });
            this.prims.forEach((p) => {
                if (p.tipo === 'F' || p.tipo === 'H') {
                    const r = porNome[p.ref];
                    if (!r || r.ramo === undefined) throw new Error(`${p.nome}: fonte de controle ${p.ref} não encontrada`);
                    p.ramoRef = r.ramo;
                }
            });
            this.nRamos = ramo;
            this.n = this.nNos - 1 + ramo;
            this.x = new Float64Array(this.n);
            this.A = new Float64Array(this.n * this.n);
            this.b = new Float64Array(this.n);
            this.porNome = porNome;
            if (this.temDigitais) this.digitais(); // portas e relés já começam coerentes
        }

        v(no) { return no > 0 ? this.x[no - 1] : 0; }
        tensao(no) { return this.v(no); }

        /** Avança um passo dt. Devolve true se resolveu. */
        passo(dt) {
            const t1 = this.t + dt;
            const n = this.n;
            if (n === 0) { this.t = t1; return true; }
            let convergiu = false;
            for (let it = 0; it < (this.naoLineares ? MAX_ITER : 1); it++) {
                this.montar(dt, t1, it);
                const A = this.A, b = this.b;
                if (!resolver(A, b, n)) throw new Error('Circuito sem solução: verifique nós soltos, fontes de tensão em paralelo ou laço de indutores e fontes.');
                let perto = true;
                for (let i = 0; i < n; i++) {
                    if (!isFinite(b[i])) throw new Error('A simulação divergiu (valor infinito). Reduza o passo de tempo ou revise o circuito.');
                    if (Math.abs(b[i] - this.x[i]) > 1e-6 + 1e-5 * Math.abs(b[i])) perto = false;
                }
                this.x.set(b);
                if (!this.naoLineares || (it > 0 && perto)) { convergiu = true; break; }
            }
            if (!convergiu) this.naoConvergiu++;
            this.aceitar(dt, t1);
            this.t = t1;
            this.dtUlt = dt;
            if (this.temDigitais) this.digitais();
            return convergiu;
        }

        montar(dt, t, iter) {
            const n = this.n, A = this.A, b = this.b, N = this.nNos - 1;
            A.fill(0); b.fill(0);
            const a = (i, j, g) => { if (i > 0 && j > 0) A[(i - 1) * n + (j - 1)] += g; };
            const ar = (i, col, g) => { if (i > 0) A[(i - 1) * n + col] += g; };   // coluna de ramo
            const ra = (row, j, g) => { if (j > 0) A[row * n + (j - 1)] += g; };   // linha de ramo
            const cond = (p, q, g) => { a(p, p, g); a(q, q, g); a(p, q, -g); a(q, p, -g); };
            const fonteI = (p, q, I) => { if (p > 0) b[p - 1] -= I; if (q > 0) b[q - 1] += I; }; // I de p para q pelo elemento
            for (let k = 1; k <= N; k++) A[(k - 1) * n + (k - 1)] += GMIN;

            for (const e of this.prims) {
                const [p, q, c, d] = e.nos;
                switch (e.tipo) {
                    case 'R': cond(p, q, 1 / Math.max(e.valor, 1e-9)); break;
                    case 'SW': cond(p, q, this.gChave(e)); break;
                    case 'RLIM': {
                        // resistor com corrente limitada (usado no slew rate): i = Imax·tanh(v/(R·Imax))
                        const v = this.v(p) - this.v(q), th = Math.tanh(v / (e.valor * e.imax));
                        const i = e.imax * th, g = (1 - th * th) / e.valor + GMIN;
                        cond(p, q, g); fonteI(p, q, i - g * v);
                        break;
                    }
                    case 'C': { const g = 2 * e.valor / dt; e.geq = g; e.J = g * e.vant + e.iant; cond(p, q, g); fonteI(p, q, -e.J); break; }
                    case 'L': { const g = dt / (2 * e.valor); e.geq = g; e.J = -(e.iant + g * e.vant); cond(p, q, g); fonteI(p, q, -e.J); break; }
                    case 'I': fonteI(p, q, valorFonte(e.fonte, t)); break;
                    case 'V': {
                        const k = N + e.ramo;
                        ar(p, k, 1); ar(q, k, -1); ra(k, p, 1); ra(k, q, -1);
                        b[k] = valorFonte(e.fonte, t);
                        break;
                    }
                    case 'E': {
                        const k = N + e.ramo, g = e.valor;
                        ar(p, k, 1); ar(q, k, -1); ra(k, p, 1); ra(k, q, -1); ra(k, c, -g); ra(k, d, g);
                        break;
                    }
                    case 'G': { const g = e.valor; a(p, c, g); a(p, d, -g); a(q, c, -g); a(q, d, g); break; }
                    case 'F': { const kc = N + e.ramoRef; ar(p, kc, e.valor); ar(q, kc, -e.valor); break; }
                    case 'H': {
                        const k = N + e.ramo, kc = N + e.ramoRef;
                        ar(p, k, 1); ar(q, k, -1); ra(k, p, 1); ra(k, q, -1); A[k * n + kc] -= e.valor;
                        break;
                    }
                    case 'VD': { // fonte digital (portas lógicas, entrada lógica): valor decidido no passo anterior
                        const k = N + e.ramo;
                        ar(p, k, 1); ar(q, k, -1); ra(k, p, 1); ra(k, q, -1);
                        b[k] = e.saida;
                        break;
                    }
                    case 'PINO': {
                        // pino de microcontrolador: saída = fonte (ideal ou com Rout); entrada = corrente zero (+ pull-up)
                        const k = N + e.ramo;
                        if (e.modo === 'saida' && !(e.rout > 0)) { ar(p, k, 1); ra(k, p, 1); b[k] = e.valor; break; }
                        A[k * n + k] = 1; b[k] = 0;
                        const g = e.modo === 'saida' ? 1 / e.rout : e.modo === 'pullup' ? 1 / e.rpu : 0;
                        if (g) { a(p, p, g); if (p > 0) b[p - 1] += g * (e.modo === 'saida' ? e.valor : e.vdd); }
                        break;
                    }
                    case 'K2': {
                        const [p1, p2, s1, s2] = e.nos, h = dt / 2, G = e.gam.map((l) => l.map((x) => x * h));
                        const a0 = e.ant;
                        const Ih1 = a0.i1 + G[0][0] * a0.v1 + G[0][1] * a0.v2, Ih2 = a0.i2 + G[1][0] * a0.v1 + G[1][1] * a0.v2;
                        e.G = G; e.Ih = [Ih1, Ih2];
                        const port = [[p1, p2], [s1, s2]];
                        for (let r = 0; r < 2; r++) for (let c2 = 0; c2 < 2; c2++) {
                            const [ra1, ra2] = port[r], [ca1, ca2] = port[c2], g = G[r][c2];
                            a(ra1, ca1, g); a(ra1, ca2, -g); a(ra2, ca1, -g); a(ra2, ca2, g);
                        }
                        fonteI(p1, p2, Ih1); fonteI(s1, s2, Ih2);
                        break;
                    }
                    case 'LAMP': cond(p, q, 1 / this.rLampada(e)); break;
                    case 'D': this.estampaDiodo(e, iter, cond, fonteI); break;
                    case 'Q': this.estampaBJT(e, iter, a, b); break;
                    case 'M': this.estampaMOS(e, a, b); break;
                    case 'OP': {
                        // amp-op: linear (v(out) = A·(vd + Vos)) ou saturado (v(out) = Vmax/Vmin), como no Falstad.
                        // A região sai da iteração anterior; do linear vai para a saturação se a saída passou do trilho,
                        // e da saturação só volta para o linear (nunca pula de +Vsat para −Vsat), o que evita oscilar no Newton.
                        const [out, ip, im] = e.nos, k = N + e.ramo, A = e.ganho, vos = e.vos || 0;
                        const vd = this.v(ip) - this.v(im) + vos, vo = this.v(out);
                        if (e.reg === undefined) e.reg = 0;
                        if (e.reg === 0) { if (vo > e.vmax + 1e-9) e.reg = 1; else if (vo < e.vmin - 1e-9) e.reg = -1; }
                        else if (e.reg === 1) { if (A * vd < e.vmax) e.reg = 0; }
                        else if (A * vd > e.vmin) e.reg = 0;
                        ar(out, k, 1); ra(k, out, 1);
                        if (e.reg === 0) { ra(k, ip, -A); ra(k, im, A); b[k] = A * vos; }
                        else b[k] = e.reg > 0 ? e.vmax : e.vmin;
                        break;
                    }
                }
            }
        }

        estampaDiodo(e, iter, cond, fonteI) {
            const m = e.m, [p, q] = e.nos;
            const nvt = m.N * VT;
            let vd = this.v(p) - this.v(q);
            const vcrit = nvt * Math.log(nvt / (Math.SQRT2 * m.IS));
            vd = pnjlim(vd, e.vd, nvt, vcrit);
            if (isFinite(m.BV) && vd < -m.BV + 5 * nvt && e.vd < -m.BV) {
                // limita também na ruptura (espelhado)
                const vr = -vd - m.BV, vro = -e.vd - m.BV;
                vd = -(m.BV + pnjlim(vr, vro, nvt, vcrit));
            }
            e.vd = vd;
            const ex = Math.exp(Math.min(vd / nvt, 80));
            let id = m.IS * (ex - 1), gd = m.IS * ex / nvt;
            if (isFinite(m.BV)) {
                const eb = Math.exp(Math.min((-m.BV - vd) / nvt, 80));
                const ibv = m.IBV || 1e-3; // corrente IBV na tensão BV (como no SPICE)
                id -= ibv * eb; gd += ibv * eb / nvt;
            }
            gd += GMIN;
            e.id = id; e.gd = gd;
            cond(p, q, gd);
            fonteI(p, q, id - gd * vd);
        }

        /** Dispositivo não linear genérico: correntes que entram em cada terminal e suas derivadas. */
        estampaNL(nos, I, J, a, b, vv = nos.map((k) => this.v(k))) {
            for (let r = 0; r < nos.length; r++) {
                const nr = nos[r];
                if (nr <= 0) continue;
                let rhs = I[r];
                for (let s = 0; s < nos.length; s++) { a(nr, nos[s], J[r][s]); rhs -= J[r][s] * vv[s]; }
                b[nr - 1] -= rhs;
            }
        }

        estampaBJT(e, iter, a, b) {
            const m = e.m, [nc, nb, ne] = e.nos, pol = e.pol;
            const vtf = m.NF * VT, vtr = m.NR * VT;
            const vcrit = vtf * Math.log(vtf / (Math.SQRT2 * m.IS));
            let vbe = pol * (this.v(nb) - this.v(ne));
            let vbc = pol * (this.v(nb) - this.v(nc));
            vbe = pnjlim(vbe, e.vbe, vtf, vcrit);
            vbc = pnjlim(vbc, e.vbc, vtr, vcrit);
            e.vbe = vbe; e.vbc = vbc;
            const ef = Math.exp(Math.min(vbe / vtf, 80)), er = Math.exp(Math.min(vbc / vtr, 80));
            const If = m.IS * (ef - 1), Ir = m.IS * (er - 1);
            const gf = m.IS * ef / vtf + GMIN, gr = m.IS * er / vtr + GMIN;
            const early = isFinite(m.VAF) ? 1 - vbc / m.VAF : 1;
            const Ic = (If - Ir) * early - Ir / m.BR;
            const Ib = If / m.BF + Ir / m.BR;
            const dIc_dbe = gf * early, dIc_dbc = -gr * early - gr / m.BR - (isFinite(m.VAF) ? (If - Ir) / m.VAF : 0);
            const dIb_dbe = gf / m.BF, dIb_dbc = gr / m.BR;
            // derivadas em relação a vc, vb, ve (pol² = 1)
            const Jc = [-dIc_dbc, dIc_dbe + dIc_dbc, -dIc_dbe];
            const Jb = [-dIb_dbc, dIb_dbe + dIb_dbc, -dIb_dbe];
            const Je = Jc.map((x, i) => -(x + Jb[i]));
            e.ic = pol * Ic; e.ib = pol * Ib; e.ie = -(e.ic + e.ib);
            const ve = this.v(ne), vb = ve + pol * vbe, vc = vb - pol * vbc; // ponto de linearização (limitado)
            this.estampaNL([nc, nb, ne], [e.ic, e.ib, e.ie], [Jc, Jb, Je], a, b, [vc, vb, ve]);
        }

        idMOS(e, vd, vg, vs) {
            const p = e.pol;
            let d = p * vd, g = p * vg, s = p * vs, sinal = 1;
            if (d < s) { const t = d; d = s; s = t; sinal = -1; }
            const vgs = g - s, vds = d - s;
            const vov = vgs - p * e.m.VTO; // PMOS: VTO negativo no modelo SPICE
            let id = 0;
            if (vov > 0) {
                id = vds < vov ? e.beta * (vov * vds - vds * vds / 2) * (1 + e.m.LAMBDA * vds)
                    : e.beta / 2 * vov * vov * (1 + e.m.LAMBDA * vds);
            }
            return p * sinal * id; // corrente que entra no dreno
        }

        estampaMOS(e, a, b) {
            const [nd, ng, ns] = e.nos;
            const vd = this.v(nd), vg = this.v(ng), vs = this.v(ns), h = 1e-6;
            const id = this.idMOS(e, vd, vg, vs);
            const gdd = (this.idMOS(e, vd + h, vg, vs) - id) / h + GMIN;
            const gdg = (this.idMOS(e, vd, vg + h, vs) - id) / h;
            const gds = (this.idMOS(e, vd, vg, vs + h) - id) / h - GMIN;
            e.idr = id;
            this.estampaNL([nd, ng, ns], [id, 0, -id], [[gdd, gdg, gds], [0, 0, 0], [-gdd, -gdg, -gds]], a, b);
        }

        aceitar(dt) {
            const N = this.nNos - 1;
            for (const e of this.prims) {
                const [p, q] = e.nos;
                const v = this.v(p) - this.v(q);
                switch (e.tipo) {
                    case 'R': e.i = v / Math.max(e.valor, 1e-9); break;
                    case 'SW': e.i = v * this.gChave(e); break;
                    case 'RLIM': e.i = e.imax * Math.tanh(v / (e.valor * e.imax)); break;
                    case 'C': case 'L': e.i = e.geq * v - e.J; e.vant = v; e.iant = e.i; break;
                    case 'I': e.i = valorFonte(e.fonte, this.t + dt); break;
                    case 'V': case 'E': case 'H': e.i = -this.x[N + e.ramo]; break; // corrente que sai pelo + (convenção de fonte)
                    case 'OP': e.i = -this.x[N + e.ramo]; break;
                    case 'G': e.i = e.valor * (this.v(e.nos[2]) - this.v(e.nos[3])); break;
                    case 'F': e.i = e.valor * this.x[N + e.ramoRef]; break;
                    case 'D': e.i = e.id; break;
                    case 'VD': e.i = -this.x[N + e.ramo]; break;
                    case 'PINO': {
                        const vp = this.v(p);
                        e.i = e.modo === 'saida' ? (e.rout > 0 ? (e.valor - vp) / e.rout : -this.x[N + e.ramo]) : e.modo === 'pullup' ? (e.vdd - vp) / e.rpu : 0;
                        break;
                    }
                    case 'LAMP': {
                        const R = this.rLampada(e); e.i = v / R;
                        const P = v * v / R;
                        // temperatura normalizada do filamento: em regime, teta = P/Pnominal (teta = 1 na potência nominal)
                        e.teta += (dt / e.tau) * (Math.min(P / e.pnom, 4) - e.teta);
                        e.brilho = Math.min(1.5, P / e.pnom);
                        break;
                    }
                    case 'K2': {
                        const [p1, p2, s1, s2] = e.nos, v1 = this.v(p1) - this.v(p2), v2 = this.v(s1) - this.v(s2);
                        const i1 = e.G[0][0] * v1 + e.G[0][1] * v2 + e.Ih[0], i2 = e.G[1][0] * v1 + e.G[1][1] * v2 + e.Ih[1];
                        e.ant = { v1, v2, i1, i2 }; e.i = i1; e.i2 = i2;
                        break;
                    }
                    case 'Q': e.i = e.ic; break;
                    case 'M': e.i = e.idr; break;
                }
            }
        }

        gChave(e) {
            if (e.ligada) return 1 / (e.ron > 0 ? e.ron : 1e-4);
            return e.roff > 0 && isFinite(e.roff) ? 1 / e.roff : (e.roff === undefined ? 1e-9 : 0);
        }

        rLampada(e) { return e.rfria + (e.rquente - e.rfria) * Math.max(0, e.teta); }

        /** Depois de cada passo: portas lógicas e relés decidem a saída do próximo passo (como no Falstad). */
        digitais() {
            for (const e of this.prims) {
                if (e.tipo === 'VD' && e.func) {
                    const lim = e.vdd / 2;
                    const ent = (e.entradas || []).map((k) => this.v(k) > lim);
                    let y;
                    switch (e.func) {
                        case 'not': y = !ent[0]; break;
                        case 'and': y = ent.every(Boolean); break;
                        case 'nand': y = !ent.every(Boolean); break;
                        case 'or': y = ent.some(Boolean); break;
                        case 'nor': y = !ent.some(Boolean); break;
                        case 'xor': y = ent.filter(Boolean).length % 2 === 1; break;
                        case 'xnor': y = ent.filter(Boolean).length % 2 === 0; break;
                        case 'ext': y = !!e.alto; break; // entrada lógica / pino de microcontrolador
                        default: y = false;
                    }
                    e.saida = y ? e.vdd : 0;
                }
                if (e.tipo === 'RELE') {
                    const bob = this.porNome[e.bobina];
                    const i = bob ? Math.abs(bob.i) : 0;
                    if (!e.ligado && i >= e.ion) e.ligado = true;
                    else if (e.ligado && i < e.ioff) e.ligado = false;
                    (e.contatos || []).forEach(([nome, nf]) => { const c = this.porNome[nome]; if (c) c.ligada = nf ? !e.ligado : e.ligado; });
                }
            }
            if (this.aoPasso) this.aoPasso(this);
        }

        /** Estados de C e L por nome, para reaproveitar ao reconstruir o circuito. */
        estados() {
            const s = {};
            this.prims.forEach((p) => {
                if (p.tipo === 'C' || p.tipo === 'L') s[p.nome] = { v: p.vant, i: p.iant };
                if (p.tipo === 'K2') s[p.nome] = { ant: p.ant };
                if (p.tipo === 'LAMP') s[p.nome] = { teta: p.teta };
                if (p.tipo === 'RELE') s[p.nome] = { ligado: p.ligado };
            });
            return s;
        }

        prim(nome) { return this.porNome[nome] || null; }
    }

    const API = { Motor, valorFonte, VT, PADRAO };
    if (typeof module !== 'undefined' && module.exports) module.exports = API;
    else raiz.MotorSim = API;
})(typeof window !== 'undefined' ? window : globalThis);
