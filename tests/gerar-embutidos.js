/**
 * © 2026 Simulador de Circuitos (Falstad + SPICE) — Marlon Sigales. Todos os direitos reservados; copiar, reproduzir ou alterar exige autorização do autor (ver LICENSE).
 * Regera js/modelos-embutidos.js e modelos/indice.json a partir de modelos/*.lib.   Uso: node tests/gerar-embutidos.js
 */
'use strict';
const fs = require('fs'), path = require('path');
const dir = path.join(__dirname, '../modelos');
const o = {};
fs.readdirSync(dir).filter((f) => /\.lib$/i.test(f)).forEach((f) => { o[f] = fs.readFileSync(path.join(dir, f), 'utf8'); });
const cab = `/**
 * © 2026 Simulador de Circuitos (Falstad + SPICE) — Marlon Sigales. Todos os direitos reservados; copiar, reproduzir ou alterar exige autorização do autor (ver LICENSE).
 *
 * Cópia embutida de modelos/*.lib (para funcionar também abrindo index.html direto do disco, sem servidor).
 * Gerado a partir dos arquivos .lib: se mudar algum .lib, rode  node tests/gerar-embutidos.js
 */
'use strict';
`;
fs.writeFileSync(path.join(__dirname, '../js/modelos-embutidos.js'), cab + 'var MODELOS_EMBUTIDOS = ' + JSON.stringify(o, null, 1) + ';\nif (typeof module !== \'undefined\' && module.exports) module.exports = MODELOS_EMBUTIDOS;\n');
fs.writeFileSync(path.join(dir, 'indice.json'), JSON.stringify({ arquivos: Object.keys(o) }, null, 1) + '\n');
console.log('modelos embutidos:', Object.keys(o).join(', '));
