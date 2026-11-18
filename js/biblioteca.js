/**
 * © 2026 Simulador de Circuitos (Falstad + SPICE) — Marlon Sigales. Todos os direitos reservados; copiar, reproduzir ou alterar exige autorização do autor (ver LICENSE).
 *
 * Biblioteca de modelos SPICE: junta os arquivos de uma pasta (ou colados), indexa .model e .subckt e faz a busca.
 */

'use strict';

(function (raiz) {
    const S = (typeof module !== 'undefined' && module.exports) ? require('./spice.js') : raiz.Spice;
    const EXT = /\.(lib|mod|sub|cir|txt|sp|spi|spice|inc|ckt|model)$/i;

    class Biblioteca {
        constructor() { this.arquivos = {}; this.indice(); }

        /** Acrescenta (ou troca) um arquivo. Devolve quantos modelos e subcircuitos achou. */
        adicionar(arquivo, texto, origem = 'pasta') {
            const r = S.lerBiblioteca(texto, arquivo);
            this.arquivos[arquivo] = { texto, origem, ...r };
            this.indice();
            return { modelos: r.modelos.length, subckts: r.subckts.length, avisos: r.avisos };
        }
        remover(arquivo) { delete this.arquivos[arquivo]; this.indice(); }
        aceitaArquivo(nome) { return EXT.test(nome); }

        indice() {
            this._m = {}; this._s = {};
            Object.values(this.arquivos).forEach((a) => {
                a.modelos.forEach((m) => { if (!this._m[m.nome]) this._m[m.nome] = m; });
                a.subckts.forEach((s) => { if (!this._s[s.nome]) this._s[s.nome] = s; });
            });
        }
        modelo(nome) { return nome ? this._m[String(nome).toUpperCase()] || null : null; }
        subckt(nome) { return nome ? this._s[String(nome).toUpperCase()] || null : null; }
        modelosDoTipo(tipos) { return Object.values(this._m).filter((m) => tipos.includes(m.tipo)).sort((a, b) => a.nome.localeCompare(b.nome)); }
        subckts() { return Object.values(this._s).sort((a, b) => a.nome.localeCompare(b.nome)); }

        /** Busca por nome, tipo, arquivo ou pino. Cada palavra precisa aparecer. */
        buscar(q, limite = 200) {
            const termos = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
            const itens = [
                ...Object.values(this._m).map((m) => ({ classe: 'modelo', nome: m.nome, tipo: m.tipo, arquivo: m.arquivo, item: m, alvo: `${m.nome} ${m.tipo} ${m.arquivo}` })),
                ...Object.values(this._s).map((s) => ({ classe: 'subckt', nome: s.nome, tipo: 'SUBCKT', arquivo: s.arquivo, item: s, alvo: `${s.nome} subckt ${s.arquivo} ${s.pinos.join(' ')}` }))
            ];
            return itens.filter((x) => termos.every((t) => x.alvo.toLowerCase().includes(t)))
                .sort((a, b) => a.nome.localeCompare(b.nome)).slice(0, limite);
        }

        totais() { return { arquivos: Object.keys(this.arquivos).length, modelos: Object.keys(this._m).length, subckts: Object.keys(this._s).length }; }

        /** Para guardar no navegador (só os textos). */
        exportar() { const o = {}; Object.entries(this.arquivos).forEach(([k, a]) => { o[k] = { texto: a.texto, origem: a.origem }; }); return o; }
        importar(o) { Object.entries(o || {}).forEach(([k, a]) => { if (a && typeof a.texto === 'string') this.adicionar(k, a.texto, a.origem); }); }
    }

    if (typeof module !== 'undefined' && module.exports) module.exports = { Biblioteca };
    else raiz.Biblioteca = Biblioteca;
})(typeof window !== 'undefined' ? window : globalThis);
