/**
 * © 2026 Simulador de Circuitos (Falstad + SPICE) — Marlon Sigales. Todos os direitos reservados; copiar, reproduzir ou alterar exige autorização do autor (ver LICENSE).
 *
 * Testes automáticos do motor, do leitor SPICE, da biblioteca e dos exemplos.   Uso: node tests/testes.js
 * Os valores esperados vêm da teoria de circuitos (com tolerância), não do próprio simulador.
 */

'use strict';

const S = require('../js/spice.js');
const { Motor } = require('../js/motor.js');
const { Biblioteca } = require('../js/biblioteca.js');
const Circuito = require('../js/circuito.js');
const Comp = require('../js/componentes.js');
const { EXEMPLOS, comIds } = require('../js/exemplos.js');
const EMB = require('../js/modelos-embutidos.js');

const TESTES = [];
const teste = (nome, f) => TESTES.push({ nome, f });
const ok = (c, msg) => { if (!c) throw new Error(msg || 'condição falsa'); };
const perto = (a, b, tol, msg) => ok(Math.abs(a - b) <= tol, `${msg || ''} esperado ${b} ± ${tol}, veio ${a}`);
const lib = () => { const L = new Biblioteca(); Object.entries(EMB).forEach(([k, t]) => L.adicionar(k, t, 'embutido')); return L; };
const rodar = (m, dt, T) => { const n = Math.round(T / dt); for (let i = 0; i < n; i++) m.passo(dt); return m; };

// ---------------------------------------------------------------- valores SPICE
teste('Valores com sufixo SPICE', () => {
    perto(S.valor('10k'), 1e4, 1e-9); perto(S.valor('2.2uF'), 2.2e-6, 1e-18); perto(S.valor('1meg'), 1e6, 1e-6);
    perto(S.valor('4m7'), 4e-3, 1e-12); perto(S.valor('100'), 100, 0); perto(S.valor('3,3n'), 3.3e-9, 1e-20);
    ok(isNaN(S.valor('abc')));
    ok(S.formatar(0.0047, 'A') === '4,7 mA', S.formatar(0.0047, 'A'));
});

teste('Leitura de .model e .subckt (linhas +, comentários, pinos nomeados)', () => {
    const r = S.lerBiblioteca(`* teste
.model DX D(IS=1n
+ N=2 RS=3)
* pinos: ENTRADA SAIDA
.subckt CX A B
R1 A B 1k ; comentário
.ends
.model QX npn IS=1f BF=200`, 't.lib');
    ok(r.modelos.length === 2, 'modelos');
    ok(r.modelos[0].params.N === 2 && r.modelos[0].params.RS === 3, 'continuação +');
    ok(r.modelos[1].tipo === 'NPN' && r.modelos[1].params.BF === 200, 'modelo sem parênteses');
    ok(r.subckts[0].pinos.join() === 'ENTRADA,SAIDA', 'nomes dos pinos pelo comentário');
    ok(r.subckts[0].suporte.ok, 'suportado');
});

teste('Subcircuito com elemento sem suporte é marcado', () => {
    const r = S.lerBiblioteca('.subckt Z A B\nB1 A B V=V(A)*2\n.ends');
    ok(!r.subckts[0].suporte.ok && r.subckts[0].suporte.falta[0] === 'elemento B');
});

// ---------------------------------------------------------------- motor
teste('Divisor resistivo: 10 V com 1k/1k dá 5 V', () => {
    const m = new Motor({ nNos: 3, prims: [
        { tipo: 'V', nome: 'V1', nos: [1, 0], fonte: { forma: 'dc', dc: 10 } },
        { tipo: 'R', nome: 'R1', nos: [1, 2], valor: 1000 }, { tipo: 'R', nome: 'R2', nos: [2, 0], valor: 1000 }] });
    m.passo(1e-6);
    perto(m.v(2), 5, 1e-6);
    perto(m.prim('V1').i, 5e-3, 1e-8, 'corrente da fonte');
});

