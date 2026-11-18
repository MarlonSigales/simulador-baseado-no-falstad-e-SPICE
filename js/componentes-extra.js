/**
 * © 2026 Simulador de Circuitos (Falstad + SPICE) — Marlon Sigales. Todos os direitos reservados; copiar, reproduzir ou alterar exige autorização do autor (ver LICENSE).
 *
 * Mais componentes: potenciômetro, eletrolítico, chave de 2 posições, transformador, lâmpada, relé, amperímetro,
 * portas lógicas, entrada e saída lógica, rótulo de nó e texto. Teclas iguais às do Falstad onde ele tem.
 * Registra-se no catálogo de componentes.js (que chama esta função com os auxiliares de desenho).
 */

'use strict';

(function (raiz) {
    function registrar(X) {
        const { DEFS, GRUPOS, S, bipolo, linha, terminal, rotulo, comGiro, caixaGirada, pinosPorOffsets, num, NI, rede, nm, fmt, RMIN, ativoInf } = X;
        const COR_TXT = '#1d2b2b';
        const fonteTxt = (g, peso = '', tam = 12) => { g.font = `${peso} ${tam}px Segoe UI, Roboto, Arial`.trim(); };
        const deEm = (g, el, f) => { g.save(); g.rotate(-(el.rot || 0) * Math.PI / 2); f(); g.restore(); }; // texto sempre de pé

        GRUPOS.splice(GRUPOS.findIndex((x) => x.id === 'integrados'), 0, { id: 'logica', nome: 'Lógica digital' });

        // ------------------------------------------------------------ potenciômetro
        DEFS.potenciometro = {
            icone: '⇋', nome: 'Potenciômetro (roda do mouse ajusta)', curto: 'Potenciômetro', grupo: 'passivos', bipolo: false,
            props: { R: '10k', pos: '0.5' },
            campos: [{ k: 'R', r: 'Resistência total', u: 'Ω' }, { k: 'pos', r: 'Posição do cursor', tipo: 'faixa' }],
            // pinos: A, B, cursor
            pinos: (el) => pinosPorOffsets(el, [[-48, 0], [48, 0], [0, -32]]),
            nomesPinos: ['A', 'B', 'cursor'],
            caixa: (el) => caixaGirada(el, -48, -36, 96, 52),
            roda(el, passo) { el.props.pos = String(Math.max(0, Math.min(1, Math.round(((parseFloat(el.props.pos) || 0) + passo * 0.05) * 100) / 100))); },
            desenhar(g, el, info) {
                const x = parseFloat(el.props.pos) || 0;
                comGiro(g, el, () => {
                    terminal(g, -48, 0, -32, 0, info.cor(info.v[0])); terminal(g, 32, 0, 48, 0, info.cor(info.v[1]));
                    const grad = g.createLinearGradient(-32, 0, 32, 0); grad.addColorStop(0, info.cor(info.v[0])); grad.addColorStop(1, info.cor(info.v[1]));
                    g.strokeStyle = grad; g.lineWidth = 2.5; g.beginPath(); g.moveTo(-32, 0);
                    for (let i = 0; i < 8; i++) g.lineTo(-32 + (i + 0.5) * 8, i % 2 ? 6 : -6);
                    g.lineTo(32, 0); g.stroke();
                    const cx = -32 + 64 * x;
                    g.strokeStyle = info.cor(info.v[2]); g.lineWidth = 2.5; g.beginPath(); g.moveTo(0, -32); g.lineTo(0, -20); g.lineTo(cx, -20); g.lineTo(cx, -10); g.stroke();
                    g.fillStyle = info.cor(info.v[2]); g.beginPath(); g.moveTo(cx, -7); g.lineTo(cx - 4, -14); g.lineTo(cx + 4, -14); g.closePath(); g.fill();
                    deEm(g, el, () => { g.fillStyle = COR_TXT; fonteTxt(g, '', 11); g.textAlign = 'center'; g.fillText(`${fmt(el.props.R, 'Ω')} · ${Math.round(x * 100)} %`, 0, 22); });
                });
            },
            prims(el, n, ctx) {
                const R = S.valor(el.props.R), x = Math.max(0, Math.min(1, parseFloat(el.props.pos) || 0));
                ctx.add({ tipo: 'R', nos: [n[0], n[2]], valor: Math.max(R * x, RMIN) });
                ctx.add({ tipo: 'R', nos: [n[2], n[1]], valor: Math.max(R * (1 - x), RMIN) });
            },
            spice(el, n) {
                const R = S.valor(el.props.R), x = Math.max(0, Math.min(1, parseFloat(el.props.pos) || 0));
                return `R${el.id}_A ${n[0]} ${n[2]} ${Math.max(R * x, RMIN)}\nR${el.id}_B ${n[2]} ${n[1]} ${Math.max(R * (1 - x), RMIN)}`;
            }
        };

        // ------------------------------------------------------------ capacitor eletrolítico (polarizado)
        DEFS.eletrolitico = Object.assign({}, DEFS.capacitor, {
            icone: 'C+', nome: 'Capacitor eletrolítico', curto: 'Eletrolítico', tecla: 'C',
            props: Object.assign({}, DEFS.capacitor.props, { C: '100u' }),
            desenhar(g, el, info) {
                bipolo(g, el, info, 24, (g, c) => {
                    g.lineWidth = 2; linha(g, 0, 0, c / 2 - 4, 0); linha(g, c / 2 + 5, 0, c, 0);
                    g.lineWidth = 3; linha(g, c / 2 - 4, -11, c / 2 - 4, 11);
                    g.beginPath(); g.arc(c / 2 + 14, 0, 12, Math.PI * 0.72, Math.PI * 1.28); g.stroke();
                    g.lineWidth = 1.5; g.strokeStyle = COR_TXT; linha(g, c / 2 - 12, -12, c / 2 - 8, -12); linha(g, c / 2 - 10, -14, c / 2 - 10, -10); // + no p0
                });
            },
            avisoPolaridade: true
        });

        // ------------------------------------------------------------ chave de 2 posições (SPDT)
        DEFS.chave2 = {
            icone: 'S2', nome: 'Chave de 2 posições (clique troca)', curto: 'Chave 2 posições', grupo: 'passivos', bipolo: false, tecla: 'S',
            props: { posicao: 'A', Ron: '0', Roff: '∞' },
            campos: [{ k: 'posicao', r: 'Posição', tipo: 'sel', op: [['A', 'A (de cima)'], ['B', 'B (de baixo)']] }, NI('Ron', 'Resistência fechada (Ron)', 'Ω', '0 = ideal'), NI('Roff', 'Resistência aberta (Roff)', 'Ω', '∞ = ideal')],
            pinos: (el) => pinosPorOffsets(el, [[-32, 0], [32, -16], [32, 16]]),
            nomesPinos: ['comum', 'A', 'B'],
            caixa: (el) => caixaGirada(el, -32, -24, 64, 48),
            clicavel: true,
            clicar(el) { el.props.posicao = el.props.posicao === 'A' ? 'B' : 'A'; },
            desenhar(g, el, info) {
                comGiro(g, el, () => {
                    terminal(g, -32, 0, -12, 0, info.cor(info.v[0]));
                    terminal(g, 32, -16, 14, -16, info.cor(info.v[1])); terminal(g, 32, 16, 14, 16, info.cor(info.v[2]));
                    g.fillStyle = COR_TXT; [[-12, 0], [14, -16], [14, 16]].forEach(([x, y]) => { g.beginPath(); g.arc(x, y, 2.5, 0, 7); g.fill(); });
                    g.strokeStyle = info.cor(info.v[0]); g.lineWidth = 2.5; linha(g, -12, 0, 12, el.props.posicao === 'A' ? -15 : 15);
                });
            },
            prims(el, n, ctx) {
                const ron = Math.max(num(el.props.Ron) || 0, RMIN), roff = num(el.props.Roff);
                ctx.add({ tipo: 'SW', nos: [n[0], n[1]], ligada: el.props.posicao === 'A', ron, roff });
                ctx.add({ tipo: 'SW', nos: [n[0], n[2]], ligada: el.props.posicao === 'B', ron, roff });
            },
            spice(el, n) {
                const ron = Math.max(num(el.props.Ron) || 0, RMIN), roff = num(el.props.Roff);
                const r = (lig) => (lig ? ron : roff);
                return [['A', 1], ['B', 2]].map(([p, i]) => (isFinite(r(el.props.posicao === p)) ? `R${el.id}_${p} ${n[0]} ${n[i]} ${r(el.props.posicao === p)}` : `* ${el.id}: contato ${p} aberto`)).join('\n');
            }
        };

        // ------------------------------------------------------------ transformador
        DEFS.transformador = {
            icone: '⧛', nome: 'Transformador', grupo: 'passivos', bipolo: false, tecla: 'T',
            props: { Lp: '1', n: '1', k: '1', Rp: '0', Rs: '0' },
            campos: [
                { k: 'Lp', r: 'Indutância do primário (magnetização)', u: 'H' },
                { k: 'n', r: 'Relação de espiras (secundário ÷ primário)' },
                Object.assign(NI('k', 'Acoplamento k (1 = ideal; o motor usa no máx. 0,99999)', '', '1 = ideal'), { ideal: '1' }),
                NI('Rp', 'Resistência do primário', 'Ω', '0 = ideal'), NI('Rs', 'Resistência do secundário', 'Ω', '0 = ideal')
            ],
            // pinos: primário 1, primário 2, secundário 1, secundário 2 (pontos de polaridade em 1)
            pinos: (el) => pinosPorOffsets(el, [[-32, -32], [-32, 32], [32, -32], [32, 32]]),
            nomesPinos: ['primário •', 'primário', 'secundário •', 'secundário'],
            caixa: (el) => caixaGirada(el, -32, -36, 64, 72),
            desenhar(g, el, info) {
                comGiro(g, el, () => {
                    const bob = (x, s, v0, v1) => {
                        terminal(g, x, -32, x + s * 0, -24, info.cor(v0)); terminal(g, x, 32, x, 24, info.cor(v1));
                        g.strokeStyle = '#1d2b2b'; g.lineWidth = 2; g.beginPath();
                        for (let i = 0; i < 4; i++) g.arc(x, -18 + i * 12, 6, -Math.PI / 2, Math.PI / 2, s < 0);
                        g.stroke();
                    };
                    bob(-32, 1, info.v[0], info.v[1]); bob(32, -1, info.v[2], info.v[3]);
                    g.strokeStyle = '#1d2b2b'; g.lineWidth = 2; linha(g, -3, -26, -3, 26); linha(g, 3, -26, 3, 26);
                    g.fillStyle = '#1d2b2b'; g.beginPath(); g.arc(-18, -28, 2.5, 0, 7); g.fill(); g.beginPath(); g.arc(18, -28, 2.5, 0, 7); g.fill();
                    deEm(g, el, () => { fonteTxt(g, '', 10); g.textAlign = 'center'; g.fillText(`1:${el.props.n}`, 0, 40); });
                });
            },
            valores(el) {
                const L1 = S.valor(el.props.Lp), nn = S.valor(el.props.n), L2 = L1 * nn * nn;
                const k = Math.min(Math.max(num(el.props.k), 0), 0.99999);
                return { L1, L2, M: k * Math.sqrt(L1 * L2), k };
            },
            prims(el, n, ctx) {
                const { L1, L2, M } = this.valores(el);
                const rp = num(el.props.Rp), rs = num(el.props.Rs);
                const a = rp > 0 && isFinite(rp) ? ctx.novoNo('RP') : n[0];
                const b = rs > 0 && isFinite(rs) ? ctx.novoNo('RS') : n[2];
                ctx.add({ tipo: 'K2', nos: [a, n[1], b, n[3]], L1, L2, M });
                if (a !== n[0]) ctx.add({ tipo: 'R', nos: [n[0], a], valor: rp });
                if (b !== n[2]) ctx.add({ tipo: 'R', nos: [n[2], b], valor: rs });
            },
            spice(el, n, ctx) {
                const { L1, L2, k } = this.valores(el);
                const rp = num(el.props.Rp), rs = num(el.props.Rs);
                const a = rp > 0 && isFinite(rp) ? ctx.novoNo('RP') : n[0];
                const b = rs > 0 && isFinite(rs) ? ctx.novoNo('RS') : n[2];
                const L = [`L${el.id}_P ${a} ${n[1]} ${L1}`, `L${el.id}_S ${b} ${n[3]} ${L2}`, `K${el.id} L${el.id}_P L${el.id}_S ${k}`];
                if (a !== n[0]) L.push(`R${el.id}_P ${n[0]} ${a} ${rp}`);
                if (b !== n[2]) L.push(`R${el.id}_S ${n[2]} ${b} ${rs}`);
                return L.join('\n');
            },
            correntesPinos: (p) => (p ? [p.i, -p.i, p.i2, -p.i2] : null)
        };

        // ------------------------------------------------------------ lâmpada incandescente
        DEFS.lampada = {
            icone: '💡', nome: 'Lâmpada incandescente', curto: 'Lâmpada', grupo: 'passivos', bipolo: true,
            props: { Vn: '12', Pn: '5', tau: '50m' },
            campos: [{ k: 'Vn', r: 'Tensão nominal', u: 'V' }, { k: 'Pn', r: 'Potência nominal', u: 'W' }, { k: 'tau', r: 'Constante térmica do filamento', u: 's' }],
            texto: (el) => `${fmt(el.props.Vn, 'V')} ${fmt(el.props.Pn, 'W')}`,
            desenhar(g, el, info) {
                const b = info.prim ? info.prim.brilho || 0 : 0;
                bipolo(g, el, info, 32, (g, c) => {
                    if (b > 0.02) { g.save(); g.globalAlpha = Math.min(0.85, 0.2 + 0.6 * b); g.fillStyle = '#ffd84d'; g.beginPath(); g.arc(c / 2, 0, 14 + 8 * Math.min(b, 1), 0, 7); g.fill(); g.restore(); }
                    g.lineWidth = 2; g.strokeStyle = '#1d2b2b'; g.fillStyle = 'rgba(255,255,255,.6)';
                    g.beginPath(); g.arc(c / 2, 0, 14, 0, 7); g.fill(); g.stroke();
                    g.beginPath(); g.moveTo(0, 0); g.lineTo(c / 2 - 7, 0); g.lineTo(c / 2 - 4, -5); g.lineTo(c / 2, 5); g.lineTo(c / 2 + 4, -5); g.lineTo(c / 2 + 7, 0); g.lineTo(c, 0); g.stroke();
                });
            },
            prims(el, n, ctx) {
                const Vn = S.valor(el.props.Vn), Pn = S.valor(el.props.Pn), Rq = Vn * Vn / Pn;
                ctx.add({ tipo: 'LAMP', nos: n, rquente: Rq, rfria: Rq / 10, pnom: Pn, tau: Math.max(S.valor(el.props.tau) || 0.05, 1e-6) });
            },
            spice(el, n) { const Vn = S.valor(el.props.Vn), Pn = S.valor(el.props.Pn); return `R${el.id} ${n[0]} ${n[1]} ${Vn * Vn / Pn}  ; lâmpada a quente (o netlist não tem o aquecimento do filamento)`; }
        };

        // ------------------------------------------------------------ relé
        DEFS.rele = {
            icone: 'K', nome: 'Relé (bobina + contato reversível)', curto: 'Relé', grupo: 'passivos', bipolo: false, tecla: 'R',
            props: { Rb: '100', Lb: '100m', Ion: '20m', Ioff: '10m', Ron: '0', Roff: '∞' },
            campos: [
                { k: 'Rb', r: 'Resistência da bobina', u: 'Ω' }, { k: 'Lb', r: 'Indutância da bobina', u: 'H' },
                { k: 'Ion', r: 'Corrente para ligar', u: 'A' }, { k: 'Ioff', r: 'Corrente para desligar', u: 'A' },
                NI('Ron', 'Resistência do contato fechado', 'Ω', '0 = ideal'), NI('Roff', 'Resistência do contato aberto', 'Ω', '∞ = ideal')
            ],
            // pinos: bobina 1, bobina 2, comum, NA, NF
            pinos: (el) => pinosPorOffsets(el, [[-48, -16], [-48, 16], [48, 0], [48, -32], [48, 32]]),
            nomesPinos: ['bobina 1', 'bobina 2', 'comum', 'NA', 'NF'],
            caixa: (el) => caixaGirada(el, -48, -36, 96, 72),
            desenhar(g, el, info) {
                const lig = info.prims && info.prims.rele ? info.prims.rele.ligado : false;
                comGiro(g, el, () => {
                    terminal(g, -48, -16, -36, -16, info.cor(info.v[0])); terminal(g, -48, 16, -36, 16, info.cor(info.v[1]));
                    g.strokeStyle = '#1d2b2b'; g.lineWidth = 2; g.fillStyle = '#fff'; g.fillRect(-36, -22, 20, 44); g.strokeRect(-36, -22, 20, 44);
                    linha(g, -36, -22, -16, 22);
                    terminal(g, 48, 0, 30, 0, info.cor(info.v[2])); terminal(g, 48, -32, 30, -32, info.cor(info.v[3])); terminal(g, 48, 32, 30, 32, info.cor(info.v[4]));
                    terminal(g, 30, -32, 30, -18, info.cor(info.v[3])); terminal(g, 30, 32, 30, 18, info.cor(info.v[4]));
                    g.strokeStyle = info.cor(info.v[2]); g.lineWidth = 2.5; linha(g, 30, 0, 8, 0); linha(g, 8, 0, 28, lig ? -17 : 17);
                    g.setLineDash([3, 3]); g.strokeStyle = '#5f6f6d'; g.lineWidth = 1; linha(g, -16, 0, 6, 0); g.setLineDash([]);
                    deEm(g, el, () => { fonteTxt(g, 'bold', 9); g.fillStyle = lig ? '#16a046' : '#5f6f6d'; g.textAlign = 'center'; g.fillText(lig ? 'LIGADO' : 'desligado', -26, -28); });
                });
            },
            prims(el, n, ctx) {
                const k = ctx.novoNo('BOB');
                ctx.add({ tipo: 'R', nos: [n[0], k], valor: Math.max(S.valor(el.props.Rb), RMIN) });
                ctx.add({ tipo: 'L', nos: [k, n[1]], valor: S.valor(el.props.Lb) });
                const ron = Math.max(num(el.props.Ron) || 0, RMIN), roff = num(el.props.Roff);
                const na = { tipo: 'SW', nos: [n[2], n[3]], ligada: false, ron, roff };
                const nf = { tipo: 'SW', nos: [n[2], n[4]], ligada: true, ron, roff };
                ctx.add(na); ctx.add(nf);
                ctx.add({ tipo: 'RELE', nos: [], bobina: el.id, /* o 1º primitivo (R da bobina) leva o id */ ion: S.valor(el.props.Ion), ioff: S.valor(el.props.Ioff), contatos: [[na.nome, false], [nf.nome, true]] }, { papel: 'rele' });
            },
            spice(el, n) {
                const ron = Math.max(num(el.props.Ron) || 0, RMIN), roff = num(el.props.Roff);
                return [`* ${el.id}: relé exportado no estado desligado (o netlist não comuta)`, `R${el.id}_B ${n[0]} N_${el.id}_B ${S.valor(el.props.Rb)}`, `L${el.id}_B N_${el.id}_B ${n[1]} ${S.valor(el.props.Lb)}`,
                    isFinite(roff) ? `R${el.id}_NA ${n[2]} ${n[3]} ${roff}` : `* ${el.id}: NA aberto`, `R${el.id}_NF ${n[2]} ${n[4]} ${ron}`].join('\n');
            }
        };

        // ------------------------------------------------------------ amperímetro
        DEFS.amperimetro = {
            icone: 'A', nome: 'Amperímetro', grupo: 'instrumentos', bipolo: true, props: { Rint: '0' },
            campos: [NI('Rint', 'Resistência interna (shunt)', 'Ω', '0 = ideal')],
            texto: () => '',
            desenhar(g, el, info) {
                bipolo(g, el, info, 32, (g, c) => { g.lineWidth = 2; g.fillStyle = '#fff'; g.beginPath(); g.arc(c / 2, 0, 15, 0, 7); g.fill(); g.stroke(); });
                const [[x1, y1], [x2, y2]] = el.p;
                g.save(); g.fillStyle = COR_TXT; fonteTxt(g, 'bold', 13); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('A', (x1 + x2) / 2, (y1 + y2) / 2 + 1); g.restore();
                rotulo(g, el, S.formatar(info.i, 'A'));
            },
            prims(el, n, ctx) { ctx.add({ tipo: 'R', nos: n, valor: Math.max(num(el.props.Rint) || 0, RMIN) }); },
            spice(el, n) { return `V${el.id}_AMP ${n[0]} N_${el.id}_A 0\nR${el.id} N_${el.id}_A ${n[1]} ${Math.max(num(el.props.Rint) || 0, RMIN)}`; }
        };

        // ------------------------------------------------------------ lógica digital
        const CAMPOS_LOGICA = [{ k: 'VDD', r: 'Nível alto (VDD)', u: 'V' }, NI('Rout', 'Resistência de saída', 'Ω', '0 = ideal')];
        /** Saída digital: fonte VD (+ Rout) no pino de saída. */
        function saidaDigital(el, nSaida, ctx, extra) {
            const rout = num(el.props.Rout);
            const k = rout > 0 && isFinite(rout) ? ctx.novoNo('OUT') : nSaida;
            const p = Object.assign({ tipo: 'VD', nos: [k, 0], vdd: S.valor(el.props.VDD) || 5 }, extra);
            ctx.add(p, { corrente: true });
            if (k !== nSaida) ctx.add({ tipo: 'R', nos: [k, nSaida], valor: rout });
            return p;
        }
        function spiceDigital(el, nSaida, alto) {
            const rout = num(el.props.Rout), vdd = S.valor(el.props.VDD) || 5;
            const k = rout > 0 && isFinite(rout) ? `N_${el.id}_OUT` : nSaida;
            return `V${el.id} ${k} 0 DC ${alto ? vdd : 0}  ; nível lógico no instante da exportação` + (k !== nSaida ? `\nR${el.id}_OUT ${k} ${nSaida} ${rout}` : '');
        }

        const PORTAS = [
            ['porta_not', 'Inversor (NÃO)', 'not', '1'], ['porta_and', 'Porta E (AND)', 'and', '2'], ['porta_nand', 'Porta NÃO-E (NAND)', 'nand', '@'],
            ['porta_or', 'Porta OU (OR)', 'or', '3'], ['porta_nor', 'Porta NÃO-OU (NOR)', 'nor', '#'], ['porta_xor', 'Porta OU exclusivo (XOR)', 'xor', '4'], ['porta_xnor', 'Porta XNOR', 'xnor', '$']
        ];
        PORTAS.forEach(([id, nome, func, tecla]) => {
            const um = func === 'not';
            const neg = ['not', 'nand', 'nor', 'xnor'].includes(func);
            DEFS[id] = {
                icone: { not: '¬', and: '&', nand: '⊼', or: '≥1', nor: '⊽', xor: '=1', xnor: '⊙' }[func], nome, curto: nome.replace(/ \(.+\)/, ''), grupo: 'logica', bipolo: false, tecla,
                props: { VDD: '5', Rout: '0' },
                campos: CAMPOS_LOGICA,
                pinos: (el) => pinosPorOffsets(el, um ? [[48, 0], [-48, 0]] : [[48, 0], [-48, -16], [-48, 16]]),
                nomesPinos: um ? ['saída', 'entrada'] : ['saída', 'entrada A', 'entrada B'],
                caixa: (el) => caixaGirada(el, -48, -26, 96, 52),
                desenhar(g, el, info) {
                    comGiro(g, el, () => {
                        if (um) terminal(g, -48, 0, -24, 0, info.cor(info.v[1]));
                        else { terminal(g, -48, -16, -24, -16, info.cor(info.v[1])); terminal(g, -48, 16, -24, 16, info.cor(info.v[2])); }
                        terminal(g, neg ? 32 : 26, 0, 48, 0, info.cor(info.v[0]));
                        g.strokeStyle = '#1d2b2b'; g.fillStyle = '#fff'; g.lineWidth = 2; g.beginPath();
                        if (um) { g.moveTo(-24, -16); g.lineTo(20, 0); g.lineTo(-24, 16); g.closePath(); }
                        else if (func === 'and' || func === 'nand') { g.moveTo(-24, -22); g.lineTo(4, -22); g.arc(4, 0, 22, -Math.PI / 2, Math.PI / 2); g.lineTo(-24, 22); g.closePath(); }
                        else { g.moveTo(-26, -22); g.quadraticCurveTo(10, -22, 26, 0); g.quadraticCurveTo(10, 22, -26, 22); g.quadraticCurveTo(-14, 0, -26, -22); g.closePath(); }
                        g.fill(); g.stroke();
                        if (func === 'xor' || func === 'xnor') { g.beginPath(); g.moveTo(-32, -22); g.quadraticCurveTo(-20, 0, -32, 22); g.stroke(); }
                        if (neg) { const x = um ? 24 : 30; g.beginPath(); g.arc(x - (um ? 0 : 1), 0, 4, 0, 7); g.fill(); g.stroke(); }
                    });
                },
                prims(el, n, ctx) { saidaDigital(el, n[0], ctx, { func, entradas: n.slice(1) }); },
                spice(el, n, ctx) { return spiceDigital(el, n[0], false) + `  ; porta ${func}: no netlist a saída fica fixa`; }
            };
        });

        DEFS.entradaLogica = {
            icone: 'H', nome: 'Entrada lógica (clique troca H/L)', curto: 'Entrada lógica', grupo: 'logica', bipolo: false, tecla: 'i',
            props: { alto: false, VDD: '5', Rout: '0' },
            campos: [{ k: 'alto', r: 'Nível alto (H)', tipo: 'bool' }].concat(CAMPOS_LOGICA),
            pinos: (el) => pinosPorOffsets(el, [[0, 0]]),
            caixa: (el) => caixaGirada(el, -40, -14, 44, 28),
            clicavel: true,
            clicar(el) { el.props.alto = !el.props.alto; },
            desenhar(g, el, info) {
                comGiro(g, el, () => {
                    terminal(g, -14, 0, 0, 0, info.cor(info.v[0]));
                    g.fillStyle = el.props.alto ? '#16a046' : '#5f6f6d'; g.fillRect(-40, -12, 26, 24);
                    deEm(g, el, () => { g.fillStyle = '#fff'; fonteTxt(g, 'bold', 13); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(el.props.alto ? 'H' : 'L', (el.rot % 2 ? 0 : -27) * (el.rot === 2 ? -1 : 1), el.rot === 1 ? -27 : el.rot === 3 ? 27 : 1); });
                });
            },
            prims(el, n, ctx) { saidaDigital(el, n[0], ctx, { func: 'ext', alto: !!el.props.alto }); },
            spice(el, n) { return spiceDigital(el, n[0], !!el.props.alto); }
        };

        DEFS.saidaLogica = {
            icone: 'o', nome: 'Saída lógica (indicador H/L)', curto: 'Saída lógica', grupo: 'logica', bipolo: false, tecla: 'o',
            props: { limiar: '2.5' },
            campos: [{ k: 'limiar', r: 'Limiar entre L e H', u: 'V' }],
            pinos: (el) => pinosPorOffsets(el, [[0, 0]]),
            caixa: (el) => caixaGirada(el, 0, -14, 44, 28),
            desenhar(g, el, info) {
                const alto = info.v[0] > (S.valor(el.props.limiar) || 2.5);
                comGiro(g, el, () => {
                    terminal(g, 0, 0, 16, 0, info.cor(info.v[0]));
                    g.fillStyle = alto ? '#a8e156' : '#e6ece9'; g.strokeStyle = '#1d2b2b'; g.lineWidth = 1.5;
                    g.beginPath(); g.arc(30, 0, 13, 0, 7); g.fill(); g.stroke();
                    deEm(g, el, () => { g.fillStyle = '#1d2b2b'; fonteTxt(g, 'bold', 12); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(alto ? 'H' : 'L', el.rot === 1 ? 0 : el.rot === 3 ? 0 : el.rot === 2 ? -30 : 30, el.rot === 1 ? -30 : el.rot === 3 ? 30 : 1); });
                });
            },
            prims() {},
            spice() { return ''; }
        };

        // ------------------------------------------------------------ rótulo de nó e texto
        DEFS.rotuloNo = {
            icone: '#', nome: 'Rótulo de nó (mesmo nome = mesmo nó)', curto: 'Rótulo de nó', grupo: 'ferramentas', bipolo: false, tecla: 'b',
            props: { nome: 'N1' },
            campos: [{ k: 'nome', r: 'Nome do nó', texto: true }],
            pinos: (el) => pinosPorOffsets(el, [[0, 0]]),
            caixa: (el) => caixaGirada(el, 0, -10, 16 + 8 * String(el.props.nome).length, 20),
            rotuloNo: (el) => String(el.props.nome || '').trim().toUpperCase(),
            desenhar(g, el, info) {
                comGiro(g, el, () => {
                    const w = 8 + 8 * String(el.props.nome).length;
                    terminal(g, 0, 0, 8, 0, info.cor(info.v[0]));
                    g.fillStyle = '#fff'; g.strokeStyle = '#085357'; g.lineWidth = 1.5;
                    g.beginPath(); g.moveTo(8, 0); g.lineTo(14, -9); g.lineTo(14 + w, -9); g.lineTo(14 + w, 9); g.lineTo(14, 9); g.closePath(); g.fill(); g.stroke();
                    deEm(g, el, () => { g.fillStyle = '#085357'; fonteTxt(g, 'bold', 11); g.textBaseline = 'middle'; g.textAlign = 'center'; const m = 14 + w / 2; g.fillText(el.props.nome, el.rot === 2 ? -m : el.rot % 2 ? 0 : m, el.rot === 1 ? -m : el.rot === 3 ? m : 1); });
                });
            },
            prims() {},
            spice() { return ''; }
        };

        DEFS.texto = {
            icone: 'T', nome: 'Texto', grupo: 'ferramentas', bipolo: false, tecla: 't',
            props: { texto: 'Texto', tamanho: '14' },
            campos: [{ k: 'texto', r: 'Texto', texto: true }, { k: 'tamanho', r: 'Tamanho da letra (px)' }],
            caixa(el) { const t = parseFloat(el.props.tamanho) || 14; return [el.pos[0], el.pos[1] - t, Math.max(20, String(el.props.texto).length * t * 0.55), t * 1.3]; },
            desenhar(g, el) { const t = parseFloat(el.props.tamanho) || 14; g.fillStyle = COR_TXT; g.font = `${t}px Segoe UI, Roboto, Arial`; g.textBaseline = 'alphabetic'; g.fillText(el.props.texto, el.pos[0], el.pos[1]); },
            prims() {},
            spice(el) { return `* ${String(el.props.texto).replace(/\n/g, ' ')}`; }
        };
    }

    if (typeof module !== 'undefined' && module.exports) module.exports = registrar;
    else raiz.ComponentesExtra = registrar;
})(typeof window !== 'undefined' ? window : globalThis);
