# ✦ DeferPay Escrow (Solana App)

O **DeferPay Escrow** é um aplicativo distribuído (DApp) na blockchain da Solana operando sob o modelo de **Pagamento com Retenção (Timelock/Escrow Unilateral)**. 

Criado com Next.js (Interface Gráfica) e Rust/Anchor (Contratos Inteligentes), este sistema visa extinguir o risco de calote ou de insatisfação num acordo financeiro B2B ou B2C, segurando fundos on-chain de forma que eles sejam liberados apenas mediante "Aprovação Mútua".

---

## 💡 Como Funciona (A Lógica Central)

Diferente de um Escrow tradicional de Crypto (onde dois usuários trocam Token X pelo Token Y), o DeferPay opera de forma **Unilateral com Dupla Assinatura**. 

1. O **Remetente** deposita "Tokens X" no cofre virtual (Vault) do Programa em nome do **Destinatário**.
2. Ninguém toca nos tokens temporariamente.
3. Ambos devem clicar em **Aprovar**. O programa confere as assinaturas digitais de ambos antes de destravar o Vault e entregar as moedas ao Destinatário.

Isso é ideal para o mercado de **Freelancers, Prestadores de Serviço e Compras de Ativos Digitais**: o Cliente prova que tem o dinheiro (ele fica trancado), o Freelancer executa a tarefa seguro de que o dinheiro existe, e ambos assinam para finalizar o acordo.

---

## 🌊 Fluxos de Pagamento Possíveis

O DApp abriga 2 possíveis ramificações de liquidação da transação, dependendo da atitude das Contra-partes:

### Fluxo 1: Caminho Feliz (Conclusão do Serviço)
- **Passo 1 (Lock):** O **Cliente (Remetente)** preenche a carteira do Prestador e envia 1.000 USDC. Os fundos dão saída de sua carteira e param no Smart Contract.
- **Passo 2 (Wait):** O **Prestador (Destinatário)** acessa o painel, vê que 1.000 USDC estão reservados no seu nome. Ele faz o trabalho combinado.
- **Passo 3 (Approve 1):** O Prestador entrega o trabalho e aperta "Aprovar" na interface. A flag do Destinatário vira "✅". O dinheiro ainda **não** é liberado.
- **Passo 4 (Approve 2):** O Cliente confere o trabalho. Gosta do resultado e também aperta "Aprovar". 
- **Conclusão:** O Smart Contract atinge o consenso duplo (True/True). Ele expulsa automaticamente os 1.000 USDC do Vault para a carteira do Destinatário, deleta o Vault para reembolsar os custos do aluguel computacional (Rent Exemption) e finda o processo.

### Fluxo 2: Estorno e Segurança (Refund Mechanism)
E se o Prestador sumir? E se cancelarem o serviço amigavelmente? 

- **Passo 1 (Lock):** O Cliente enviou 1.000 USDC.
- **Passo 2 (Abandono/Cancelamento):** O acordo não se consolida.
- **Passo 3 (Verificação do Timelock):** A Blockchain marca o momento do depósito. Apenas quando o limiar de segurança de **Securitização (Ex: 1 minuto na Devnet / 2 semanas na Mainnet)** for ultrapassado, o botão vermelho fica disponível.
- **Passo 4 (Retrieval):** O **Cliente (Remetente)** aperta "Recuperar (Refund)". O Smart Contract valida na rede se o prazo realmente acabou. Estando dentro da regra, ele ejeta os 1.000 USDC do cofre de volta para o cliente, anulando qualquer chance do destinatário aprovar futuramente.

> *Nota de Arquitetura:* O sistema não permite roubos cruzados. Nenhum receiver pode sacar sem o aval do sender e vice-versa, enquanto a regra do Tempo aniquila problemas judiciais de "dinheiro congelado para sempre no limbo web3".

---

## 🔧 Tokens Suportados (Agnóstico)
Você não está travado em apenas um tipo de dinheiro. O DApp detecta instantaneamente as casas decimais de qualquer Token Solana colado no formulário graças ao padrão SPL-Token (`token::Mint`).

**Exemplos aceitos de fábrica:**
- Wrapped SOL (`So1111...`)
- USDC, USDT (Stablecoins)
- Meme Coins ou Tokens Customizados de Governança.

*(Nota interna da infraestrutura: O Frontend possui a instrução SPL Idempotente que cria a conta receptora para o usuário adversário na hora de aprovar, impossibilitando erros de ATA não inicializados!)*