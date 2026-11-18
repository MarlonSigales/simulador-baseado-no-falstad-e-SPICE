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

## 4. Bloco Microcontrolador (firmware em C) — a fazer
Bloco com pinos (GPIO, ADC, PWM, UART, VCC, GND) ligado ao circuito. A cada passo do motor:
- pino de saída = fonte de tensão com resistência de saída (VOH/VOL);
- pino de entrada = alta impedância, lido com limiares VIH/VIL (digital) ou pelo ADC (analógico, com Vref e resolução).

O firmware avança em sincronia com o tempo simulado (passo do motor = quantum do microcontrolador). Dois modos:

**A. C nativo (recomendado para começar e para as aulas).** O código C do aluno é compilado no próprio navegador para
WebAssembly (clang/LLVM em WebAssembly, carregado só quando o bloco é usado, de `vendor/`), junto com uma HAL simples:
`pinMode`, `digitalWrite`, `digitalRead`, `analogRead`, `analogWrite` (PWM), `millis`, `micros`, `delay`, `delayMicroseconds`,
`uart_print` e interrupções por pino e por timer. O firmware roda num Web Worker:
`delay()` devolve o controle ao simulador até o tempo simulado chegar lá (Asyncify ou SharedArrayBuffer + Atomics; no GitHub
Pages o SharedArrayBuffer exige os cabeçalhos COOP/COEP, que um service worker resolve).
Velocidade nativa, qualquer C, sem depender de um chip específico.

**B. Emulação do chip (para firmware real).** Roda o `.hex`/`.elf` gerado pelo Arduino IDE ou avr-gcc, instrução por
instrução, com os periféricos do chip: ATmega328P (Arduino Uno) com o avr8js (MIT) e RP2040 com o rp2040js (MIT).
Precisão de ciclo; o arquivo compilado é enviado pelo usuário (compilar no navegador fica para depois).

Etapas: (1) bloco com pinos e HAL escrita em JS para testar a ponte com o motor; (2) modo A com clang em WebAssembly;
(3) modo B com avr8js; (4) monitor serial e osciloscópio dos pinos.