teste('RC: após τ o capacitor tem 63,2 % da tensão', () => {
    const m = new Motor({ nNos: 3, prims: [
        { tipo: 'V', nome: 'V1', nos: [1, 0], fonte: { forma: 'dc', dc: 10 } },
        { tipo: 'R', nome: 'R1', nos: [1, 2], valor: 1000 }, { tipo: 'C', nome: 'C1', nos: [2, 0], valor: 1e-6 }] });
    rodar(m, 1e-6, 1e-3);
    perto(m.v(2), 10 * (1 - Math.exp(-1)), 0.01);
});

teste('RL: corrente chega a 63,2 % de V/R em τ = L/R', () => {
    const m = new Motor({ nNos: 3, prims: [
        { tipo: 'V', nome: 'V1', nos: [1, 0], fonte: { forma: 'dc', dc: 10 } },
        { tipo: 'R', nome: 'R1', nos: [1, 2], valor: 100 }, { tipo: 'L', nome: 'L1', nos: [2, 0], valor: 0.1 }] });
    rodar(m, 1e-6, 1e-3);
    perto(m.prim('L1').i, 0.1 * (1 - Math.exp(-1)), 0.001);
});

teste('LC: oscila na frequência 1/(2π√LC)', () => {
    const m = new Motor({ nNos: 2, prims: [
        { tipo: 'C', nome: 'C1', nos: [1, 0], valor: 1e-6 }, { tipo: 'L', nome: 'L1', nos: [1, 0], valor: 1e-3 }] }, { C1: { v: 1, i: 0 }, L1: { v: 1, i: 0 } });
    const dt = 1e-7, T = 2 * Math.PI * Math.sqrt(1e-9);
    let cruz = 0, ant = 1;
    for (let i = 0; i < Math.round(T / dt); i++) { m.passo(dt); if (ant > 0 && m.v(1) <= 0) cruz++; ant = m.v(1); }
    ok(cruz === 1, `um cruzamento descendente por período (veio ${cruz})`);
});

teste('Diodo 1N4148 com 5 V e 1 kΩ conduz com 0,6–0,75 V', () => {
    const L = lib();
    const net = Circuito.construir(comIds([
        { tipo: 'fonteV', p: [[0, 100], [0, 0]], props: { forma: 'dc', V: '5' } },
        { tipo: 'resistor', p: [[0, 0], [100, 0]], props: { R: '1k' } },
        { tipo: 'diodo', p: [[100, 0], [100, 100]], props: { modelo: '1N4148' } },
        { tipo: 'fio', p: [[100, 100], [0, 100]], props: {} },
        { tipo: 'terra', pos: [0, 100], rot: 0, props: {} }]), L);
    const m2 = rodar(new Motor(net), 1e-6, 1e-5);
    const no = net.pinos.R1[1];
    ok(m2.v(no) > 0.6 && m2.v(no) < 0.75, `Vd = ${m2.v(no)}`);
});

teste('Zener 1N4733 limita em ~5,1 V', () => {
    const L = lib();
    const m = new Motor({ nNos: 3, prims: [
        { tipo: 'V', nome: 'V1', nos: [1, 0], fonte: { forma: 'dc', dc: 12 } },
        { tipo: 'R', nome: 'R1', nos: [1, 2], valor: 470 },
        { tipo: 'D', nome: 'DZ', nos: [0, 2], modelo: L.modelo('1N4733') }] });
    rodar(m, 1e-6, 1e-5);
    perto(m.v(2), 5.1, 0.25, 'tensão zener');
});

teste('BJT 2N3904: Ic ≈ β·Ib na região ativa', () => {
    const L = lib();
    const m = new Motor({ nNos: 4, prims: [
        { tipo: 'V', nome: 'V1', nos: [1, 0], fonte: { forma: 'dc', dc: 12 } },
        { tipo: 'R', nome: 'RB', nos: [1, 2], valor: 1e6 }, { tipo: 'R', nome: 'RC', nos: [1, 3], valor: 1000 },
        { tipo: 'Q', nome: 'Q1', nos: [3, 2, 0], modelo: L.modelo('2N3904') }] });
    rodar(m, 1e-6, 1e-5);
    const q = m.prim('Q1');
    ok(m.v(2) > 0.55 && m.v(2) < 0.75, `Vbe = ${m.v(2)}`);
    const beta = q.ic / q.ib;
    ok(beta > 350 && beta < 520, `β = ${beta}`);
});

