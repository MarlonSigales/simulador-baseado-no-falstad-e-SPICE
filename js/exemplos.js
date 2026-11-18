/**
 * © 2026 Simulador de Circuitos (Falstad + SPICE) — Marlon Sigales. Todos os direitos reservados; copiar, reproduzir ou alterar exige autorização do autor (ver LICENSE).
 *
 * Circuitos de exemplo. b() = bipolo (de p0 para p1), u() = componente com posição e giro (0–3).
 */

'use strict';

(function (raiz) {
    const b = (tipo, x1, y1, x2, y2, props = {}) => ({ tipo, p: [[x1, y1], [x2, y2]], props });
    const u = (tipo, x, y, rot = 0, props = {}) => ({ tipo, pos: [x, y], rot, props });

    const EXEMPLOS = [
        {
            id: 'rc', nome: 'Carga de capacitor (RC) com chave',
            dica: 'Clique na chave para fechar e veja o capacitor carregar com τ = RC = 10 ms.',
            passo: 20e-6, osc: [{ el: 5, g: 'V' }],
            els: [
                b('fonteV', 96, 256, 96, 128, { forma: 'dc', V: '5' }),
                b('fio', 96, 128, 192, 128),
                b('chave', 192, 128, 288, 128, { ligada: false }),
                b('resistor', 288, 128, 384, 128, { R: '1k' }),
                b('capacitor', 384, 128, 384, 256, { C: '10u' }),
                b('voltimetro', 496, 256, 496, 128),
                b('fio', 384, 128, 496, 128),
                b('fio', 384, 256, 496, 256),
                b('fio', 384, 256, 96, 256),
                u('terra', 96, 256)
            ]
        },
        {
            id: 'retificador', nome: 'Retificador de meia onda com filtro (1N4007)',
            dica: 'Fonte senoidal de 10 V/60 Hz; o capacitor segura a tensão entre os picos (ondulação).',
            passo: 20e-6, osc: [{ el: 0, g: 'V' }, { el: 3, g: 'V' }],
            els: [
                b('fonteV', 96, 256, 96, 128, { forma: 'seno', V: '5', amplitude: '10', freq: '60', offset: '0', fase: '0', duty: '0.5' }),
                b('diodo', 96, 128, 224, 128, { modelo: '1N4007' }),
                b('fio', 224, 128, 320, 128),
                b('capacitor', 320, 128, 320, 256, { C: '100u' }),
                b('fio', 320, 128, 416, 128),
                b('resistor', 416, 128, 416, 256, { R: '1k' }),
                b('fio', 320, 256, 416, 256),
                b('fio', 320, 256, 96, 256),
                u('terra', 96, 256)
            ]
        },
        {
            id: 'led', nome: 'LED com resistor e chave',
            dica: 'Feche a chave: o LED acende com cerca de 10 mA. Troque o modelo para LED_AZUL e compare a tensão.',
            passo: 20e-6, osc: [{ el: 3, g: 'I' }],
            els: [
                u('trilho', 80, 128, 0, { forma: 'dc', V: '5' }),
                b('chave', 80, 128, 160, 128, { ligada: true }),
                b('resistor', 160, 128, 256, 128, { R: '330' }),
                b('led', 256, 128, 256, 240, { modelo: 'LED_VERMELHO', cor: 'vermelho' }),
                u('terra', 256, 240)
            ]
        },
        {
            id: 'emissor-comum', nome: 'Amplificador emissor comum (2N3904)',
            dica: 'Entrada de 20 mV a 1 kHz; compare a entrada e a saída no osciloscópio (ganho ≈ RC/RE).',
            passo: 5e-6, osc: [{ el: 9, g: 'V' }, { el: 14, g: 'V' }],
            els: [
                u('trilho', 320, 64, 0, { forma: 'dc', V: '12' }),
                b('resistor', 320, 64, 320, 160, { R: '2.2k' }),
                u('npn', 304, 192, 0, { modelo: '2N3904' }),
                b('resistor', 320, 224, 320, 320, { R: '470' }),
                u('terra', 320, 320),
                u('trilho', 176, 64, 0, { forma: 'dc', V: '12' }),
                b('resistor', 176, 64, 176, 192, { R: '47k' }),
                b('resistor', 176, 192, 176, 320, { R: '10k' }),
                u('terra', 176, 320),
                b('fonteV', 64, 320, 64, 192, { forma: 'seno', V: '0', amplitude: '0.02', freq: '1k', offset: '0', fase: '0', duty: '0.5' }),
                b('capacitor', 64, 192, 176, 192, { C: '10u' }),
                b('fio', 176, 192, 272, 192),
                u('terra', 64, 320),
                b('capacitor', 320, 160, 432, 160, { C: '10u' }),
                b('resistor', 432, 160, 432, 320, { R: '10k' }),
                u('terra', 432, 320)
            ]
        },
        {
            id: 'ampop-inversor', nome: 'Amp-op inversor com modelo SPICE (subcircuito)',
            dica: 'A caixa usa o .subckt AMPOP_GENERICO da biblioteca. Ganho = −Rf/Rin = −10.',
            passo: 2e-6, osc: [{ el: 12, g: 'V' }, { el: 13, g: 'V' }],
            els: [
                u('caixa', 320, 192, 0, { modelo: 'AMPOP_GENERICO', pinos: '', titulo: '' }),
                b('fio', 248, 224, 248, 272),
                u('trilho', 248, 272, 2, { forma: 'dc', V: '15' }),
                b('fio', 392, 160, 392, 112),
                u('trilho', 392, 112, 0, { forma: 'dc', V: '-15' }),
                b('fio', 248, 160, 232, 160),
                u('terra', 232, 160),
                b('resistor', 104, 192, 200, 192, { R: '1k' }),
                b('fio', 200, 192, 248, 192),
                b('fio', 200, 192, 200, 48),
                b('resistor', 200, 48, 456, 48, { R: '10k' }),
                b('fio', 456, 48, 456, 192),
                b('fonteV', 104, 288, 104, 192, { forma: 'seno', V: '0', amplitude: '1', freq: '1k', offset: '0', fase: '0', duty: '0.5' }),
                b('resistor', 456, 192, 456, 288, { R: '10k' }),
                b('fio', 392, 192, 456, 192),
                u('terra', 104, 288),
                u('terra', 456, 288)
            ]
        }
    ];

    /** Dá ids no estilo do SPICE (R1, C1, ...) a uma lista de elementos sem id. */
    function comIds(els) {
        const cont = {};
        const letra = { fio: 'W', resistor: 'R', capacitor: 'C', indutor: 'L', chave: 'S', fonteV: 'V', trilho: 'V', fonteI: 'I', terra: 'GND', diodo: 'D', led: 'LED', npn: 'Q', pnp: 'Q', nmos: 'M', pmos: 'M', ampop: 'U', caixa: 'X', voltimetro: 'VM' };
        return els.map((e) => {
            const l = letra[e.tipo] || 'E';
            cont[l] = (cont[l] || 0) + 1;
            return Object.assign(JSON.parse(JSON.stringify(e)), { id: e.id || l + cont[l] });
        });
    }

    const API = { EXEMPLOS, comIds };
    if (typeof module !== 'undefined' && module.exports) module.exports = API;
    else raiz.Exemplos = API;
})(typeof window !== 'undefined' ? window : globalThis);
