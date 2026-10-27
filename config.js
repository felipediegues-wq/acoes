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
    ATUALIZAR_AUTO_MIN: 15
};
// O token da brapi NÃO fica aqui: ele é digitado na tela "Configurações"
// e salvo só no seu navegador (assim não vai parar no GitHub).