teste('PNP 2N3906 conduz com base abaixo do emissor', () => {
    const L = lib();
    const m = new Motor({ nNos: 4, prims: [
        { tipo: 'V', nome: 'V1', nos: [1, 0], fonte: { forma: 'dc', dc: 12 } },
        { tipo: 'R', nome: 'RB', nos: [2, 0], valor: 1e6 }, { tipo: 'R', nome: 'RC', nos: [3, 0], valor: 1000 },
        { tipo: 'Q', nome: 'Q1', nos: [3, 2, 1], modelo: L.modelo('2N3906') }] });
    rodar(m, 1e-6, 1e-5);
    ok(m.v(3) > 1, `Vc = ${m.v(3)}`);
});

teste('MOSFET nível 1: corrente de saturação = KP/2·(Vgs−Vt)²', () => {
    const mod = S.lerModelo('.model MN NMOS(VTO=2 KP=0.1)');
    const m = new Motor({ nNos: 4, prims: [
        { tipo: 'V', nome: 'V1', nos: [1, 0], fonte: { forma: 'dc', dc: 12 } },
        { tipo: 'V', nome: 'VG', nos: [2, 0], fonte: { forma: 'dc', dc: 3 } },
        { tipo: 'R', nome: 'RD', nos: [1, 3], valor: 100 }, { tipo: 'M', nome: 'M1', nos: [3, 2, 0], modelo: mod }] });
    m.passo(1e-6); m.passo(1e-6);
    perto(m.prim('M1').idr, 0.05, 1e-4);
    const mp = S.lerModelo('.model MP PMOS(VTO=-2 KP=0.1)');
    const m2 = new Motor({ nNos: 4, prims: [
        { tipo: 'V', nome: 'V1', nos: [1, 0], fonte: { forma: 'dc', dc: 12 } },
        { tipo: 'V', nome: 'VG', nos: [2, 0], fonte: { forma: 'dc', dc: 9 } },
        { tipo: 'R', nome: 'RD', nos: [3, 0], valor: 100 }, { tipo: 'M', nome: 'M1', nos: [3, 2, 1], modelo: mp }] });
    m2.passo(1e-6); m2.passo(1e-6);
    perto(m2.v(3), 5, 0.01, 'PMOS');
});

teste('Fontes controladas E, G, F e H', () => {
    const m = new Motor({ nNos: 7, prims: [
        { tipo: 'V', nome: 'V1', nos: [1, 0], fonte: { forma: 'dc', dc: 2 } },
        { tipo: 'E', nome: 'E1', nos: [2, 0, 1, 0], valor: 3 },                 // 6 V
        { tipo: 'G', nome: 'G1', nos: [0, 3, 1, 0], valor: 1e-3 },              // 2 mA para o nó 3
        { tipo: 'R', nome: 'R3', nos: [3, 0], valor: 1000 },                    // 2 V
        { tipo: 'V', nome: 'VS', nos: [4, 5], fonte: { forma: 'dc', dc: 0 } },  // sensor de corrente
        { tipo: 'R', nome: 'R4', nos: [1, 4], valor: 1000 }, { tipo: 'R', nome: 'R5', nos: [5, 0], valor: 1000 }, // 1 mA
        { tipo: 'H', nome: 'H1', nos: [6, 0], ref: 'VS', valor: 2000 }          // 2 V
    ] });
    m.passo(1e-6);
    perto(m.v(2), 6, 1e-6, 'E'); perto(m.v(3), 2, 1e-6, 'G'); perto(m.v(6), 2, 1e-6, 'H');
});

teste('Fonte senoidal e quadrada', () => {
    const { valorFonte } = require('../js/motor.js');
    perto(valorFonte({ forma: 'seno', amplitude: 10, freq: 50, offset: 1 }, 0.005), 11, 1e-9);
    perto(valorFonte({ forma: 'quadrada', amplitude: 5, freq: 1000, offset: 0, duty: 0.25 }, 0.0002), 5, 0);
    perto(valorFonte({ forma: 'quadrada', amplitude: 5, freq: 1000, offset: 0, duty: 0.25 }, 0.0003), -5, 0);
});

