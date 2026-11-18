# Simulador de Circuitos (Falstad + SPICE)

Simulador de circuitos que roda no navegador, em tempo real, com a usabilidade do
[simulador do Prof. Paul Falstad](https://www.falstad.com/circuit/) e modelos SPICE (`.model` e `.subckt`) nos componentes.
O código é próprio (escrito do zero), no mesmo padrão dos outros apps de Marlon Sigales (Engenharia Agrícola, CEng/UFPel ·
Inova Agro UFPel EMBRAPII).

**Usar:** https://marlonsigales.github.io/simulador-baseado-no-falstad-e-SPICE/ (GitHub Pages) ou abra `index.html` direto do disco.
HTML, CSS e JavaScript puros, sem servidor e sem bibliotecas externas.

## O que tem (v0.1)

- **Editor no estilo do Falstad:** arraste na grade para pôr componentes; cores pela tensão; pontos andando com a corrente;
  clique na chave para abrir/fechar; passe o mouse para ver tensão, corrente e potência; desfazer/refazer; zoom e arrastar a vista.
- **Atalhos do teclado do Falstad:** `w` fio, `r` resistor, `c` capacitor, `L` indutor, `s` chave, `v` fonte, `V` fonte de
  1 terminal, `g` terra, `d` diodo, `z` zener, `l` LED, `a` amp-op, `n`/`p` NPN/PNP, `N`/`P` MOSFET, `Esc`/`Espaço`
  selecionar, `Delete`, setas, `Ctrl+Z/Y/C/X/V/D/A/S/O`, `+`/`−`/`0` zoom, `/` busca; seleção por área, `Shift`+clique,
  `Alt`/botão direito para mover a vista, `Ctrl`+arrastar para esticar a ponta. Extras do app: `x` Caixa SPICE, `m` voltímetro, `Shift+R` girar.
- **Não idealidades ajustáveis** (padrão = ideal): resistências série/paralelo, ESR/ESL, fuga, DCR, Ron/Roff, resistência interna
  das fontes, Rin/Rout/GBW/slew rate/offset/polarização do amp-op e ajustes dos modelos SPICE dos semicondutores.
- **Simulação ativa em tempo real**, com velocidades programadas (tempo real, 0,1×, 0,01×, 0,001×, 0,0001×, máxima), passo de
  tempo ajustável, pausar, avançar um passo e reiniciar.
- **Osciloscópio** com até 4 traços (tensão, corrente ou potência), tempo/div, disparo, escala e posição por traço, congelar e medidas (pp, média, RMS, frequência).
- **Componentes:** fio, resistor, capacitor, indutor, chave, fonte de tensão (contínua, senoidal, quadrada), trilho +V, fonte de
  corrente, terra, diodo, zener, LED (acende com a corrente), potenciômetro, eletrolítico, chave de 2 posições, transformador,
  lâmpada, relé, amperímetro, portas lógicas, entrada/saída lógica, rótulo de nó, texto, fonte PWL, NPN, PNP, MOSFET N e P, amp-op ideal, Caixa SPICE (amp-op com o triângulo da bibliografia) e voltímetro.
- **Modelos SPICE de verdade no tempo real:** diodo (IS, N, RS, BV, IBV), BJT (IS, BF, BR, NF, NR, VAF), MOSFET nível 1
  (VTO, KP, LAMBDA) e subcircuitos com R, C, L, V, I, E, G, F, H, D, Q, M e X.
- **Biblioteca SPICE pesquisável:** abra uma pasta de modelos (lê as subpastas), arquivos soltos ou cole o texto; busca por nome,
  tipo, arquivo ou pino; botão "Usar" aplica o modelo no componente selecionado ou cria um novo.
- **Caixa SPICE:** componente sem modelo vira uma caixa com pinos nomeados; ao escolher o `.subckt`, os pinos passam a ser os do modelo.
- **Netlist SPICE (.cir)** para rodar no ngspice ou LTspice, com os modelos e subcircuitos usados.
- **Importar do Falstad:** cole o texto (File → Export As Text) ou o link do circuito; abrir este app com `?ctz=...` também importa.
- Salvar e abrir circuitos (.json); o circuito e a biblioteca ficam guardados no navegador; a pasta de modelos é lembrada (Chrome/Edge).

- **Microcontrolador** (tecla `u`): firmware em C no estilo Arduino (setup/loop, digitalWrite, analogRead, PWM, delay, printf)
  rodando junto com o tempo simulado, com editor e monitor serial; e **Arduino Uno emulado** (ATmega328P) rodando o .hex do Arduino IDE.

- **📊 Análises SPICE (ngspice no navegador):** ponto de operação (com as tensões no desenho), AC/Bode, varredura DC, transitório,
  ruído, Fourier/THD e as variações paramétrica, temperatura e Monte Carlo. O ngspice (20 MB) é baixado só na primeira análise.

## Pôr modelos na pasta do repositório

1. Copie o arquivo (`.lib`, `.mod`, `.sub`, `.cir` ou `.txt`) para `modelos/`.
2. Rode `node tests/gerar-embutidos.js` (atualiza `modelos/indice.json` e a cópia embutida).
3. Troque o `?v=` em `index.html` e publique.

Para modelos só seus, sem publicar: botão **📁 Abrir pasta de modelos** no próprio app (fica guardado no seu navegador).

## Testes

`node tests/testes.js` (56 testes: motor contra a teoria, leitor SPICE, biblioteca, Caixa SPICE, exemplos e netlist).

## Arquivos

```
index.html               página
css/style.css            identidade visual comum (Central de Aplicativos, QFD, Gestão de Projetos...)
css/simulador.css        área do simulador
js/spice.js              valores SPICE, leitura de .model/.subckt, expansão de subcircuitos
js/motor.js              motor em tempo real (MNA, trapezoidal, Newton)
js/componentes.js        catálogo de componentes (desenho, pinos, primitivos, linha SPICE)
js/componentes-extra.js  mais componentes (potenciômetro, transformador, relé, lógica...)
js/circuito.js           desenho → nós → primitivos; exportação do netlist
js/biblioteca.js         biblioteca de modelos e busca
js/editor.js             editor no canvas
js/app.js                controles, osciloscópio, propriedades, biblioteca, arquivos
js/mcu.js                microcontrolador (firmware C e Arduino Uno emulado)
js/analises.js           análises no ngspice (netlist, resultados, Fourier, Monte Carlo, gráficos)
js/analises-ui.js        janela das análises
js/importar-falstad.js   importa circuitos do Falstad (texto ou link)
js/exemplos.js           circuitos de exemplo
vendor/                  JSCPP, avr8js, eecircuit-engine/ngspice e lz-string, com as licenças
js/modelos-embutidos.js  cópia de modelos/*.lib (para abrir do disco)
modelos/                 pasta de modelos SPICE (+ indice.json)
tests/                   testes e gerador dos modelos embutidos
todoQA.txt               diretrizes, o que foi feito e QA
ARQUITETURA.md           arquitetura e próximas etapas (ngspice e microcontrolador)
```

© 2026 Marlon Sigales. Todos os direitos reservados (ver LICENSE).
