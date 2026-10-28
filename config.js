// ====================================================================
// config.js — ÚNICO arquivo que você precisa editar
// --------------------------------------------------------------------
// A chave "publishable" PODE ficar pública no GitHub: quem protege os
// dados é o login + RLS do banco. NUNCA coloque aqui a chave "secret"
// (sb_secret_...) nem a "service_role".
// ====================================================================
window.APP_CONFIG = {
    SUPABASE_URL: 'https://fjnyiizsgqzlfvbirxjs.supabase.co',
    SUPABASE_KEY: 'sb_publishable_kgtacUBF-Zu84LBgM6xG2w_b339h_eA',

    // Atualização automática das cotações (minutos), só com a aba aberta
    // e só no horário do pregão (seg–sex, 10h às 18h de Brasília).
    // Plano gratuito da brapi: 15.000 chamadas/mês, 1 ticker por chamada,
    // cotação com ~30 min de atraso. Conta: tickers × (60/intervalo) × 8h × 22 dias.
    //   15 min → 10 tickers ≈ 7.000 chamadas/mês (ok)
    //    5 min → 10 tickers ≈ 21.000 chamadas/mês (estoura o gratuito)
    ATUALIZAR_AUTO_MIN: 15,

    // Indicadores do quadro "Mercado hoje"
    SERIE_IPCA15: 7478,      // Banco Central (SGS): IPCA-15, variação % mensal
    AWESOMEAPI_TOKEN: '',    // opcional: chave gratuita da AwesomeAPI (dólar); vazio funciona com limite menor


    // Ações da carteira teórica do Ibovespa, usadas no quadro "Maiores altas e baixas".
    // A B3 rebalanceia o índice a cada 4 meses (jan, mai, set): confira a lista atual em
    // b3.com.br → Índices → Ibovespa → Composição da carteira, e ajuste aqui se precisar.
    // Se esta lista ficar vazia, o quadro usa as 200 maiores empresas da B3.
    IBOVESPA: [
        'ABEV3', 'ALOS3', 'ASAI3', 'AURE3', 'AZZA3', 'B3SA3', 'BBAS3', 'BBDC3', 'BBDC4', 'BBSE3',
        'BEEF3', 'BPAC11', 'BRAP4', 'BRAV3', 'BRFS3', 'BRKM5', 'CMIG4', 'CMIN3', 'COGN3', 'CPFE3',
        'CPLE6', 'CSAN3', 'CSNA3', 'CURY3', 'CVCB3', 'CXSE3', 'CYRE3', 'DIRR3', 'EGIE3', 'ELET3',
        'ELET6', 'EMBR3', 'ENEV3', 'ENGI11', 'EQTL3', 'FLRY3', 'GGBR4', 'GOAU4', 'HAPV3', 'HYPE3',
        'IGTI11', 'IRBR3', 'ISAE4', 'ITSA4', 'ITUB4', 'KLBN11', 'LREN3', 'MGLU3', 'MOTV3', 'MRFG3',
        'MRVE3', 'MULT3', 'NATU3', 'PCAR3', 'PETR3', 'PETR4', 'PETZ3', 'POMO4', 'PRIO3', 'PSSA3',
        'RADL3', 'RAIL3', 'RAIZ4', 'RDOR3', 'RECV3', 'RENT3', 'SANB11', 'SBSP3', 'SLCE3', 'SMFT3',
        'SMTO3', 'STBP3', 'SUZB3', 'TAEE11', 'TIMS3', 'TOTS3', 'UGPA3', 'USIM5', 'VALE3', 'VAMO3',
        'VBBR3', 'VIVA3', 'VIVT3', 'WEGE3', 'YDUQ3'
    ]
};
// O token da brapi NÃO fica aqui: ele é digitado na tela "Configurações"
// e salvo só no seu navegador (assim não vai parar no GitHub).