teste('Circuito sem solução dá mensagem clara', () => {
    const m = new Motor({ nNos: 2, prims: [
        { tipo: 'V', nome: 'V1', nos: [1, 0], fonte: { forma: 'dc', dc: 1 } }, { tipo: 'V', nome: 'V2', nos: [1, 0], fonte: { forma: 'dc', dc: 2 } }] });
    let msg = '';
    try { m.passo(1e-6); } catch (e) { msg = e.message; }
    ok(/sem solução/.test(msg), msg);
});

// ---------------------------------------------------------------- biblioteca e caixa
teste('Biblioteca: indexa, busca e acha pinos do subcircuito', () => {
    const L = lib();
    const t = L.totais();
    ok(t.modelos >= 10 && t.subckts >= 3, JSON.stringify(t));
    ok(L.buscar('ampop').some((x) => x.nome === 'AMPOP_GENERICO'));
    ok(L.buscar('npn').some((x) => x.nome === '2N3904'));
    ok(L.subckt('ampop_generico').pinos.join() === 'IN+,IN-,VCC,VEE,OUT', L.subckt('AMPOP_GENERICO').pinos.join());
    ok(L.buscar('vcc out').length >= 1, 'busca por pino');
    const L2 = new Biblioteca(); L2.importar(L.exportar());
    ok(L2.totais().modelos === t.modelos, 'exportar/importar');
});

teste('Caixa SPICE sem modelo: pinos pelos nomes digitados', () => {
    const el = { id: 'X1', tipo: 'caixa', pos: [0, 0], rot: 0, props: { modelo: '', pinos: 'A, B, C' } };
    const ps = Comp.pinos(el, lib());
    ok(ps.length === 3);
    const net = Circuito.construir([el], lib());
    ok(net.avisos.some((a) => /sem modelo/.test(a)));
});

teste('Amp-op da biblioteca usa o triângulo; pinos nas posições da bibliografia', () => {
    const L = lib();
    const el = { id: 'X1', tipo: 'caixa', pos: [0, 0], rot: 0, props: { modelo: 'AMPOP_GENERICO', simbolo: 'auto' } };
    const gm = Comp.DEFS.caixa.geometria(el, L);
    ok(gm.ampop, 'reconhece amp-op');
    ok(JSON.stringify(Comp.pinos(el, L)) === JSON.stringify([[-48, 16], [-48, -16], [0, -48], [0, 48], [64, 0]]), JSON.stringify(Comp.pinos(el, L)));
    el.props.simbolo = 'caixa';
    ok(!Comp.DEFS.caixa.geometria(el, L).ampop, 'opção caixa retangular');
    ok(!Comp.DEFS.caixa.geometria({ id: 'X2', tipo: 'caixa', pos: [0, 0], props: { modelo: 'REG_5V' } }, L).ampop, 'regulador continua caixa');
});

teste('Caixa SPICE: ao escolher o .subckt, os pinos vêm do modelo', () => {
    const el = { id: 'X1', tipo: 'caixa', pos: [0, 0], rot: 0, props: { modelo: 'REG_5V', pinos: 'A' } };
    ok(Comp.pinos(el, lib()).length === 3);
});


// ---------------------------------------------------------------- não idealidades (padrão ideal, ajustáveis)
const montar = (els) => { const L = lib(); const e = comIds(els); const net = Circuito.construir(e, L); return { e, net, m: new Motor(net), v: (i, k) => 0 }; };
const fonte = (V, extra = {}) => Object.assign({ tipo: 'fonteV', p: [[0, 100], [0, 0]], props: Object.assign({ forma: 'dc', V: String(V) }, extra) });
const gnd = { tipo: 'terra', pos: [0, 100], rot: 0, props: {} };

