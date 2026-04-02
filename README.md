# ✦ Escrow de wSOL (Solana App)

O **Escrow de wSOL** é um aplicativo distribuído (DApp) focado em **Pagamentos com Retenção (Timelock/Escrow Unilateral)**, atualmente configurado para rodar na rede **Devnet** da Solana.

Criado com Next.js (Interface Gráfica) e Rust/Anchor (Contratos Inteligentes), este sistema visa extinguir o risco de calote ou de insatisfação num acordo, bloqueando fundos on-chain de forma que eles sejam liberados apenas mediante "Aprovação Mútua".

---

## 🔑 Identificação do Contrato (Program)

**Devnet Program ID:** `5AQuMCykC6W5fH5JWoajGtQ6VT2MUYVsDHQdmut2NPZv`

---

## 💡 Como Funciona (A Lógica Central)

Diferente de um Escrow tradicional (onde dois usuários trocam Token X pelo Token Y simultaneamente), este aplicativo opera de forma **Unilateral com Dupla Assinatura**. 

1. O **Remetente** deposita **wSOL** no cofre virtual (Vault) da Blockchain em nome do **Destinatário**.
2. Ninguém toca nos tokens temporariamente.
3. Ambos devem clicar em **Aprovar**. O programa confere as assinaturas digitais dos dois antes de destravar o Vault e entregar as moedas ao Destinatário.

Isso é ideal para o mercado de Freelancers ou Prestadores de Serviço: o Cliente prova que tem o dinheiro (ele fica trancado), o Freelancer executa a tarefa provado de que o dinheiro existe, e ambos assinam para finalizar.

### Escudo Anti-Golpes (Refund)
- O Remetente configura um prazo limite rotulado de `Timelock`.
- Se o acordo for quebrado e nenhuma aprovação definitiva acontecer, a própria Blockchain impede que a transação fique no limbo. Assim que expirar o Timelock, o aplicativo libera a trava e o Remetente consegue aplicar um **Estorno total automático (Refund)** resgatando seus wSOL do vault.

---

## 🚀 Como Rodar e Testar Localmente (Devnet)

