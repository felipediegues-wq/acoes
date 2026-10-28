# Portal de Ações v3 — Supabase + GitHub Pages

Site estático (GitHub Pages) + banco PostgreSQL (Supabase) + cotações da brapi.dev.

**Atualização v2 → v3 (só layout):** substitua `index.html`, `style.css` e `app.js` no GitHub.
O banco não muda — não rode nenhum SQL.

## Mercado hoje (indicadores + maiores altas e baixas)

Quadro "Indicadores":

| Indicador | Fonte | Atualização |
|---|---|---|
| Ibovespa | brapi (`^BVSP`) | junto com as cotações (15 min) |
| Dólar comercial à vista | AwesomeAPI (`USD-BRL`, gratuita); reserva: brapi | 15 min, só no pregão |
| Volume financeiro | soma de volume × preço das 200 maiores ações da B3 (aproximação) | junto com altas/baixas |
| IPCA-15 | Banco Central, série SGS 7478 (variação mensal); acumulado 12 meses calculado | confere 2x por dia (sai 1x por mês) |

O código da série e a chave opcional da AwesomeAPI ficam no `config.js` (`SERIE_IPCA15`, `AWESOMEAPI_TOKEN`).
Se uma fonte não responder, a linha mostra "indisponível" (passe o mouse para ver o motivo) e o resto continua.

- **Ibovespa**: consulta `^BVSP` na brapi junto com as cotações (1 chamada a mais por ciclo).
  O valor do índice também é gravado no fechamento diário, e a tela Evolução mostra a linha
  "Ibovespa" no gráfico de rentabilidade para comparar com as carteiras (a partir dos fechamentos
  gravados por esta versão).
- **Maiores altas e baixas**: 1 chamada que traz as 200 maiores empresas da B3 com a variação do dia;
  o portal filtra pelas ações do Ibovespa listadas em `IBOVESPA` no `config.js`.
  A B3 muda a composição do índice a cada 4 meses: confira em b3.com.br e ajuste a lista se precisar.
- Se o seu plano da brapi não liberar essa consulta, o quadro mostra um aviso no lugar da lista
  (o resto do portal continua funcionando).

## Layout

- **Computador:** menu no topo, botão "+ Nova ordem" sempre visível, filtros de carteira e período
  (valem para Visão geral e Evolução), faixa de números, gráfico + alocação e posições agrupadas por carteira.
- **Celular (até 760 px):** patrimônio em destaque, gráfico, carteiras (toque para filtrar), maiores posições
  e alocação; barra de navegação embaixo com o botão "+" no centro e o menu "Mais" (Proventos, Ativos,
  Carteiras, Configurações, Sair).

## Telas

| Menu | O que faz |
|---|---|
| **Visão geral** | Patrimônio, resultado, variação do dia, rentabilidade e proventos; gráfico patrimônio x investido; alocação por ativo/tipo/carteira; posições agrupadas por carteira com subtotais e % na carteira |
| **Evolução** | Rentabilidade acumulada por carteira (e total), resultado em aberto por ativo, proventos por mês |
| **Ordens** | Compra/venda. Escolhe a carteira e **busca o ativo digitando** (ticker ou nome). Ticker novo? Aparece "+ Cadastrar" e ele é criado na hora |
| **Proventos** | Dividendos, JCP e rendimentos de FII |
| **Ativos** | Cadastro único de tickers (vale para todas as carteiras); botão "Buscar" pega o nome na brapi |
| **Carteiras** | Nome e descrição |
| **Configurações** | Token da brapi (fica só no navegador) |

## Instalação / atualização

### 1. Banco (Supabase → SQL Editor)
Rode **um arquivo por vez, sempre o arquivo inteiro**. Se aparecer o aviso
"Potential issue detected / RLS", clique em **Run without RLS** (o próprio script liga o RLS).

1. `sql/00_reset_schema_antigo.sql` — apaga a estrutura da versão anterior (só tinha dados de teste).
2. `sql/01_schema.sql` — cria as tabelas da v2.
3. `sql/02_dados_teste.sql` — opcional: carteiras, ordens e ~30 dias de fechamentos simulados para ver os gráficos.

O usuário de login continua o mesmo (Authentication → Users), não precisa recriar.

### 2. Site (GitHub)
No repositório `acoes`, **Add file → Upload files** com:
`index.html`, `style.css`, `app.js`, `config.js` → **Commit changes**.
Depois abra o site e aperte **Ctrl+F5**.

## Como a evolução é registrada

- A tabela `fechamentos_carteira` guarda **1 linha por carteira por dia**: patrimônio, valor investido e o preço de fechamento de cada ativo.
- O fechamento é gravado **pelo próprio site**:
  - com o site aberto depois das 18h40 (dia útil), grava o fechamento do dia;
  - se você só abrir no dia seguinte, ele grava o fechamento do dia anterior assim que abre.
- Dias em que o site não foi aberto ficam sem ponto no gráfico (a linha liga os pontos existentes).
- Na tela Evolução, o último ponto **"Agora"** usa a cotação atual, e o card "Hoje" mostra a variação desde o último fechamento.
- Se você corrigir uma ordem antiga, o gráfico se recalcula com os preços gravados naquele dia.

## Cálculos

- **Preço médio** (regra da Receita): compra soma `qtd × preço + taxas` ao custo; venda não altera o preço médio; zerou a posição, o preço médio zera.
- **Lucro realizado**: `qtd vendida × (preço de venda − preço médio) − taxas`.
- **Venda maior que a posição** é bloqueada (confira carteira e data).
- **Rentabilidade acumulada**: método de cotas (igual a fundos) — aportes e vendas não distorcem o percentual.
  Por isso o "Total" pode ficar diferente da média simples das carteiras.

## Cotações (brapi.dev)

- Configurações → cole o token da brapi. Sem token só PETR4, VALE3, MGLU3 e ITUB4 funcionam.
- Atualização automática a cada 15 min (`ATUALIZAR_AUTO_MIN` no `config.js`), seg–sex das 10h às 19h30, só com a aba visível.
- Plano gratuito: 15.000 chamadas/mês, 1 ticker por chamada, cotação com ~30 min de atraso.
  Consumo aproximado: `ativos em posição × 4 por hora × 9,5 h × 22 dias` (10 ativos ≈ 8.400/mês).