teste('Padrão de todos os componentes é ideal (0 em série, ∞ em paralelo)', () => {
    Object.entries(Comp.DEFS).forEach(([k, d]) => (d.campos || []).filter((c) => c.ni).forEach((c) => {
        const v = d.props[c.k];
        ok(c.texto ? v === '' : (Comp.num(v) === 0 || Comp.num(v) === Infinity), `${k}.${c.k} = ${v}`);
    }));
    // circuito ideal: resistor só gera 1 primitivo
    const r = montar([fonte(5), { tipo: 'resistor', p: [[0, 0], [0, 100]], props: { R: '1k' } }, gnd]);
    ok(r.net.prims.filter((p) => p.dono === 'R1').length === 1);
});

teste('Fonte com resistência interna: divisor 10 V, Rint 1 kΩ, carga 1 kΩ → 5 V', () => {
    const r = montar([fonte(10, { Rint: '1k' }), { tipo: 'resistor', p: [[0, 0], [100, 0]], props: { R: '1k' } }, { tipo: 'fio', p: [[100, 0], [100, 100]], props: {} }, { tipo: 'fio', p: [[100, 100], [0, 100]], props: {} }, gnd]);
    r.m.passo(1e-6);
    perto(r.m.v(r.net.pinos.R1[0]), 5, 0.01);
});

teste('Capacitor com ESR: degrau dá corrente inicial V/(R+ESR)', () => {
    const r = montar([fonte(10), { tipo: 'resistor', p: [[0, 0], [100, 0]], props: { R: '100' } }, { tipo: 'capacitor', p: [[100, 0], [100, 100]], props: { C: '1m', ESR: '100' } }, { tipo: 'fio', p: [[100, 100], [0, 100]], props: {} }, gnd]);
    r.m.passo(1e-7);
    const i = r.m.prim(r.net.primDe.R1).i;
    perto(i, 0.05, 0.002, 'corrente inicial');
});

teste('Capacitor com fuga: em regime fica no divisor R / Rfuga', () => {
    const r = montar([fonte(10), { tipo: 'resistor', p: [[0, 0], [100, 0]], props: { R: '1k' } }, { tipo: 'capacitor', p: [[100, 0], [100, 100]], props: { C: '1u', Rfuga: '1k' } }, { tipo: 'fio', p: [[100, 100], [0, 100]], props: {} }, gnd]);
    rodar(r.m, 1e-6, 0.02);
    perto(r.m.v(r.net.pinos.C1[0]), 5, 0.02);
});

teste('Indutor com DCR: corrente final = V/(R+DCR)', () => {
    const r = montar([fonte(10), { tipo: 'resistor', p: [[0, 0], [100, 0]], props: { R: '10' } }, { tipo: 'indutor', p: [[100, 0], [100, 100]], props: { L: '1m', DCR: '10' } }, { tipo: 'fio', p: [[100, 100], [0, 100]], props: {} }, gnd]);
    rodar(r.m, 1e-6, 0.002);
    const L1 = r.net.correnteDe.L1.reduce((a, n) => a + r.m.prim(n).i, 0);
    perto(L1, 0.5, 0.005);
});

teste('Chave com Ron e Roff ajustáveis', () => {
    const mk = (lig) => montar([fonte(10), { tipo: 'chave', p: [[0, 0], [100, 0]], props: { ligada: lig, Ron: '1k', Roff: '9k' } }, { tipo: 'resistor', p: [[100, 0], [100, 100]], props: { R: '1k' } }, { tipo: 'fio', p: [[100, 100], [0, 100]], props: {} }, gnd]);
    const a = mk(true); a.m.passo(1e-6); perto(a.m.v(a.net.pinos.R1[0]), 5, 0.01, 'fechada');
    const b = mk(false); b.m.passo(1e-6); perto(b.m.v(b.net.pinos.R1[0]), 1, 0.01, 'aberta');
});

teste('Voltímetro com resistência de entrada carrega o circuito', () => {
    const r = montar([fonte(10), { tipo: 'resistor', p: [[0, 0], [100, 0]], props: { R: '10meg' } }, { tipo: 'voltimetro', p: [[100, 100], [100, 0]], props: { Rin: '10meg' } }, { tipo: 'fio', p: [[100, 100], [0, 100]], props: {} }, gnd]);
    r.m.passo(1e-6);
    perto(r.m.v(r.net.pinos.VM1[1]), 5, 0.01);
});

