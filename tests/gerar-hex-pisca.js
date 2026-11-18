/**
 * © 2026 Simulador de Circuitos (Falstad + SPICE) — Marlon Sigales. Todos os direitos reservados; copiar, reproduzir ou alterar exige autorização do autor (ver LICENSE).
 * Monta à mão (sem avr-gcc) um .hex de ATmega328P que pisca o D13 (PB5) a cada ~0,26 s em 16 MHz, para o exemplo do Arduino Uno.
 * Uso: node tests/gerar-hex-pisca.js  (imprime o .hex)
 */
'use strict';
const ldi = (d, k) => 0xE000 | ((k & 0xF0) << 4) | ((d - 16) << 4) | (k & 0x0F);
const out = (a, r) => 0xB800 | ((a & 0x30) << 5) | (r << 4) | (a & 0x0F);
const inp = (d, a) => 0xB000 | ((a & 0x30) << 5) | (d << 4) | (a & 0x0F);
const eor = (d, r) => 0x2400 | ((r & 0x10) << 5) | (d << 4) | (r & 0x0F);
const dec = (d) => 0x940A | (d << 4);
const brne = (k) => 0xF401 | ((k & 0x7F) << 3);
const rjmp = (k) => 0xC000 | (k & 0x0FFF);
const DDRB = 0x04, PORTB = 0x05;
const prog = [
    ldi(16, 0x20), out(DDRB, 16), ldi(17, 0x20),          // 0–2: PB5 como saída
    inp(18, PORTB), eor(18, 17), out(PORTB, 18),          // 3–5: inverte PB5
    ldi(19, 21), ldi(20, 0), ldi(21, 0),                  // 6–8: contadores do atraso
    dec(21), brne(-2), dec(20), brne(-5), dec(19), brne(-8), // 9–14: 21 × 256 × 256 voltas
    rjmp(-13)                                             // 15: volta para 3
];
function hex(words) {
    const b = [];
    words.forEach((w) => b.push(w & 0xFF, w >> 8));
    const linhas = [];
    for (let i = 0; i < b.length; i += 16) {
        const d = b.slice(i, i + 16), rec = [d.length, (i >> 8) & 0xFF, i & 0xFF, 0, ...d];
        const ck = (0x100 - (rec.reduce((a, x) => a + x, 0) & 0xFF)) & 0xFF;
        linhas.push(':' + rec.concat(ck).map((x) => x.toString(16).toUpperCase().padStart(2, '0')).join(''));
    }
    return linhas.concat(':00000001FF').join('\n');
}
const h = hex(prog);
if (require.main === module) console.log(h);
module.exports = h;
