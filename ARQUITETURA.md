<!-- © 2026 Simulador de Circuitos (Falstad + SPICE) — Marlon Sigales. Todos os direitos reservados; copiar, reproduzir ou alterar exige autorização do autor (ver LICENSE). -->
# Arquitetura

Tudo roda no navegador: HTML, CSS e JavaScript puros, sem servidor e sem CDN. Quando entrarem bibliotecas de terceiros
(ngspice em WebAssembly, avr8js, compilador C), elas ficam copiadas em `vendor/` com a licença de cada uma.

```
 Editor (canvas, estilo Falstad)  ──►  circuito.js  ──►  motor.js (tempo real, MNA)  ──►  cores, pontos de corrente, osciloscópio
        ▲                              │  junta pinos em nós
        │                              │  gera primitivos e expande .subckt
 Biblioteca SPICE (pasta de modelos) ──┘  exporta netlist .cir  ──►  [futuro] ngspice WASM: .op, .ac, .dc, .noise, .four, .step, Monte Carlo
```

## 1. Motor em tempo real (`js/motor.js`) — feito
- Análise nodal modificada, passo fixo, integração trapezoidal, Newton-Raphson com limitação de junção (pnjlim do SPICE).
- Primitivos: R, C, L, V, I, E, G, F, H, chave, diodo (IS, N, RS, BV, IBV), BJT (Ebers-Moll com BF, BR, NF, NR, VAF),
  MOSFET nível 1 (VTO, KP, LAMBDA, W, L), amp-op ideal com saturação.
- Ainda sem: capacitâncias de junção (CJO, CJE, CJC, TT), temperatura, BSIM, fontes B, chaves S/W, XSPICE.

## 2. Biblioteca e Caixa SPICE (`js/spice.js`, `js/biblioteca.js`) — feito
- Fontes: pasta escolhida no navegador (lê subpastas), arquivos soltos, texto colado e a pasta `modelos/` do repositório
  (listada em `modelos/indice.json`, que `node tests/gerar-embutidos.js` atualiza).
- Indexa `.model` e `.subckt` (com linhas `+`, comentários e nomes de pinos por comentário `* pinos: ...`) e busca por nome,
  tipo, arquivo ou pino.
- Caixa SPICE: sem modelo, é uma caixa com os pinos digitados; ao escolher o `.subckt`, os pinos passam a ser os do modelo,
  e o subcircuito é expandido em primitivos (inclusive subcircuitos dentro de subcircuitos).
- O que o tempo real ainda não roda (PARAMS, `{expressões}`, B, VALUE/POLY) é marcado como "parcial".

## 3. Análises SPICE completas (ngspice em WebAssembly) — a fazer
- Incluir o ngspice compilado para WebAssembly (por exemplo o pacote do eecircuit-engine, MIT) em `vendor/`, rodando num Web Worker.
- Usar o netlist que o botão "Netlist SPICE" já gera.
- Telas: ponto de operação sobre o desenho, Bode (.ac), curva DC (.dc), ruído, Fourier/THD, `.step`, temperatura e Monte Carlo.
- Os subcircuitos marcados como "parcial" passam a rodar aqui.
- Protótipo a validar: transitório interativo pelo ngspice compartilhado (`bg_halt`/`alter`/`bg_resume`).

## 4. Bloco Microcontrolador (`js/mcu.js`) — feito
Os pinos viram primitivos `PINO` no motor: saída = fonte (ideal ou com Rout), entrada = corrente zero (com pull-up opcional).
Depois de cada passo do motor, o gerente lê as tensões dos pinos, avança o firmware pelo tempo `dt` e acerta os pinos para o passo seguinte.

**Modo A — firmware em C.** Interpretado pelo JSCPP (`vendor/jscpp`, MIT) como gerador: cada `next()` é um passo do
interpretador; o bloco anda "instruções por segundo" × dt passos por passo do motor, e `delay()` só espera o tempo simulado.
HAL estilo Arduino em `microcontrolador.h` (incluído sozinho): `pinMode`, `digitalWrite`, `digitalRead`, `analogRead`,
`analogWrite` (PWM 490 Hz), `delay`, `delayMicroseconds`, `millis`, `micros`, `map`, `constrain`, `random`, `printf`.
Escolhi o interpretador em vez do clang em WebAssembly (~30 MB): abre na hora e dá o erro com a linha do código.

**Modo B — Arduino Uno.** ATmega328P emulado pelo avr8js (`vendor/avr8js`, MIT): GPIO (PORTB/C/D), timers 0/1/2, USART
(monitor serial) e ADC, com o .hex do Arduino IDE. Roda ~8 milhões de ciclos por segundo real no Node (metade do tempo real a 16 MHz).

Próximo: RP2040 (rp2040js) e compilar .ino no navegador.