teste('Diodo com ajuste RS: a queda aumenta com a resistência série', () => {
    const mk = (aj) => { const r = montar([fonte(5), { tipo: 'resistor', p: [[0, 0], [100, 0]], props: { R: '100' } }, { tipo: 'diodo', p: [[100, 0], [100, 100]], props: { modelo: '1N4148', ajustes: aj } }, { tipo: 'fio', p: [[100, 100], [0, 100]], props: {} }, gnd]); rodar(r.m, 1e-6, 1e-5); return r.m.v(r.net.pinos.R1[1]); };
    const v0 = mk(''), v1 = mk('RS=20');
    ok(v1 - v0 > 0.5, `sem RS ${v0}, com RS=20 ${v1}`);
});

function ampop(props, entrada) {
    // seguidor de tensão: saída ligada na entrada −
    const els = comIds([
        { tipo: 'ampop', pos: [100, 0], rot: 0, props: Object.assign({}, Comp.DEFS.ampop.props, props) },
        { tipo: 'fonteV', p: [[68, 100], [68, 16]], props: entrada },
        { tipo: 'fio', p: [[148, 0], [148, -40]], props: {} }, { tipo: 'fio', p: [[148, -40], [68, -40]], props: {} }, { tipo: 'fio', p: [[68, -40], [68, -16]], props: {} },
        { tipo: 'terra', pos: [68, 100], rot: 0, props: {} }]);
    const net = Circuito.construir(els, lib());
    return { m: new Motor(net), out: () => 0, net, sai: (m) => m.v(net.pinos.U1[0]) };
}

teste('Amp-op: offset aparece na saída do seguidor', () => {
    const a = ampop({ Vos: '5m' }, { forma: 'dc', V: '1' });
    rodar(a.m, 1e-6, 1e-5);
    perto(a.sai(a.m), 1.005, 1e-3);
});

teste('Amp-op: slew rate limita a subida (1 V/µs)', () => {
    const a = ampop({ SR: '1meg', GBW: '10meg' }, { forma: 'quadrada', amplitude: '5', freq: '10k', offset: '0', duty: '0.5' });
    let max = 0, ant = a.sai(a.m);
    for (let i = 0; i < 2000; i++) { a.m.passo(1e-8); const v = a.sai(a.m); max = Math.max(max, Math.abs(v - ant) / 1e-8); ant = v; }
    ok(max < 1.1e6 && max > 0.8e6, `inclinação máxima ${max} V/s`);
});

teste('Amp-op: GBW finito reduz o ganho em malha fechada em alta frequência', () => {
    // seguidor com GBW 1 MHz: a 1 MHz a saída cai para ~0,707
    const a = ampop({ GBW: '1meg' }, { forma: 'seno', amplitude: '1', freq: '1meg', offset: '0', fase: '0' });
    rodar(a.m, 5e-9, 5e-6);
    let mx = 0; for (let i = 0; i < 400; i++) { a.m.passo(5e-9); mx = Math.max(mx, a.sai(a.m)); }
    perto(mx, 0.707, 0.06);
});

