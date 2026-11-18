/**
 * © 2026 Simulador de Circuitos (Falstad + SPICE) — Marlon Sigales. Todos os direitos reservados; copiar, reproduzir ou alterar exige autorização do autor (ver LICENSE).
 *
 * Bloco Microcontrolador. Dois modos, ambos sincronizados com o tempo simulado do motor:
 *  - "mcu": firmware em C (estilo Arduino: setup/loop, pinMode, digitalWrite, analogRead, delay, millis, printf...)
 *    interpretado no navegador pelo JSCPP (vendor/jscpp, MIT). A cada passo do motor o firmware anda
 *    "instruções por segundo" × dt passos do interpretador; delay() espera o tempo simulado.
 *  - "arduino": emulação do ATmega328P (Arduino Uno) instrução por instrução com o avr8js (vendor/avr8js, MIT),
 *    rodando o .hex que o Arduino IDE exporta ("Sketch → Exportar binário compilado").
 * Os pinos viram primitivos PINO no motor: saída = fonte (com Rout), entrada = alta impedância (com pull-up opcional).
 */

'use strict';

(function (raiz) {
    const nodeJS = typeof module !== 'undefined' && module.exports;
    const C = nodeJS ? require('./componentes.js') : raiz.Componentes;
    const S = nodeJS ? require('./spice.js') : raiz.Spice;
    const vendor = (nome, arq) => {
        if (raiz[nome]) return raiz[nome];
        if (nodeJS) { require('vm').runInThisContext(require('fs').readFileSync(require('path').join(__dirname, '..', 'vendor', arq), 'utf8')); return globalThis[nome]; }
        return null;
    };

    // ------------------------------------------------------------ pinos e desenho comum
    const numeroPino = (nome) => {
        const m = String(nome).trim().toUpperCase().match(/^(D|A)?(\d+)$/);
        if (!m) return null;
        return m[1] === 'A' ? 14 + parseInt(m[2], 10) : parseInt(m[2], 10);
    };
    function geometria(nomes) {
        const esq = Math.ceil(nomes.length / 2), dir = nomes.length - esq;
        const h = (Math.max(esq, dir, 1) + 1) * 16, w = 96;
        const offs = nomes.map((_, i) => (i < esq ? [-w / 2 - 16, -h / 2 + 16 * (i + 1)] : [w / 2 + 16, -h / 2 + 16 * (i - esq + 1)]));
        return { offs, w, h };
    }
    function desenhar(g, el, info, nomes, titulo, estado) {
        const gm = geometria(nomes);
        g.save(); g.translate(el.pos[0], el.pos[1]); g.rotate((el.rot || 0) * Math.PI / 2);
        gm.offs.forEach((o, i) => { g.strokeStyle = info.cor(info.v[i]); g.lineWidth = 3; g.beginPath(); g.moveTo(o[0], o[1]); g.lineTo(o[0] < 0 ? -gm.w / 2 : gm.w / 2, o[1]); g.stroke(); });
        g.fillStyle = '#123c3e'; g.strokeStyle = '#085357'; g.lineWidth = 2;
        g.fillRect(-gm.w / 2, -gm.h / 2, gm.w, gm.h); g.strokeRect(-gm.w / 2, -gm.h / 2, gm.w, gm.h);
        g.font = '10px Consolas, monospace'; g.textBaseline = 'middle'; g.fillStyle = '#e8f3ef';
        gm.offs.forEach((o, i) => { g.textAlign = o[0] < 0 ? 'left' : 'right'; g.fillText(nomes[i], o[0] < 0 ? -gm.w / 2 + 4 : gm.w / 2 - 4, o[1]); });
        g.textAlign = 'center'; g.font = 'bold 11px Segoe UI, Roboto, Arial'; g.fillStyle = '#a8e156';
        g.fillText(titulo, 0, -gm.h / 2 - 8);
        g.font = '9px Segoe UI, Roboto, Arial'; g.fillStyle = estado && estado.erro ? '#ff8a80' : '#a8e156';
        g.fillText(estado ? (estado.erro ? 'erro' : estado.fim ? 'parado' : 'rodando') : '', 0, gm.h / 2 + 9);
        g.restore();
    }
    function primsPinos(el, n, ctx, nomes) {
        const rout = C.num(el.props.Rout);
        nomes.forEach((nome, i) => {
            ctx.add({ tipo: 'PINO', nos: [n[i], 0], modo: 'entrada', valor: 0, vdd: S.valor(el.props.VDD) || 5, rout: rout > 0 && isFinite(rout) ? rout : 0, rpu: S.valor(el.props.Rpu) || 35e3 }, { papel: 'pino' + numeroPino(nome) });
        });
    }

    // ------------------------------------------------------------ firmware em C (JSCPP)
    const FIRMWARE_PADRAO = `// Firmware de exemplo (C, no estilo Arduino).
// Pisca o pino 13 e a velocidade depende da tensão em A0 (ligue um potenciômetro).

void setup() {
  pinMode(13, OUTPUT);
  printf("Firmware iniciado\\n");
}

void loop() {
  int leitura = analogRead(A0);          // 0 a 1023 (0 V a VDD)
  digitalWrite(13, HIGH);
  delay(100 + leitura / 4);
  digitalWrite(13, LOW);
  delay(100 + leitura / 4);
}
`;
    const CABECALHO = `#include <microcontrolador.h>
#include <stdio.h>
#include <stdlib.h>
#include <math.h>
#define HIGH 1
#define LOW 0
#define INPUT 0
#define OUTPUT 1
#define INPUT_PULLUP 2
#define A0 14
#define A1 15
#define A2 16
#define A3 17
#define A4 18
#define A5 19
#define LED_BUILTIN 13
`;
    const LINHAS_CAB = CABECALHO.split('\n').length - 1;

    class FirmwareC {
        constructor(codigo, opcoes) {
            this.codigo = codigo;
            this.op = opcoes; // { vdd, ips }
            this.serial = '';
            this.pinos = {};   // número → { modo, alto, pwm }
            this.t = 0; this.ate = 0; this.orcamento = 0;
            this.erro = ''; this.fim = false;
            this.lerTensao = () => 0;
            try { this.compilar(); } catch (e) { this.erro = this.ajustarLinha(e.message); }
        }
        /** Mensagem curta em português, com a linha do código do usuário (sem o cabeçalho que o app põe antes). */
        ajustarLinha(msg) {
            msg = String(msg);
            const lc = msg.match(/line (\d+) \(column (\d+)\)/i), achou = msg.match(/but (.+?) found/);
            if (lc) {
                const l = Math.max(1, lc[1] - LINHAS_CAB);
                return `Erro de sintaxe na linha ${l}, coluna ${lc[2]}${achou ? `: não esperava ${achou[1]} ali` : ''}.`;
            }
            const rt = msg.match(/^(\d+):(\d+) (.*)/s);
            if (rt) {
                const txt = rt[3].replace(/variable (\S+) does not exist/, '"$1" não existe (variável ou função não declarada)')
                    .replace(/No matching function/i, 'nenhuma função com esses parâmetros').split('\n')[0];
                return `Erro na linha ${Math.max(1, rt[1] - LINHAS_CAB)}, coluna ${rt[2]}: ${txt}`;
            }
            return msg.replace(/line (\d+)/gi, (m, l) => `linha ${Math.max(1, l - LINHAS_CAB)}`).replace(/^ERROR: /, '').split('\n')[0];
        }
        pino(p) { if (!this.pinos[p]) this.pinos[p] = { modo: 'entrada', alto: false, pwm: null }; return this.pinos[p]; }
        compilar() {
            const L = vendor('JSCPPLib', 'jscpp/jscpp.min.js');
            if (!L) throw new Error('Interpretador C (vendor/jscpp) não carregou');
            const eu = this;
            const hal = {
                load(rt) {
                    const I = rt.intTypeLiteral, V = rt.voidTypeLiteral, D = rt.doubleTypeLiteral, g = 'global';
                    const an = (p) => (p < 14 ? p + 14 : p); // analogRead(0) = A0, como no Arduino
                    rt.regFunc((rt, _t, p, m) => { const q = eu.pino(p.v); q.modo = m.v === 1 ? 'saida' : m.v === 2 ? 'pullup' : 'entrada'; q.pwm = null; }, g, 'pinMode', [I, I], V);
                    rt.regFunc((rt, _t, p, v) => { const q = eu.pino(p.v); q.pwm = null; if (q.modo === 'saida') q.alto = !!v.v; else q.modo = v.v ? 'pullup' : 'entrada'; }, g, 'digitalWrite', [I, I], V);
                    rt.regFunc((rt, _t, p) => rt.val(I, eu.lerTensao(p.v) > eu.op.vdd / 2 ? 1 : 0), g, 'digitalRead', [I], I);
                    rt.regFunc((rt, _t, p) => rt.val(I, Math.max(0, Math.min(1023, Math.round(eu.lerTensao(an(p.v)) / eu.op.vdd * 1023)))), g, 'analogRead', [I], I);
                    rt.regFunc((rt, _t, p, v) => { const q = eu.pino(p.v); q.modo = 'saida'; q.pwm = Math.max(0, Math.min(255, v.v)) / 255; }, g, 'analogWrite', [I, I], V);
                    rt.regFunc((rt, _t, ms) => { eu.ate = eu.t + Math.max(0, ms.v) * 1e-3; }, g, 'delay', [I], V);
                    rt.regFunc((rt, _t, us) => { eu.ate = eu.t + Math.max(0, us.v) * 1e-6; }, g, 'delayMicroseconds', [I], V);
                    rt.regFunc((rt) => rt.val(I, Math.floor(eu.t * 1e3) | 0), g, 'millis', [], I);
                    rt.regFunc((rt) => rt.val(I, Math.floor(eu.t * 1e6) | 0), g, 'micros', [], I);
                    rt.regFunc((rt, _t, x, a, b, c, d) => rt.val(I, Math.trunc((x.v - a.v) * (d.v - c.v) / (b.v - a.v) + c.v)), g, 'map', [I, I, I, I, I], I);
                    rt.regFunc((rt, _t, x, a, b) => rt.val(I, Math.max(a.v, Math.min(b.v, x.v))), g, 'constrain', [I, I, I], I);
                    rt.regFunc((rt, _t, a, b) => rt.val(I, a.v + Math.floor(Math.random() * (b.v - a.v))), g, 'random', [I, I], I);
                    rt.regFunc((rt) => rt.val(D, eu.t), g, 'tempo', [], D); // tempo simulado em segundos (extra)
                }
            };
            const config = {
                stdio: { drain: () => '', write: (s) => { eu.serial = (eu.serial + s).slice(-8000); } },
                includes: Object.assign({}, L.includes, { 'microcontrolador.h': hal, 'stdio.h': L.includes.cstdio, 'stdlib.h': L.includes.cstdlib, 'math.h': L.includes.cmath }),
                unsigned_overflow: 'warn'
            };
            const rt = new L.CRuntime(config);
            let fonte = CABECALHO + this.codigo;
            if (!/\bint\s+main\s*\(/.test(this.codigo)) fonte += '\nint main() { setup(); while (1) { loop(); } return 0; }\n';
            fonte = L.preprocessor.parse(rt, fonte);
            const res = L.PEGUtil.parse(L.ast, fonte);
            if (res.error) throw new Error(L.PEGUtil.errorMessage(res.error, true));
            const it = new L.Interpreter(rt);
            const gen = it.run(res.ast, fonte);
            while (!gen.next().done);
            this.main = rt.getFunc('global', 'main', [])(rt, null);
        }
        /** Roda o firmware até o tempo t (chamado depois de cada passo do motor). */
        avancar(t, dt) {
            this.t = t;
            if (this.erro || this.fim || !this.main) return;
            this.orcamento = Math.min(this.orcamento + this.op.ips * dt, 200000);
            try {
                while (this.orcamento >= 1 && this.t >= this.ate) {
                    this.orcamento--;
                    if (this.main.next().done) { this.fim = true; break; }
                }
                if (this.t < this.ate) this.orcamento = 0; // dormindo no delay(): não acumula
            } catch (e) { this.erro = this.ajustarLinha(e.message); }
        }
        /** Estado elétrico de um pino: { modo, alto } (PWM a 490 Hz como o Arduino). */
        saida(num, t) {
            const q = this.pinos[num];
            if (!q) return { modo: 'entrada', alto: false };
            if (q.pwm !== null && q.modo === 'saida') return { modo: 'saida', alto: ((t * 490) % 1) < q.pwm };
            return { modo: q.modo, alto: q.alto };
        }
    }

    // ------------------------------------------------------------ ATmega328P (avr8js)
    function lerHex(txt) {
        const prog = new Uint8Array(0x8000);
        let base = 0, achou = false;
        String(txt).split(/\r?\n/).forEach((l) => {
            l = l.trim();
            if (!l.startsWith(':')) return;
            const b = l.slice(1).match(/../g).map((x) => parseInt(x, 16));
            const n = b[0], end = (b[1] << 8) | b[2], tipo = b[3];
            if (tipo === 0) { for (let i = 0; i < n; i++) if (base + end + i < prog.length) prog[base + end + i] = b[4 + i]; achou = true; }
            else if (tipo === 2) base = ((b[4] << 8) | b[5]) << 4;
            else if (tipo === 4) base = ((b[4] << 8) | b[5]) << 16;
        });
        if (!achou) throw new Error('Arquivo .hex vazio ou inválido');
        return new Uint16Array(prog.buffer);
    }

    class Atmega328 {
        constructor(hex, opcoes) {
            this.op = opcoes; // { vdd, clock }
            this.serial = ''; this.erro = ''; this.fim = false; this.t = 0;
            this.lerTensao = () => 0;
            try {
                const A = vendor('AVR8', 'avr8js/avr8js.min.js');
                if (!A) throw new Error('Emulador AVR (vendor/avr8js) não carregou');
                this.A = A;
                this.cpu = new A.CPU(lerHex(hex));
                this.timers = [new A.AVRTimer(this.cpu, A.timer0Config), new A.AVRTimer(this.cpu, A.timer1Config), new A.AVRTimer(this.cpu, A.timer2Config)];
                this.portas = { B: new A.AVRIOPort(this.cpu, A.portBConfig), C: new A.AVRIOPort(this.cpu, A.portCConfig), D: new A.AVRIOPort(this.cpu, A.portDConfig) };
                this.usart = new A.AVRUSART(this.cpu, A.usart0Config, this.op.clock);
                this.usart.onByteTransmit = (b) => { this.serial = (this.serial + String.fromCharCode(b)).slice(-8000); };
                this.adc = new A.AVRADC(this.cpu, A.adcConfig);
                this.adc.avcc = this.op.vdd;
            } catch (e) { this.erro = e.message; }
        }
        /** D0–D7 = PORTD, D8–D13 = PORTB, A0–A5 (14–19) = PORTC. */
        porta(num) { return num < 8 ? ['D', num] : num < 14 ? ['B', num - 8] : num < 20 ? ['C', num - 14] : null; }
        avancar(t, dt) {
            this.t = t;
            if (this.erro) return;
            // entradas: nível digital e tensão do ADC
            for (let num = 0; num < 20; num++) {
                const [p, bit] = this.porta(num), v = this.lerTensao(num);
                this.portas[p].setPin(bit, v > this.op.vdd / 2);
                if (num >= 14) this.adc.channelValues[num - 14] = v;
            }
            const alvo = this.cpu.cycles + Math.round(dt * this.op.clock);
            try {
                while (this.cpu.cycles < alvo) { this.A.avrInstruction(this.cpu); this.cpu.tick(); }
            } catch (e) { this.erro = e.message; }
        }
        saida(num) {
            const pp = this.porta(num);
            if (!pp) return { modo: 'entrada', alto: false };
            const s = this.portas[pp[0]].pinState(pp[1]);
            // PinState: 0 Low, 1 High, 2 Input, 3 InputPullUp
            return s === 0 ? { modo: 'saida', alto: false } : s === 1 ? { modo: 'saida', alto: true } : { modo: s === 3 ? 'pullup' : 'entrada', alto: false };
        }
    }

    // ------------------------------------------------------------ componentes
    const NOMES_UNO = ['D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9', 'D10', 'D11', 'D12', 'D13', 'A0', 'A1', 'A2', 'A3', 'A4', 'A5'];
    const nomesMCU = (el) => String(el.props.pinos || '').split(',').map((x) => x.trim()).filter((x) => numeroPino(x) !== null);
    const CAMPOS_ELETRICOS = [
        { k: 'VDD', r: 'Alimentação (VDD)', u: 'V' },
        C.DEFS.resistor ? { k: 'Rout', r: 'Resistência de saída dos pinos', u: 'Ω', ni: true, dica: '0 = ideal; ATmega328P ≈ 25 Ω' } : null,
        { k: 'Rpu', r: 'Pull-up interno (INPUT_PULLUP)', u: 'Ω' }
    ].filter(Boolean);

    C.GRUPOS.splice(C.GRUPOS.findIndex((x) => x.id === 'instrumentos'), 0, { id: 'microcontrolador', nome: 'Microcontrolador' });

    C.DEFS.mcu = {
        icone: 'μ', nome: 'Microcontrolador (firmware em C)', curto: 'Microcontrolador (C)', grupo: 'microcontrolador', bipolo: false, tecla: 'u',
        props: { firmware: FIRMWARE_PADRAO, pinos: 'D2, D3, D4, D5, D6, D7, D8, D9, D10, D11, D12, D13, A0, A1, A2, A3, A4, A5', VDD: '5', ips: '1meg', Rout: '0', Rpu: '35k' },
        campos: [{ k: 'firmware', r: 'Firmware (C)', tipo: 'firmware' }, { k: 'pinos', r: 'Pinos (D0–D13, A0–A5, separados por vírgula)', texto: true },
            { k: 'ips', r: 'Velocidade: passos do interpretador por segundo simulado' }].concat(CAMPOS_ELETRICOS),
        nomesPinosDe: (el) => nomesMCU(el),
        pinos: (el) => { const gm = geometria(nomesMCU(el)); return gm.offs.map((o) => { const [dx, dy] = C.girar(o, el.rot || 0); return [el.pos[0] + dx, el.pos[1] + dy]; }); },
        caixa: (el) => { const gm = geometria(nomesMCU(el)); return C.caixaGirada(el, -gm.w / 2 - 16, -gm.h / 2 - 16, gm.w + 32, gm.h + 32); },
        desenhar(g, el, info) { desenhar(g, el, info, nomesMCU(el), 'μC · firmware C', info.mcu); },
        prims(el, n, ctx) { primsPinos(el, n, ctx, nomesMCU(el)); },
        spice(el) { return `* ${el.id}: microcontrolador (firmware não vai para o netlist)`; },
        criarExecucao: (el) => new FirmwareC(el.props.firmware, { vdd: S.valor(el.props.VDD) || 5, ips: S.valor(el.props.ips) || 1e6 }),
        chaveExecucao: (el) => `${el.props.firmware}|${el.props.ips}|${el.props.VDD}`
    };

    C.DEFS.arduino = {
        icone: '∞', nome: 'Arduino Uno (ATmega328P, roda o .hex)', curto: 'Arduino Uno (.hex)', grupo: 'microcontrolador', bipolo: false,
        props: { hex: '', nomeHex: '', VDD: '5', clock: '16meg', Rout: '0', Rpu: '35k' },
        campos: [{ k: 'hex', r: 'Programa (.hex do Arduino IDE)', tipo: 'hex' }, { k: 'clock', r: 'Clock', u: 'Hz' }].concat(CAMPOS_ELETRICOS),
        nomesPinosDe: () => NOMES_UNO,
        pinos: (el) => geometria(NOMES_UNO).offs.map((o) => { const [dx, dy] = C.girar(o, el.rot || 0); return [el.pos[0] + dx, el.pos[1] + dy]; }),
        caixa: (el) => { const gm = geometria(NOMES_UNO); return C.caixaGirada(el, -gm.w / 2 - 16, -gm.h / 2 - 16, gm.w + 32, gm.h + 32); },
        desenhar(g, el, info) { desenhar(g, el, info, NOMES_UNO, 'Arduino Uno · ' + (el.props.nomeHex || 'sem .hex'), info.mcu); },
        prims(el, n, ctx) { primsPinos(el, n, ctx, NOMES_UNO); },
        spice(el) { return `* ${el.id}: Arduino Uno emulado (firmware não vai para o netlist)`; },
        criarExecucao: (el) => (el.props.hex ? new Atmega328(el.props.hex, { vdd: S.valor(el.props.VDD) || 5, clock: S.valor(el.props.clock) || 16e6 }) : null),
        chaveExecucao: (el) => `${el.props.hex.length}|${el.props.hex.slice(0, 200)}|${el.props.hex.slice(-200)}|${el.props.clock}|${el.props.VDD}`
    };

    /**
     * Gerencia as execuções (uma por bloco) e liga com o motor:
     * depois de cada passo, lê as tensões dos pinos, avança o firmware e acerta os PINOs para o passo seguinte.
     */
    class Gerente {
        constructor() { this.exec = {}; }
        reiniciar() { this.exec = {}; }
        sincronizar(els) {
            const vivos = new Set();
            els.forEach((el) => {
                const d = C.DEFS[el.tipo];
                if (!d || !d.criarExecucao) return;
                vivos.add(el.id);
                const ch = d.chaveExecucao(el);
                if (!this.exec[el.id] || this.exec[el.id].chave !== ch) this.exec[el.id] = { chave: ch, x: d.criarExecucao(el) };
            });
            Object.keys(this.exec).forEach((id) => { if (!vivos.has(id)) delete this.exec[id]; });
        }
        /** Chamado pelo motor depois de cada passo. net = netlist (papéis dos pinos). */
        passo(m, net, dt) {
            Object.entries(this.exec).forEach(([id, ex]) => {
                const x = ex.x;
                if (!x) return;
                const pap = (net.papeis && net.papeis[id]) || {};
                x.lerTensao = (num) => { const p = pap['pino' + num] && m.prim(pap['pino' + num]); return p ? m.v(p.nos[0]) : 0; };
                x.avancar(m.t, dt);
                Object.entries(pap).forEach(([papel, nome]) => {
                    if (!papel.startsWith('pino')) return;
                    const p = m.prim(nome), s = x.saida(parseInt(papel.slice(4), 10), m.t);
                    if (p) { p.modo = s.modo; p.valor = s.alto ? p.vdd : 0; }
                });
            });
        }
        estado(id) { const ex = this.exec[id]; return ex && ex.x ? { erro: ex.x.erro, fim: ex.x.fim, serial: ex.x.serial } : null; }
    }

    // .hex de exemplo (pisca D13 a cada ~0,26 s), montado por tests/gerar-hex-pisca.js
    const HEX_PISCA = ':1000000000E204B910E225B1212725B935E140E02D\n:1000100050E05A95F1F74A95D9F73A95C1F7F3CFE1\n:00000001FF';

    const API = { FirmwareC, Atmega328, Gerente, lerHex, numeroPino, FIRMWARE_PADRAO, NOMES_UNO, HEX_PISCA };
    if (nodeJS) module.exports = API;
    else raiz.MCU = API;
})(typeof window !== 'undefined' ? window : globalThis);