### Sumário de Tecnologias / Pré-requisitos
- [Solana CLI](https://docs.solana.com/cli/install-solana-cli-tools)
- [Anchor CLI](https://www.anchor-lang.com/docs/installation)
- Node.js e Yarn
- Extensão Web da Phantom Wallet configurada para a *Devnet*

### Passo a Passo da Instalação

**1. Configure a Solana CLI para Devnet e injete fundos de teste**
Para bancar os custos de hospedagem do seu contrato você precisa de Devnet SOL na sua máquina:
```bash
solana config set --url devnet
solana airdrop 5
```

**2. Compile e lance o Smart Contract para a internet**
```bash
anchor build
anchor deploy
```
*(Após o deploy, a rede te devolverá o status confirmando seu espaço on-chain!)*

**3. Inicie o Front-end**
Em uma nova aba do terminal, vá para as pastas web e dê boot no servidor Next.js:
```bash
cd app
yarn install
yarn dev
```
Abra `http://localhost:3000` no seu navegador.

**4. Setup da sua Carteira Phantom para Testes**
Como o Escrow trabalha manipulando `wSOL` e não a moeda nativa crua que as Faucets dão, prepare sua carteira Phantom de navegador recém conectada no front-end rodando:
```bash
solana airdrop 5 <SUA_CHAVE_PUBLICA_DO_PHANTOM_AQUI>
spl-token wrap 4 --fee-payer ~/.config/solana/id.json --owner <SUA_CHAVE_PUBLICA_DO_PHANTOM_AQUI>
```

Alternativamente, pode-se usar *faucets* como https://faucet.solana.com/ para obter wSOL diretamente na sua carteira e posteriormente usar o comando abaixo para converter SOL em wSOL:

```bash
spl-token wrap 4
```


Tudo pronto! Seu saldo deverá aparecer no topo do dApp na internet, preparado para abrir quantos depósitos de longa duração você desejar experimentar!

---

## 🔧 Diferenciais Técnicos de Estrutura

- **Contas de Token Implícitas ("O Carteiro Educado"):** 
  Na Solana, para receber qualquer cripto que não seja o próprio SOL nativo (como o nosso wSOL), sua carteira precisa "abrir uma pequena gaveta" específica para aquela moeda, chamada ATA. Normalmente, se tentarem te enviar um token e você não tiver a gaveta dele, a blockchain joga um erro e trava o dinheiro. 
  Para esconder essa dor do usuário, nós usamos instruções matemáticas do tipo **Idempotent**. Ela age como um "carteiro educado": Se o Destinatário já possui a gaveta para wSOL, o carteiro interage direto; se o Destinatário não possui a gaveta do wSOL ou a deletou sem querer, o próprio carteiro (o front-end do DApp) aciona os pedreiros da Blockchain, cria a gaveta às próprias custas, e derrama as moedas perfeitamente sem mostrar uma única tela de falha ao pagador ou recebedor.

- **Ordens de Consultas na Chain:** 
  O histórico de acordos na interface web puxa as contas brutas de dentro do Blockchain filtrando dados temporais decadentes (onde o mais recém criado é listado primeiro), provando maturidade ao tratar contas estáticas como banco de dados ágeis num front-end reativo.

---

## 🔮 Visão de Futuro e Escalabilidade (Roadmap)

Embora a infraestrutura unilateral com dupla aprovação já sustente perfeitamente o B2B e o mercado criativo, existem diversas rotas atrativas para expandir o ecossistema do **wSOL Escrow**:

### 1. Tribunal Descentralizado (Multi-Sig para Disputas)
Adicionar a possibilidade de inserir a chave pública de um **Árbitro ou Plataforma** no momento da formulação do pagamento. Em eventuais divergências intransponíveis sobre o trabalho realizado, um botão de "Disputa" transferiria as alavancas de poder (Approve/Refund) para este Árbitro terceirizado avaliar provas na vida real e decidir para qual das pontas despachar os fundos.

### 2. Contratos com Coração Vivo (Oráculos & Agentes de IA Autônomos)
A aprovação não precisa depender do clique humano!
- **Oráculos Financeiros:** Usar pontes de informação (como Switchboard ou Pyth) para acionar os pagamentos mediante APIs físicas. Exemplo: "Comprei algo. Quando os Correios baterem no status 'Entregue no CEP X', aciona o Escudo do Escrow que automaticamente dispara o `Approve` e libera à loja comercial."
- **Agentes Analistas de IA:** Para equipes de software e bounties, uma I.A. dedicada e com sua própria `PublicKey` poderia ser a Juíza, capaz de revisar o código que você entregou num repositório e atirar o pagamento da recompensa liberando os wSOL após detectar um "Merge" bem sucedido sem falhas de arquitetura.

### 3. Juros Compostos no Cofre (Yield-Bearing Vaults)
Existem acordos comerciais complexos de engenharia cujos pagamentos ficam travados por seis ou mais meses em cofres até as obras saírem do chão. Ao invés do dinheiro ficar inerte na Blockchain, é possível plugar os Vaults diretamente ao ecossistema do **Kamino Finance ou Marginfi**, rentabilizando os tokens enquanto permanecem no cofre. O rendimento contínuo gerado seria convertido em lucro vitalício doEscrow (O dono do App) sem tocar ou arriscar o dinheiro do trabalhador e sem onerar os clientes.

### 4. Swap Transparente Cross-Token
Fazer o depósito da garantia trancar $USDC no Cofre, porém, durante a retirada, embarcar um roteamento cross-program para a agregadora **Jupiter Swap**. Isso permitiria que o freelancer selecionasse opções do tipo *"Receber em BONK"* na hora que for clicar no Approve final, saindo direto pro token desejado através das dezenas de pools da própria infraestrutura da DEX da Solana, de forma totalmente abstraída para o usuário final.