teste('Netlist inclui as não idealidades', () => {
    const els = comIds([fonte(10, { Rint: '50' }), { tipo: 'capacitor', p: [[0, 0], [0, 100]], props: { C: '1u', ESR: '0.1', Rfuga: '1meg' } }, gnd,
        { tipo: 'diodo', p: [[0, 0], [100, 0]], props: { modelo: '1N4148', ajustes: 'RS=2' } }]);
    const t = Circuito.exportarSpice(els, lib());
    ok(/RV1_INT/.test(t) && /RC1_ESR/.test(t) && /RC1_FUGA/.test(t) && /\.model 1N4148_D1 D\(.*RS=2/.test(t), t);
});

// ---------------------------------------------------------------- exemplos
function simularExemplo(id, T, chaveFechada) {
    const ex = EXEMPLOS.find((e) => e.id === id);
    const els = comIds(ex.els);
    if (chaveFechada) els.filter((e) => e.tipo === 'chave').forEach((e) => { e.props.ligada = true; });
    const L = lib();
    const net = Circuito.construir(els, L);
    const m = new Motor(net);
    const v = (i, k = 1) => m.v(net.pinos[els[i].id][k]);
    return { m, net, els, v, rodar: (t) => rodar(m, ex.passo, t) };
}

teste('Exemplo RC: depois de fechar a chave, 5τ ≈ 5 V', () => {
    const s = simularExemplo('rc', 0, true);
    s.rodar(0.05);
    perto(s.v(4, 0), 5 * (1 - Math.exp(-5)), 0.05);
});

teste('Exemplo LED: corrente perto de (5 − Vf)/330', () => {
    const s = simularExemplo('led');
    s.rodar(1e-3);
    const i = s.m.prim(s.net.primDe.LED1).i;
    ok(i > 0.008 && i < 0.012, `I_LED = ${i}`);
});

teste('Exemplo retificador: saída filtrada perto do pico menos Vf', () => {
    const s = simularExemplo('retificador');
    s.rodar(0.1);
    const vc = s.v(3, 0);
    ok(vc > 7.5 && vc < 9.6, `Vc = ${vc}`);
});

teste('Exemplo emissor comum: polarização e ganho ≈ RC/RE', () => {
    const s = simularExemplo('emissor-comum');
    s.rodar(0.05);
    let max = -1e9, min = 1e9;
    for (let i = 0; i < 400; i++) { s.m.passo(5e-6); const v = s.v(14, 0); max = Math.max(max, v); min = Math.min(min, v); }
    const ganho = (max - min) / 2 / 0.02;
    ok(ganho > 3 && ganho < 5.5, `ganho = ${ganho}`); // 2,2k//10k / 470 ≈ 3,8
});

teste('Exemplo amp-op inversor (subcircuito): ganho −10', () => {
    const s = simularExemplo('ampop-inversor');
    ok(!s.net.avisos.length, s.net.avisos.join(' | '));
    s.rodar(2e-3);
    let max = -1e9, min = 1e9;
    for (let i = 0; i < 500; i++) { s.m.passo(2e-6); const v = s.v(12, 0); max = Math.max(max, v); min = Math.min(min, v); }
    perto((max - min) / 2, 10, 0.4, 'amplitude de saída');
    ok(s.m.naoConvergiu === 0, 'convergência');
});

teste('Netlist SPICE exportado traz elementos, modelos e subcircuitos', () => {
    const ex = EXEMPLOS.find((e) => e.id === 'ampop-inversor');
    const txt = Circuito.exportarSpice(comIds(ex.els), lib(), { titulo: ex.nome });
    ok(/^X1 /m.test(txt) && /\.SUBCKT AMPOP_GENERICO/i.test(txt) && /\.tran/.test(txt) && /\.end$/.test(txt), txt);
    const ex2 = EXEMPLOS.find((e) => e.id === 'emissor-comum');
    const t2 = Circuito.exportarSpice(comIds(ex2.els), lib());
    ok(/\.model 2N3904/i.test(t2), 'modelo do transistor');
});

teste('Todos os componentes do catálogo têm nome, grupo e primitivos', () => {
    Object.entries(Comp.DEFS).forEach(([k, d]) => {
        ok(d.nome && Comp.GRUPOS.some((g) => g.id === d.grupo), k);
        ok(typeof d.prims === 'function' && typeof d.spice === 'function' && typeof d.desenhar === 'function', k);
        ok(d.bipolo || typeof d.pinos === 'function', k + ' pinos');
    });
});

// ---------------------------------------------------------------- execução
let passou = 0;
TESTES.forEach((t) => {
    try { t.f(); passou++; console.log('  ok  ' + t.nome); } catch (e) { console.log('FALHOU ' + t.nome + '\n      ' + e.message); }
});
console.log(`\n${passou} de ${TESTES.length} passaram`);
if (passou !== TESTES.length) process.exitCode = 1;
