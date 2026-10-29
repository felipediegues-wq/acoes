// ====================================================================
// app.js — Portal de Ações v3 (Supabase + GitHub Pages) — layout A (computador) + C (celular)
// --------------------------------------------------------------------
//  Cadastros: Ativos, Carteiras · Lançamentos: Ordens, Proventos
//  Posição calculada a partir das ordens (preço médio padrão Receita)
//  Fechamento diário por carteira gravado no banco + gráficos de evolução
// ====================================================================

// ---------- compatibilidade com celulares mais antigos (iOS < 15.4) ----------
if (!Array.prototype.at) {
    Object.defineProperty(Array.prototype, 'at', {
        value: function (i) { i = Math.trunc(i) || 0; if (i < 0) i += this.length; return this[i]; },
        writable: true, configurable: true
    });
}

// ---------- qualquer erro aparece na tela (para conseguir diagnosticar pelo celular) ----------
function mostrarErro(msg) {
    const el = document.getElementById('aviso');
    if (!el) return;
    el.textContent = 'Erro: ' + msg;
    el.classList.remove('oculto');
}
window.addEventListener('error', (e) => mostrarErro((e.message || 'desconhecido') + (e.filename ? ` (${e.filename.split('/').pop()}:${e.lineno})` : '')));
window.addEventListener('unhandledrejection', (e) => mostrarErro(e.reason?.message || String(e.reason)));

// ---------- fetch com tempo limite: rede lenta não trava a tela ----------
async function buscar(url, opcoes = {}, ms = 12000) {
    if (typeof AbortController === 'undefined') return fetch(url, opcoes);
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try { return await fetch(url, { ...opcoes, signal: ctrl.signal }); }
    catch (e) { throw e.name === 'AbortError' ? new Error('tempo esgotado') : e; }
    finally { clearTimeout(t); }
}

if (!window.supabase || !window.APP_CONFIG) {
    mostrarErro('não carregou ' + (!window.APP_CONFIG ? 'o config.js' : 'a biblioteca do Supabase (verifique a internet)'));
}
const sb = window.supabase.createClient(APP_CONFIG.SUPABASE_URL, APP_CONFIG.SUPABASE_KEY);

// ---------------- utilitários ----------------
const $ = (id) => document.getElementById(id);
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const num = (v, d = 2) => Number(v).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
const qtdFmt = (v) => Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 4 });
const pct = (v) => (v > 0.004 ? '+' : v < -0.004 ? '−' : '') + num(Math.abs(v)) + '%';
const classe = (v) => (v > 0 ? 'lucro' : v < 0 ? 'prejuizo' : '');
const dataBR = (iso) => iso ? iso.slice(0, 10).split('-').reverse().join('/') : '';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const normTicker = (t) => String(t || '').trim().toUpperCase().replace(/\.SA$/, '').replace(/\s+/g, '');
const TIPOS_ATIVO = { ACAO: 'Ação', FII: 'FII', ETF: 'ETF', BDR: 'BDR', OUTRO: 'Outro' };

// Data/hora sempre no fuso de Brasília, independente do computador
function agoraSP(ms = Date.now()) {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false
    }).formatToParts(new Date(ms)).map(x => [x.type, x.value]));
    return {
        data: `${p.year}-${p.month}-${p.day}`,
        minutos: (Number(p.hour) % 24) * 60 + Number(p.minute),
        diaUtil: !['Sat', 'Sun'].includes(p.weekday)
    };
}
const hojeSP = () => agoraSP().data;
function somaDias(iso, dias) {
    const d = new Date(iso + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + dias);
    return d.toISOString().slice(0, 10);
}

// ---------------- estado ----------------
const DB = { ativos: [], carteiras: [], ordens: [], dividendos: [], fechamentos: [] };
let COTACOES = {};
const ativoDe = (id) => DB.ativos.find(a => a.id === id);
const carteiraDe = (id) => DB.carteiras.find(c => c.id === id);

const TITULOS = {
    visao: 'Visão geral', evolucao: 'Evolução', ordens: 'Ordens', proventos: 'Proventos',
    ativos: 'Ativos', carteiras: 'Carteiras', config: 'Configurações'
};
let abaAtual = 'visao';

// filtros compartilhados por Visão geral e Evolução
let filtroCarteira = '';   // '' = todas
let periodoDias = 0;       // 0 = tudo
let agruparAloc = 'ativo';

// cores fixas por posição na lista (gráficos e alocação)
const CORES = ['#5B9DFF', '#3FB97A', '#E8A23A', '#B58CF0', '#F2737B', '#4FC3D9', '#C9D46A', '#C49A85', '#EC7FB4', '#90A4AE'];
const cidsEscopo = () => new Set(filtroCarteira ? [filtroCarteira] : DB.carteiras.map(c => c.id));

// ====================================================================
// LOGIN
// ====================================================================
$('form-login').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('login-erro').textContent = '';
    const { error } = await sb.auth.signInWithPassword({
        email: $('login-email').value.trim(), password: $('login-senha').value
    });
    if (error) $('login-erro').textContent = 'Falha no login: ' + error.message;
});

sb.auth.onAuthStateChange((_evento, sessao) => {
    if (sessao) {
        $('tela-login').classList.add('oculto');
        $('tela-app').classList.remove('oculto');
        document.documentElement.classList.add('modo-app');   // no celular: só o meio da tela rola
        $('usuario-email').textContent = sessao.user.email;
        setTimeout(() => recarregarTudo(false), 0);
    } else {
        $('tela-app').classList.add('oculto');
        document.documentElement.classList.remove('modo-app');
        $('tela-login').classList.remove('oculto');
    }
});

// ====================================================================
// NAVEGAÇÃO
// ====================================================================
function mostrarAba(aba) {
    abaAtual = aba;
    document.querySelectorAll('.aba-conteudo').forEach(el => el.classList.remove('ativa'));
    document.querySelectorAll('.nav-principal a[data-aba], .nav-celular a[data-aba]')
        .forEach(el => el.classList.toggle('ativo', el.dataset.aba === aba));
    $('aba-' + aba).classList.add('ativa');
    $('titulo-pagina').textContent = TITULOS[aba];
    $('barra-filtros').classList.toggle('oculto', aba !== 'visao' && aba !== 'evolucao');
    fecharMais();
    window.scrollTo(0, 0);
    document.querySelector('.conteudo').scrollTop = 0;   // no celular quem rola é o .conteudo
    renderGraficosVisiveis();   // gráfico precisa estar visível para medir o tamanho
}

function renderGraficosVisiveis() {
    if (abaAtual === 'visao') renderVisao();
    if (abaAtual === 'evolucao') renderEvolucao();
}

function abrirMais() { $('menu-mais').classList.remove('oculto'); $('btn-mais').setAttribute('aria-expanded', 'true'); }
function fecharMais() { $('menu-mais').classList.add('oculto'); $('btn-mais').setAttribute('aria-expanded', 'false'); }
$('btn-mais').addEventListener('click', abrirMais);

// cliques de navegação (menu do topo, barra do celular, menu "Mais", engrenagem)
document.addEventListener('click', (e) => {
    const link = e.target.closest('[data-aba]');
    if (link) { e.preventDefault(); mostrarAba(link.dataset.aba); return; }
    if (e.target.closest('[data-nova-ordem]')) {
        mostrarAba('ordens');
        cancelarEdicao('ordem');
        $('ordem-ativo-busca').focus();
        return;
    }
    if (e.target.closest('[data-fechar-mais]')) { fecharMais(); return; }
    if (e.target.closest('#btn-sair, [data-sair]')) { fecharMais(); sb.auth.signOut(); return; }

    const bCart = e.target.closest('[data-carteira-filtro]');
    if (bCart) {
        filtroCarteira = bCart.dataset.carteiraFiltro;
        desenharFiltroCarteira();
        renderGraficosVisiveis();
        return;
    }
    const bPer = e.target.closest('#seg-periodo [data-periodo]');
    if (bPer) {
        periodoDias = Number(bPer.dataset.periodo);
        document.querySelectorAll('#seg-periodo button').forEach(b => b.classList.toggle('ativo', b === bPer));
        renderGraficosVisiveis();
        return;
    }
    const bAgr = e.target.closest('#seg-agrupar [data-agrupar]');
    if (bAgr) {
        agruparAloc = bAgr.dataset.agrupar;
        document.querySelectorAll('#seg-agrupar button').forEach(b => b.classList.toggle('ativo', b === bAgr));
        renderVisao();
    }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') fecharMais(); });

function desenharFiltroCarteira() {
    const itens = [{ id: '', nome: 'Todas' }, ...DB.carteiras];
    if (filtroCarteira && !DB.carteiras.some(c => c.id === filtroCarteira)) filtroCarteira = '';
    $('seg-carteira').innerHTML = itens.map(c =>
        `<button type="button" data-carteira-filtro="${c.id}" class="${c.id === filtroCarteira ? 'ativo' : ''}">${esc(c.nome)}</button>`
    ).join('');
}

function aviso(msg) {
    $('aviso').textContent = msg || '';
    $('aviso').classList.toggle('oculto', !msg);
}

// ====================================================================
// BANCO
// ====================================================================
async function carregarBanco() {
    const r = await Promise.all([
        sb.from('ativos').select('*').order('ticker'),
        sb.from('carteiras').select('*').order('nome'),
        sb.from('ordens').select('*').order('data_ordem').order('created_at'),
        sb.from('dividendos').select('*').order('data_pagamento', { ascending: false }),
        sb.from('fechamentos_carteira').select('*').order('data')
    ]);
    const erro = r.find(x => x.error)?.error;
    if (erro) throw erro;
    [DB.ativos, DB.carteiras, DB.ordens, DB.dividendos, DB.fechamentos] = r.map(x => x.data);
}

async function recarregarTudo(forcarCotacao) {
    const btn = $('btn-atualizar');
    btn.disabled = true;
    try {
        await carregarBanco();
    } catch (err) {
        console.error(err);
        aviso('Erro ao acessar o banco: ' + (err.message || err));
        btn.disabled = false;
        return;
    }
    // 1) mostra a tela na hora, com as últimas cotações guardadas neste aparelho
    try {
        preencherSelects();
        COTACOES = lerLocal(CHAVE_CACHE, {});
        atualizarInfoCotacao();
        renderTudo();
    } catch (err) {
        console.error(err);
        mostrarErro('ao montar a tela: ' + (err.message || err));
    }
    // 2) depois busca cotações novas e redesenha
    try {
        await atualizarCotacoes(forcarCotacao);
        await salvarFechamentos();
        renderTudo();
    } catch (err) {
        console.error(err);
        aviso('Cotações não atualizaram: ' + (err.message || err) + ' (mostrando os últimos valores guardados)');
    } finally {
        btn.disabled = false;
    }
    atualizarIndicadores(forcarCotacao).then(renderMercado).catch(e => console.warn(e));   // não segura a tela esperando
}

function renderTudo() {
    renderOrdens();
    renderProventos();
    renderAtivos();
    renderCarteiras();
    atualizarInfoOrdem();
    renderGraficosVisiveis();
}

$('btn-atualizar').addEventListener('click', () => recarregarTudo(true));

// ====================================================================
// COTAÇÕES — brapi.dev
// ====================================================================
const CHAVE_TOKEN = 'brapi_token';
const CHAVE_CACHE = 'cache_cotacoes_v2';

function lerLocal(chave, padrao) {
    try { return JSON.parse(localStorage.getItem(chave)) ?? padrao; } catch { return padrao; }
}
function gravarLocal(chave, valor) {
    try { localStorage.setItem(chave, JSON.stringify(valor)); } catch { /* navegador bloqueou */ }
}

async function consultarBrapi(ticker) {
    const token = lerLocal(CHAVE_TOKEN, '');
    const url = `https://brapi.dev/api/quote/${encodeURIComponent(ticker)}` + (token ? `?token=${encodeURIComponent(token)}` : '');
    const res = await buscar(url);
    if (!res.ok) throw new Error(`${ticker}: HTTP ${res.status}`);
    const json = await res.json();
    const r = json.results && json.results[0];
    if (!r || r.regularMarketPrice == null) throw new Error(`${ticker}: sem cotação`);
    return r;
}

function tempoMs(t) {   // regularMarketTime pode vir como ISO ou número
    if (t == null) return null;
    if (typeof t === 'number') return t < 1e12 ? t * 1000 : t;
    const ms = Date.parse(t);
    return isNaN(ms) ? null : ms;
}

async function buscarCotacao(ticker) {
    const r = await consultarBrapi(ticker);
    return {
        preco: Number(r.regularMarketPrice),
        variacao: Number(r.regularMarketChangePercent || 0),
        anterior: r.regularMarketPreviousClose != null ? Number(r.regularMarketPreviousClose) : null,
        mercado: tempoMs(r.regularMarketTime),   // horário da cotação na B3
        em: Date.now()                           // horário em que buscamos
    };
}

function intervaloAutoMs() {
    return Math.max(5, Number(APP_CONFIG.ATUALIZAR_AUTO_MIN) || 15) * 60 * 1000;
}

function tickersEmUso() {
    // só busca cotação do que está em posição (economiza chamadas)
    const pos = calcularPosicoes();
    const t = new Set();
    for (const p of pos.values()) if (p.qtd > 0) t.add(normTicker(ativoDe(p.ativo_id)?.ticker));
    t.delete('');
    return [...t];
}

async function atualizarCotacoes(forcar) {
    const cache = lerLocal(CHAVE_CACHE, {});
    const tickers = [...tickersEmUso(), IBOV];   // o Ibovespa vem junto (1 chamada a mais)
    const pendentes = tickers.filter(t => forcar || !cache[t] || Date.now() - cache[t].em > intervaloAutoMs());
    let falhas = [], semRede = 0;

    for (let i = 0; i < pendentes.length; i += 4) {          // até 4 consultas em paralelo
        const lote = pendentes.slice(i, i + 4);
        const resp = await Promise.allSettled(lote.map(buscarCotacao));
        resp.forEach((r, k) => {
            if (r.status === 'fulfilled') cache[lote[k]] = r.value;
            else { falhas.push(lote[k]); if (/tempo esgotado|Failed to fetch|NetworkError|Load failed/i.test(r.reason?.message || '')) semRede++; }
        });
    }
    gravarLocal(CHAVE_CACHE, cache);
    COTACOES = cache;
    atualizarInfoCotacao();
    renderIbovTopo();

    ibovIndisponivel = falhas.includes(IBOV);
    falhas = falhas.filter(t => t !== IBOV);
    if (falhas.length && semRede >= falhas.length) {
        aviso(`A brapi não respondeu a tempo (${falhas.join(', ')}) — internet lenta ou instável? Mostrando os últimos valores guardados; toque em atualizar para tentar de novo.`);
    } else if (falhas.length) {
        const token = lerLocal(CHAVE_TOKEN, '');
        aviso(`Não consegui cotar: ${falhas.join(', ')}.` +
              (token ? ' Confira se o ticker existe na B3.'
                     : ' Sem token da brapi só PETR4, VALE3, MGLU3 e ITUB4 funcionam — cadastre o token em Configurações.') +
              ' (usando último valor guardado, se houver)');
    } else {
        aviso('');
    }
}

// ====================================================================
// MERCADO: Ibovespa e maiores altas/baixas
//  Ibovespa: /api/quote/^BVSP (mesma consulta das ações).
//  Altas/baixas: 1 chamada que traz as 200 maiores empresas da B3 com a variação
//  do dia; o portal filtra pelas ações do Ibovespa (lista no config.js).
//  Tenta o screener (v2) e, se o plano não permitir, a listagem antiga (v1).
// ====================================================================
const IBOV = '^BVSP';
const CHAVE_MERCADO = 'cache_mercado_v1';
let ibovIndisponivel = false;
let MERCADO = lerLocal(CHAVE_MERCADO, null);   // { em, itens:[{t,nome,preco,v}], fonte } ou { em, erro }

async function buscarListaB3() {
    const token = lerLocal(CHAVE_TOKEN, '');
    const erros = [];
    // 1) screener v2
    try {
        const url = 'https://brapi.dev/api/v2/stocks/screener?type=stock&sortBy=marketCap&sortOrder=desc&limit=200';
        const res = await buscar(url, token ? { headers: { Authorization: 'Bearer ' + token } } : {});
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const j = await res.json();
        const itens = (j.results || []).map(r => ({
            t: normTicker(r.symbol), nome: r.name || r.longName || '',
            preco: Number(r.quote?.lastPrice), v: Number(r.quote?.changePercent), vol: Number(r.quote?.volume) || 0
        })).filter(x => x.t && isFinite(x.preco) && isFinite(x.v));
        if (itens.length) return { itens, fonte: 'v2' };
        throw new Error('lista vazia');
    } catch (e) { erros.push('screener: ' + e.message); }
    // 2) listagem v1
    try {
        const url = 'https://brapi.dev/api/quote/list?type=stock&sortBy=market_cap_basic&sortOrder=desc&limit=200' +
                    (token ? '&token=' + encodeURIComponent(token) : '');
        const res = await buscar(url);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const j = await res.json();
        const itens = (j.stocks || []).map(s => ({
            t: normTicker(s.stock), nome: s.name || '', preco: Number(s.close), v: Number(s.change), vol: Number(s.volume) || 0
        })).filter(x => x.t && isFinite(x.preco) && isFinite(x.v));
        if (itens.length) return { itens, fonte: 'v1' };
        throw new Error('lista vazia');
    } catch (e) { erros.push('lista: ' + e.message); }
    throw new Error(erros.join(' · '));
}

async function atualizarMercado(forcar) {
    const valido = MERCADO && Date.now() - MERCADO.em < intervaloAutoMs();
    if (!forcar && valido) return;
    if (!forcar && MERCADO && !janelaAutomatica() && MERCADO.itens) return;   // fora do pregão a lista não muda
    try {
        const r = await buscarListaB3();
        MERCADO = { em: Date.now(), ...r };
    } catch (e) {
        console.warn('Maiores altas/baixas indisponível:', e.message);
        MERCADO = MERCADO?.itens ? { ...MERCADO, erroRecente: e.message } : { em: Date.now(), erro: e.message };
    }
    gravarLocal(CHAVE_MERCADO, MERCADO);
}

// ---------------- Dólar comercial e IPCA-15 ----------------
const CHAVE_IND = 'cache_indicadores_v1';
let INDICADORES = lerLocal(CHAVE_IND, {});   // { dolar:{preco,v,em,fonte}|{erro}, ipca15:{mes,valor,acum12,em}|{erro} }

async function atualizarDolar(forcar) {
    const d = INDICADORES.dolar;
    if (!forcar && d?.preco && (Date.now() - d.em < intervaloAutoMs() || !janelaAutomatica())) return;
    const erros = [];
    try {   // 1) AwesomeAPI (gratuita)
        const tk = APP_CONFIG.AWESOMEAPI_TOKEN ? '?token=' + encodeURIComponent(APP_CONFIG.AWESOMEAPI_TOKEN) : '';
        const res = await buscar('https://economia.awesomeapi.com.br/json/last/USD-BRL' + tk);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const q = (await res.json()).USDBRL;
        const preco = Number(q?.bid);
        if (!isFinite(preco) || !preco) throw new Error('sem cotação');
        INDICADORES.dolar = { preco, v: Number(q.pctChange) || 0, em: Date.now(), fonte: 'AwesomeAPI' };
    } catch (e) {
        erros.push('AwesomeAPI: ' + e.message);
        try {   // 2) brapi
            const token = lerLocal(CHAVE_TOKEN, '');
            const res = await buscar('https://brapi.dev/api/v2/currency?currency=USD-BRL' + (token ? '&token=' + encodeURIComponent(token) : ''));
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const q = (await res.json()).currency?.[0];
            const preco = Number(q?.bidPrice ?? q?.askPrice);
            if (!isFinite(preco) || !preco) throw new Error('sem cotação');
            INDICADORES.dolar = { preco, v: Number(q.percentageChange ?? q.bidVariation) || 0, em: Date.now(), fonte: 'brapi' };
        } catch (e2) {
            erros.push('brapi: ' + e2.message);
            INDICADORES.dolar = d?.preco ? { ...d, erroRecente: erros.join(' · ') } : { erro: erros.join(' · '), em: Date.now() };
        }
    }
    gravarLocal(CHAVE_IND, INDICADORES);
}

async function atualizarIpca15(forcar) {
    const i = INDICADORES.ipca15;
    if (!forcar && i?.valor != null && Date.now() - i.em < 12 * 3600 * 1000) return;   // sai uma vez por mês: confere 2x por dia
    try {
        const serie = Number(APP_CONFIG.SERIE_IPCA15) || 7478;
        const res = await buscar(`https://api.bcb.gov.br/dados/serie/bcdata.sgs.${serie}/dados/ultimos/12?formato=json`);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const lista = (await res.json()).map(x => ({ data: x.data, v: Number(String(x.valor).replace(',', '.')) })).filter(x => isFinite(x.v));
        if (!lista.length) throw new Error('série vazia');
        const ult = lista.at(-1);
        const [, mm, aaaa] = ult.data.split('/');
        const acum12 = lista.length >= 12 ? (lista.slice(-12).reduce((f, x) => f * (1 + x.v / 100), 1) - 1) * 100 : null;
        INDICADORES.ipca15 = { mes: `${mm}/${aaaa}`, valor: ult.v, acum12, em: Date.now() };
    } catch (e) {
        INDICADORES.ipca15 = i?.valor != null ? { ...i, erroRecente: e.message } : { erro: e.message, em: Date.now() };
    }
    gravarLocal(CHAVE_IND, INDICADORES);
}

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const mesCurto = (mmaaaa) => { const [m, a] = mmaaaa.split('/'); return `${MESES[Number(m) - 1]}/${a.slice(2)}`; };
const bilhoes = (v) => v >= 1e9 ? 'R$ ' + num(v / 1e9, 1) + ' bi' : 'R$ ' + num(v / 1e6, 0) + ' mi';

async function atualizarIndicadores(forcar) {
    await Promise.all([atualizarMercado(forcar), atualizarDolar(forcar), atualizarIpca15(forcar)]);
}

function renderIbovTopo() {
    const c = COTACOES[IBOV];
    if (!$('ibov-topo')) return;   // espaço opcional no topo (removido do layout atual)
    $('ibov-topo').innerHTML = c
        ? `IBOV ${num(c.preco, 0)} <span class="${classe(c.variacao)}">${seta(c.variacao)}${pct(c.variacao)}</span>`
        : '';
}

function renderMercado() {
    renderIbovTopo();
    // ---------- Indicadores: Ibovespa, dólar, volume, IPCA-15 ----------
    const c = COTACOES[IBOV];
    const d = INDICADORES.dolar, ip = INDICADORES.ipca15;
    const volume = MERCADO?.itens ? MERCADO.itens.reduce((s, x) => s + (x.vol || 0) * x.preco, 0) : 0;
    const linhaInd = (nome, valor, detalhe, titulo = '') => `
        <div class="ind-item" ${titulo ? `title="${esc(titulo)}"` : ''}>
            <span class="ind-nome">${nome}</span>
            <span class="ind-valor">${valor}</span>
            <span class="ind-det">${detalhe}</span>
        </div>`;
    const indisp = (msg) => `<span class="sutil">${msg}</span>`;
    $('ibov-box').innerHTML = `
        <span class="rotulo">Indicadores</span>
        ${linhaInd('Ibovespa',
            c ? `${num(c.preco, 0)} <small class="sutil">pts</small>` : indisp(ibovIndisponivel ? 'indisponível' : '…'),
            c ? `<span class="${classe(c.variacao)}">${seta(c.variacao)}${pct(c.variacao)}</span>` : '',
            c?.anterior ? `Fechamento anterior: ${num(c.anterior, 0)} pts · cotação de ${horaSP(c.mercado || c.em)}` : '')}
        ${linhaInd('Dólar comercial',
            d?.preco ? `R$ ${num(d.preco, 4)}` : indisp(d?.erro ? 'indisponível' : '…'),
            d?.preco ? `<span class="${classe(d.v)}">${seta(d.v)}${pct(d.v)}</span>` : '',
            d?.preco ? `À vista, compra · ${d.fonte} · ${horaSP(d.em)}` : (d?.erro || ''))}
        ${linhaInd('Volume financeiro',
            volume > 0 ? bilhoes(volume) : indisp(MERCADO?.erro ? 'indisponível' : '…'),
            volume > 0 ? '<small class="sutil">aprox.</small>' : '',
            'Soma de volume × preço das 200 maiores ações da B3 no dia (aproximação do volume da bolsa)')}
        ${linhaInd(ip?.mes ? `IPCA-15 <small class="sutil">${mesCurto(ip.mes)}</small>` : 'IPCA-15',
            ip?.valor != null ? `${num(ip.valor)}%` : indisp(ip?.erro ? 'indisponível' : '…'),
            ip?.acum12 != null ? `<small class="sutil">12m</small> ${num(ip.acum12)}%` : '',
            ip?.erro ? 'Banco Central: ' + ip.erro : 'Prévia da inflação (IBGE), variação no mês · fonte: Banco Central (SGS)')}`;

    // ---------- maiores altas / baixas ----------
    if (!MERCADO) { $('lista-altas').innerHTML = $('lista-baixas').innerHTML = '<p class="mercado-aviso">Carregando…</p>'; return; }
    if (MERCADO.erro) {
        const msg = `<p class="mercado-aviso">A lista não veio da brapi (${esc(MERCADO.erro)}). ` +
            (lerLocal(CHAVE_TOKEN, '') ? 'Provavelmente o seu plano da brapi não libera essa consulta.' : 'Cadastre o token da brapi em Configurações.') + '</p>';
        $('lista-altas').innerHTML = msg; $('lista-baixas').innerHTML = '';
        $('mercado-info').textContent = '';
        return;
    }
    const indice = new Set((APP_CONFIG.IBOVESPA || []).map(normTicker));
    let base = MERCADO.itens.filter(x => indice.has(x.t));
    let rotulo = 'Ibovespa';
    if (base.length < 10) { base = MERCADO.itens; rotulo = '200 maiores da B3'; }
    const ordenado = [...base].sort((a, b) => b.v - a.v);
    const altas = ordenado.filter(x => x.v > 0).slice(0, 5);
    const baixas = ordenado.filter(x => x.v < 0).reverse().slice(0, 5);
    const minhas = new Set([...calcularPosicoes().values()].filter(p => p.qtd > 0).map(p => normTicker(ativoDe(p.ativo_id)?.ticker)));
    const item = (x) => `<div class="mov-item">
            <span class="nome"><strong>${esc(x.t)}</strong>${minhas.has(x.t) ? '<span class="na-carteira">na carteira</span>' : `<small>${esc(x.nome)}</small>`}</span>
            <span class="preco">${num(x.preco)}</span>
            <span class="var ${classe(x.v)}">${seta(x.v)}${pct(x.v)}</span>
        </div>`;
    $('lista-altas').innerHTML = altas.map(item).join('') || '<p class="mercado-aviso">Nenhuma ação em alta.</p>';
    $('lista-baixas').innerHTML = baixas.map(item).join('') || '<p class="mercado-aviso">Nenhuma ação em baixa.</p>';
    document.querySelectorAll('.mov-col h3')[0].textContent = `Maiores altas · ${rotulo}`;
    document.querySelectorAll('.mov-col h3')[1].textContent = `Maiores baixas · ${rotulo}`;
    $('mercado-info').textContent = `${base.length} ações · atualizado ${horaSP(MERCADO.em)}` +
        (MERCADO.erroRecente ? ' (última tentativa falhou)' : '');
}

// ====================================================================
// ATUALIZAÇÃO AUTOMÁTICA
//  seg–sex das 10h às 19h30 (Brasília), com a aba visível.
//  Depois das 18h40 a cotação já é a de fechamento → grava o fechamento do dia.
// ====================================================================
const FECHAMENTO_MIN = 18 * 60 + 40;   // a partir de 18:40 considera o pregão encerrado (cotação tem atraso)

function janelaAutomatica() {
    const a = agoraSP();
    return a.diaUtil && a.minutos >= 10 * 60 && a.minutos <= 19 * 60 + 30;
}
function pregaoAberto() {
    const a = agoraSP();
    return a.diaUtil && a.minutos >= 10 * 60 && a.minutos < FECHAMENTO_MIN;
}

const horaSP = (ms) => new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
let horaCotacao = '';   // usado também no topo da Visão geral do celular

function atualizarInfoCotacao() {
    const el = $('info-cotacao');
    const horarios = tickersEmUso().map(t => COTACOES[t]?.em).filter(Boolean);
    if (!horarios.length) { el.textContent = ''; horaCotacao = ''; return; }
    const maisAntiga = Math.min(...horarios);
    horaCotacao = horaSP(maisAntiga);
    const auto = janelaAutomatica();
    el.classList.toggle('auto', auto);
    el.textContent = auto ? `Cotações ${horaCotacao}` : `${horaCotacao} · fechado`;
    el.title = auto ? `Atualização automática · próxima por volta de ${horaSP(maisAntiga + intervaloAutoMs())}` : 'Pregão fechado';
}

let autoRodando = false;
async function cicloAutomatico() {
    if (autoRodando || document.hidden || $('tela-app').classList.contains('oculto') || !DB.ordens.length) return;
    if (!janelaAutomatica()) { atualizarInfoCotacao(); return; }
    autoRodando = true;
    try {
        await atualizarCotacoes(false);       // só busca o que venceu
        await salvarFechamentos();
        await atualizarIndicadores(false);
        renderAtivos();
        renderCarteiras();
        renderGraficosVisiveis();
    } catch (err) {
        console.error('Atualização automática falhou:', err);
    } finally {
        autoRodando = false;
    }
}
setInterval(cicloAutomatico, 60 * 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) cicloAutomatico(); });

// ====================================================================
// CÁLCULO DA POSIÇÃO (por carteira + ativo)
//  - Compra: custo += qtd*preço + taxas; PM = custo / qtd
//  - Venda : PM não muda; lucro realizado = qtd*(preço - PM) - taxas
//  - Zerou : PM e custo voltam a zero
//  ate (yyyy-mm-dd) opcional: considera só ordens até essa data
//  ignorarOrdemId: usado ao editar uma ordem (posição "sem ela")
// ====================================================================
function calcularPosicoes(ate = null, ignorarOrdemId = null) {
    const pos = new Map();
    const pega = (cid, aid) => {
        const k = cid + '|' + aid;
        if (!pos.has(k)) pos.set(k, { carteira_id: cid, ativo_id: aid, qtd: 0, custo: 0, pm: 0, realizado: 0, proventos: 0, alerta: false });
        return pos.get(k);
    };
    for (const o of DB.ordens) {
        if (ate && o.data_ordem > ate) continue;
        if (o.id === ignorarOrdemId) continue;
        const p = pega(o.carteira_id, o.ativo_id);
        const q = Number(o.quantidade), preco = Number(o.preco), taxas = Number(o.taxas || 0);
        if (o.tipo === 'C') {
            p.custo += q * preco + taxas;
            p.qtd += q;
            p.pm = p.custo / p.qtd;
        } else {
            if (q > p.qtd + 1e-9) p.alerta = true;
            p.realizado += q * (preco - p.pm) - taxas;
            p.qtd -= q;
            p.custo = p.pm * p.qtd;
            if (p.qtd <= 1e-9) { p.qtd = 0; p.custo = 0; p.pm = 0; }
        }
    }
    for (const d of DB.dividendos) {
        if (ate && d.data_pagamento > ate) continue;
        pega(d.carteira_id, d.ativo_id).proventos += Number(d.valor_total);
    }
    return pos;
}

// ====================================================================
// FECHAMENTO DIÁRIO
//  Usa o horário da cotação (regularMarketTime): se o dia da cotação já
//  encerrou (dia anterior, ou hoje depois das 18:40), aquele preço é o
//  fechamento. Grava 1 linha por carteira/dia (upsert: pode regravar).
// ====================================================================
let salvandoFechamento = false;
async function salvarFechamentos() {
    if (salvandoFechamento) return;
    const agora = agoraSP();
    const fechados = {};   // ticker -> {data, preco}
    for (const [t, c] of Object.entries(COTACOES)) {
        const d = agoraSP(c.mercado ?? c.em).data;
        const encerrado = d < agora.data || (d === agora.data && agora.minutos >= FECHAMENTO_MIN);
        if (encerrado) fechados[t] = { data: d, preco: c.preco };
        else if (c.anterior != null) fechados[t] = { data: null, preco: c.anterior };   // pregão aberto: vale o fechamento anterior
    }
    const datas = Object.values(fechados).map(f => f.data).filter(Boolean);
    let dataFech, soSeNaoExistir = false;
    if (datas.length) {
        dataFech = datas.sort().at(-1);
    } else if (Object.keys(fechados).length) {
        // site aberto pela 1ª vez com o pregão já rodando: grava o fechamento do dia útil anterior
        // (com o "fechamento anterior" da brapi), mas só se aquele dia ainda não tiver sido salvo
        dataFech = somaDias(agora.data, -1);
        while ([0, 6].includes(new Date(dataFech + 'T12:00:00Z').getUTCDay())) dataFech = somaDias(dataFech, -1);
        soSeNaoExistir = true;
    } else {
        return;
    }

    const posicoes = calcularPosicoes(dataFech);
    const linhas = [];
    for (const c of DB.carteiras) {
        let vm = 0, inv = 0, temOrdem = false;
        const precos = {};
        for (const p of posicoes.values()) {
            if (p.carteira_id !== c.id) continue;
            temOrdem = true;
            if (p.qtd <= 0) continue;
            const t = normTicker(ativoDe(p.ativo_id)?.ticker);
            const preco = fechados[t]?.preco ?? ultimoPrecoConhecido(t, dataFech) ?? p.pm;
            precos[t] = Number(preco.toFixed(4));
            vm += p.qtd * preco;
            inv += p.custo;
        }
        if (!temOrdem) continue;
        if (fechados[IBOV]) precos[IBOV] = Number(fechados[IBOV].preco.toFixed(2));   // guarda o Ibovespa do dia para comparar
        const linha = { carteira_id: c.id, data: dataFech, valor_mercado: Number(vm.toFixed(2)), valor_investido: Number(inv.toFixed(2)), precos };
        const existente = DB.fechamentos.find(f => f.carteira_id === c.id && f.data === dataFech);
        if (existente && soSeNaoExistir) continue;
        if (existente && Number(existente.valor_mercado) === linha.valor_mercado &&
            Number(existente.valor_investido) === linha.valor_investido &&
            JSON.stringify(existente.precos) === JSON.stringify(precos)) continue;   // nada mudou
        linhas.push({ ...linha, atualizado_em: new Date().toISOString() });
    }
    if (!linhas.length) return;

    salvandoFechamento = true;
    try {
        const { data, error } = await sb.from('fechamentos_carteira')
            .upsert(linhas, { onConflict: 'carteira_id,data' }).select();
        if (error) { console.error('Erro ao salvar fechamento:', error); return; }
        for (const f of data) {
            const i = DB.fechamentos.findIndex(x => x.carteira_id === f.carteira_id && x.data === f.data);
            if (i >= 0) DB.fechamentos[i] = f; else DB.fechamentos.push(f);
        }
        DB.fechamentos.sort((a, b) => a.data.localeCompare(b.data));
    } finally {
        salvandoFechamento = false;
    }
}

function ultimoPrecoConhecido(ticker, ateData) {
    for (let i = DB.fechamentos.length - 1; i >= 0; i--) {
        const f = DB.fechamentos[i];
        if (f.data <= ateData && f.precos && f.precos[ticker] != null) return Number(f.precos[ticker]);
    }
    return null;
}

// ====================================================================
// SÉRIE DIÁRIA (fechamentos salvos + ponto "Agora")
// ====================================================================
const GRAFICOS = {};
if (window.Chart) {
    Chart.defaults.color = '#8B95A3';
    Chart.defaults.borderColor = '#1D232B';
    Chart.defaults.font.family = "'IBM Plex Sans', system-ui, sans-serif";
}
$('mostrar-zeradas').addEventListener('change', () => renderVisao());
$('busca-posicao').addEventListener('input', () => renderVisao());

// Fluxo de caixa de um conjunto de carteiras entre (de, ate]:
//   aportes = dinheiro colocado em compras · resgates = dinheiro recebido em vendas
function fluxoEntre(cids, de, ate) {
    let aportes = 0, resgates = 0;
    for (const o of DB.ordens) {
        if (!cids.has(o.carteira_id)) continue;
        if ((de && o.data_ordem <= de) || o.data_ordem > ate) continue;
        const bruto = Number(o.quantidade) * Number(o.preco), tx = Number(o.taxas || 0);
        if (o.tipo === 'C') aportes += bruto + tx; else resgates += bruto - tx;
    }
    return { aportes, resgates };
}
function proventosEntre(cids, de, ate) {
    let s = 0;
    for (const d of DB.dividendos) {
        if (!cids.has(d.carteira_id)) continue;
        if ((de && d.data_pagamento <= de) || d.data_pagamento > ate) continue;
        s += Number(d.valor_total);
    }
    return s;
}

// Monta a série de pontos (fechamentos salvos + "Agora") para um conjunto de carteiras.
// O patrimônio de cada dia é recalculado com as ordens atuais e os preços gravados no fechamento.
function montarSerie(cids, datas, precosPorData, posPorData) {
    const pontos = [];
    let cota = 1, anterior = null;
    for (const d of datas) {
        const pos = posPorData.get(d);
        const precos = precosPorData.get(d);
        let V = 0, I = 0, temPosicao = false;
        for (const p of pos.values()) {
            if (!cids.has(p.carteira_id) || p.qtd <= 0) continue;
            temPosicao = true;
            const t = normTicker(ativoDe(p.ativo_id)?.ticker);
            V += p.qtd * (precos[t] ?? p.pm);
            I += p.custo;
        }
        const dataReal = d === 'AGORA' ? hojeSP() : d;
        const deData = anterior ? (anterior.data === 'AGORA' ? hojeSP() : anterior.data) : null;
        const { aportes, resgates } = fluxoEntre(cids, deData, dataReal);
        const F = aportes - resgates;
        const P = proventosEntre(cids, deData, dataReal);
        // Rentabilidade do período (método das cotas, como fundos):
        //   compras entram no início do período, vendas e proventos saem no fim
        //   r = (V + vendas + proventos) / (V_anterior + compras) - 1
        const Vant = anterior ? anterior.V : 0;
        const inicio = Vant + aportes;
        const r = inicio > 0.005 ? (V + resgates + P) / inicio - 1 : 0;
        if (anterior || temPosicao) cota *= 1 + r;
        const ponto = { data: d, V, I, F, P, r, cota, ativo: temPosicao || !!anterior };
        pontos.push(ponto);
        if (temPosicao || anterior) anterior = ponto;
    }
    return pontos;
}

// Junta o que a série precisa: datas com fechamento, preços de cada data, posições e início do período
function montarBase(cids) {
    const datas = [...new Set(DB.fechamentos.filter(f => cids.has(f.carteira_id)).map(f => f.data))].sort();

    // preços por data: une os preços gravados de todas as carteiras naquele dia (+ último conhecido)
    const precosPorData = new Map();
    const ultimo = {};
    const todasDatas = [...new Set(DB.fechamentos.map(f => f.data))].sort();
    for (const d of todasDatas) {
        for (const f of DB.fechamentos) if (f.data === d) Object.assign(ultimo, Object.fromEntries(Object.entries(f.precos || {}).map(([k, v]) => [k, Number(v)])));
        precosPorData.set(d, { ...ultimo });
    }

    // ponto "Agora" com a cotação atual
    const hoje = hojeSP();
    const ultimaData = datas.at(-1);
    const temCotacao = Object.keys(COTACOES).length > 0;
    if (temCotacao && ultimaData !== hoje) {
        const precosAgora = { ...(ultimaData ? precosPorData.get(ultimaData) : {}) };
        for (const [t, c] of Object.entries(COTACOES)) precosAgora[t] = c.preco;
        precosPorData.set('AGORA', precosAgora);
        datas.push('AGORA');
    }

    const posPorData = new Map();
    for (const d of datas) posPorData.set(d, calcularPosicoes(d === 'AGORA' ? null : d));

    // recorte do período
    let ini = 0;
    if (periodoDias > 0) {
        const corte = somaDias(hoje, -periodoDias);
        ini = datas.findIndex(d => d === 'AGORA' || d >= corte);
        if (ini < 0) ini = datas.length;
    }
    return { datas, precosPorData, posPorData, ini };
}

// Série + números do período para um conjunto de carteiras
function resumoPeriodo(cids, base = montarBase(cids)) {
    const serie = montarSerie(cids, base.datas, base.precosPorData, base.posPorData);
    const ini = base.ini;
    const vis = serie.slice(ini);
    // base da rentabilidade = cota no fechamento anterior ao período (ou 1 = preço pago)
    const cotaBase = ini > 0 ? serie[ini - 1].cota : 1;
    const ult = vis.at(-1);
    const penult = vis.length > 1 ? vis.at(-2) : (ini > 0 ? serie[ini - 1] : null);
    return {
        base, serie, ini, vis, cotaBase, ult,
        rent: ult && ult.ativo ? (ult.cota / cotaBase - 1) * 100 : null,
        varDia: ult && penult && penult.ativo ? ult.r * 100 : null,
        varDiaRs: ult && penult && penult.ativo ? ult.V + ult.P - penult.V - ult.F : null,
        provPeriodo: vis.reduce((s, p) => s + p.P, 0),
        inicio: vis.find(p => p.ativo)?.data,
        rotulos: vis.map(p => p.data === 'AGORA' ? 'Agora' : dataBR(p.data).slice(0, 5)),
        rotulosLongos: vis.map(p => p.data === 'AGORA' ? 'Agora (cotação atual)' : dataBR(p.data))
    };
}

// ---------- pequenos formatadores ----------
const sinalBrl = (v) => (v > 0.004 ? '+' : v < -0.004 ? '−' : '') + brl.format(Math.abs(v));
const seta = (v) => (v > 0 ? '▲ ' : v < 0 ? '▼ ' : '');
const brlCurto = (v) => Math.abs(v) >= 1000 ? 'R$ ' + num(v / 1000, Math.abs(v) >= 10000 ? 0 : 1) + ' mil' : brl.format(v);
const kpi = (rotulo, valor, sub, clsValor = '', clsSub = '') =>
    `<div class="kpi"><span class="rotulo">${rotulo}</span><span class="valor ${clsValor}">${valor}</span><span class="sub ${clsSub}">${sub}</span></div>`;
const valorDe = (p) => {
    const c = COTACOES[normTicker(ativoDe(p.ativo_id)?.ticker)];
    return { cot: c, valor: p.qtd * (c ? c.preco : p.pm) };
};

// ====================================================================
// TELA: VISÃO GERAL
// ====================================================================
function renderVisao() {
    if (abaAtual !== 'visao') return;
    const cids = cidsEscopo();
    const posicoes = [...calcularPosicoes().values()].filter(p => cids.has(p.carteira_id));

    let custo = 0, valor = 0, prov = 0, real = 0, parcial = false;
    for (const p of posicoes) {
        custo += p.custo; prov += p.proventos; real += p.realizado;
        if (p.qtd > 0) { const v = valorDe(p); valor += v.valor; if (!v.cot) parcial = true; }
    }
    const res = valor - custo, resPct = custo > 0 ? res / custo * 100 : 0;
    const R = resumoPeriodo(cids);
    const rotuloDia = R.ult?.data === 'AGORA' ? 'Hoje' : 'Último fechamento';

    // ---------- números do topo (computador) ----------
    $('kpis').innerHTML =
        kpi('Patrimônio', brl.format(valor), `investido ${brl.format(custo)}${parcial ? ' · cotação parcial' : ''}`) +
        kpi('Resultado em aberto', sinalBrl(res), `${seta(res)}${pct(resPct)} sobre o custo`, classe(res), classe(res)) +
        kpi(rotuloDia, R.varDia != null ? pct(R.varDia) : '—',
            R.varDiaRs != null ? `${seta(R.varDiaRs)}${sinalBrl(R.varDiaRs)} ${R.ult.data === 'AGORA' ? 'desde o fechamento' : 'no dia'}` : 'aguardando o 1º fechamento',
            classe(R.varDia), classe(R.varDiaRs)) +
        kpi('Rentabilidade', R.rent != null ? pct(R.rent) : '—',
            R.inicio ? `desde ${dataBR(R.inicio === 'AGORA' ? hojeSP() : R.inicio)} · método de cotas` : 'sem fechamentos no período', classe(R.rent)) +
        kpi(periodoDias ? 'Proventos no período' : 'Proventos', brl.format(periodoDias ? R.provPeriodo : prov),
            `lucro realizado ${sinalBrl(real)}`);

    // ---------- topo do celular ----------
    $('m-hero').innerHTML = `
        <span class="rotulo">Patrimônio${horaCotacao ? ' · cotações ' + horaCotacao : ''}</span>
        <span class="grande">${brl.format(valor)}</span>
        <div class="chips">
            <span class="chip ${classe(res)}">${seta(res)}${sinalBrl(res)} (${pct(resPct)})</span>
            ${R.varDia != null ? `<span class="chip ${classe(R.varDia)}">${seta(R.varDia)}${rotuloDia.toLowerCase()} ${pct(R.varDia)}</span>` : ''}
            ${R.rent != null ? `<span class="chip">rent. ${pct(R.rent)}</span>` : ''}
            ${COTACOES[IBOV] ? `<span class="chip">IBOV ${num(COTACOES[IBOV].preco, 0)} <span class="${classe(COTACOES[IBOV].variacao)}">${pct(COTACOES[IBOV].variacao)}</span></span>` : ''}
        </div>`;
    renderMercado();

    // ---------- gráfico patrimônio x investido ----------
    if (window.Chart) {
        desenhar('g-visao', {
            type: 'line',
            data: {
                labels: R.rotulos,
                datasets: [
                    { label: 'Patrimônio', data: R.vis.map(p => p.ativo ? +p.V.toFixed(2) : null), borderColor: '#5B9DFF', backgroundColor: 'rgba(91,157,255,.12)', fill: true, tension: .25, pointRadius: R.vis.length > 60 ? 0 : 2, borderWidth: 2.2 },
                    { label: 'Investido', data: R.vis.map(p => p.ativo ? +p.I.toFixed(2) : null), borderColor: '#8B95A3', borderDash: [5, 4], fill: false, stepped: true, pointRadius: 0, borderWidth: 1.5 }
                ]
            },
            options: opcoesLinha(brlCurto, R.rotulosLongos, (v) => brl.format(v), false)
        });
    }

    // ---------- alocação ----------
    const grupos = new Map();
    for (const p of posicoes) {
        if (p.qtd <= 0) continue;
        const a = ativoDe(p.ativo_id);
        const chave = agruparAloc === 'tipo' ? TIPOS_ATIVO[a?.tipo] || 'Outro'
                    : agruparAloc === 'carteira' ? carteiraDe(p.carteira_id)?.nome : a?.ticker;
        const sub = agruparAloc === 'ativo' ? (a?.nome || '') : '';
        const g = grupos.get(chave) || { nome: chave, sub, valor: 0 };
        g.valor += valorDe(p).valor;
        grupos.set(chave, g);
    }
    const aloc = [...grupos.values()].sort((x, y) => y.valor - x.valor);
    const totAloc = aloc.reduce((s, g) => s + g.valor, 0) || 1;
    $('aloc-barra').innerHTML = aloc.map((g, i) =>
        `<div style="width:${(g.valor / totAloc * 100).toFixed(2)}%;background:${CORES[i % CORES.length]}" title="${esc(g.nome)}"></div>`).join('');
    $('aloc-barra').setAttribute('aria-label', aloc.map(g => `${g.nome} ${num(g.valor / totAloc * 100, 1)}%`).join(', ') || 'Sem posições');
    $('aloc-lista').innerHTML = aloc.map((g, i) => `
        <div class="aloc-item">
            <i style="background:${CORES[i % CORES.length]}"></i>
            <span class="nome"><strong>${esc(g.nome)}</strong>${g.sub ? ` <small>${esc(g.sub)}</small>` : ''}</span>
            <span class="mono">${brlCurto(g.valor)}</span>
            <span class="mono pct">${num(g.valor / totAloc * 100, 1)}%</span>
        </div>`).join('') || '<p class="sutil">Sem posições abertas.</p>';

    // ---------- tabela de posições agrupada por carteira ----------
    const zeradas = $('mostrar-zeradas').checked;
    const termo = $('busca-posicao').value.trim().toUpperCase();
    const cores = new Map(aloc.map((g, i) => [g.nome, CORES[i % CORES.length]]));
    let html = '';
    for (const c of DB.carteiras.filter(c => cids.has(c.id))) {
        const daCarteira = posicoes.filter(p => p.carteira_id === c.id);
        const totCart = daCarteira.filter(p => p.qtd > 0).reduce((s, p) => s + valorDe(p).valor, 0);
        const linhas = daCarteira
            .filter(p => zeradas || p.qtd > 0)
            .filter(p => { const a = ativoDe(p.ativo_id); return !termo || a?.ticker.includes(termo) || (a?.nome || '').toUpperCase().includes(termo); })
            .sort((x, y) => valorDe(y).valor - valorDe(x).valor);
        if (!linhas.length) continue;

        let cVal = 0, cCusto = 0, cProv = 0, cReal = 0;
        const corpo = linhas.map(p => {
            const a = ativoDe(p.ativo_id);
            const { cot, valor: v } = valorDe(p);
            const r = p.qtd > 0 ? v - p.custo : null;
            const rp = r != null && p.custo > 0 ? r / p.custo * 100 : null;
            const part = p.qtd > 0 && totCart ? v / totCart * 100 : 0;
            if (p.qtd > 0) { cVal += v; cCusto += p.custo; }
            cProv += p.proventos; cReal += p.realizado;
            const cor = agruparAloc === 'ativo' ? (cores.get(a?.ticker) || '#5B9DFF') : '#5B9DFF';
            const alerta = p.alerta ? ' <span class="prejuizo" title="Existe venda maior que a posição — confira as ordens">(!)</span>' : '';
            return `<tr class="${p.qtd === 0 ? 'zerada' : ''}">
                <td><strong>${esc(a?.ticker)}</strong><span class="ativo-nome">${esc(a?.nome || '')}</span>${alerta}</td>
                <td class="num">${qtdFmt(p.qtd)}</td>
                <td class="num">${p.qtd ? num(p.pm) : '—'}</td>
                <td class="num">${cot ? num(cot.preco) : '—'}</td>
                <td class="num ${cot ? classe(cot.variacao) : ''}">${cot ? pct(cot.variacao) : '—'}</td>
                <td class="num">${p.qtd ? num(v) : '—'}</td>
                <td class="num ${classe(r)}">${r != null ? (r > 0 ? '+' : r < 0 ? '−' : '') + num(Math.abs(r)) : '—'}</td>
                <td class="num ${classe(rp)}">${rp != null ? pct(rp) : '—'}</td>
                <td class="num">${p.qtd ? num(part, 1) + '%' : '—'}${p.qtd ? `<div class="barra-pct"><div style="width:${part.toFixed(1)}%;background:${cor}"></div></div>` : ''}</td>
                <td class="num">${p.proventos ? num(p.proventos) : '—'}</td>
                <td class="num ${classe(p.realizado)}">${p.realizado ? (p.realizado > 0 ? '+' : '−') + num(Math.abs(p.realizado)) : '—'}</td>
            </tr>`;
        }).join('');
        const cRes = cVal - cCusto, cRp = cCusto > 0 ? cRes / cCusto * 100 : 0;
        html += `<tr class="grupo">
                <td colspan="5">${esc(c.nome)}</td>
                <td class="num">${num(cVal)}</td>
                <td class="num ${classe(cRes)}">${(cRes > 0 ? '+' : cRes < 0 ? '−' : '') + num(Math.abs(cRes))}</td>
                <td class="num ${classe(cRp)}">${pct(cRp)}</td>
                <td></td>
                <td class="num">${cProv ? num(cProv) : '—'}</td>
                <td class="num ${classe(cReal)}">${cReal ? (cReal > 0 ? '+' : '−') + num(Math.abs(cReal)) : '—'}</td>
            </tr>` + corpo;
    }
    $('tb-posicao').innerHTML = html ||
        `<tr><td colspan="11" class="vazio">${termo ? 'Nenhum ativo encontrado.' : 'Nenhuma posição. Cadastre uma carteira, um ativo e lance uma ordem de compra.'}</td></tr>`;

    // ---------- celular: carteiras ----------
    const cartsCel = DB.carteiras.map(c => {
        const ps = [...calcularPosicoes().values()].filter(p => p.carteira_id === c.id && p.qtd > 0);
        const v = ps.reduce((s, p) => s + valorDe(p).valor, 0), k = ps.reduce((s, p) => s + p.custo, 0);
        return { c, ps, v, rp: k > 0 ? (v / k - 1) * 100 : null };
    }).filter(x => x.ps.length).sort((a, b) => b.v - a.v);
    $('m-carteiras').innerHTML = !cartsCel.length ? '' :
        '<span class="m-titulo">Carteiras · toque para filtrar</span>' + cartsCel.map(x => `
        <button type="button" class="m-card ${filtroCarteira === x.c.id ? 'ativo' : ''}" data-carteira-filtro="${filtroCarteira === x.c.id ? '' : x.c.id}">
            <span class="esq"><strong>${esc(x.c.nome)}</strong><small>${x.ps.map(p => esc(ativoDe(p.ativo_id)?.ticker)).join(' · ')}</small></span>
            <span class="dir"><span>${brl.format(x.v)}</span><small class="${classe(x.rp)}">${x.rp != null ? pct(x.rp) : ''}</small></span>
        </button>`).join('');

    // ---------- celular: maiores posições (soma o mesmo ativo de várias carteiras) ----------
    const porAtivo = new Map();
    for (const p of posicoes) {
        if (p.qtd <= 0) continue;
        const g = porAtivo.get(p.ativo_id) || { a: ativoDe(p.ativo_id), qtd: 0, v: 0, k: 0 };
        g.qtd += p.qtd; g.v += valorDe(p).valor; g.k += p.custo;
        porAtivo.set(p.ativo_id, g);
    }
    const maiores = [...porAtivo.values()].sort((x, y) => y.v - x.v).slice(0, 6);
    $('m-posicoes').innerHTML = !maiores.length ? '' :
        '<span class="m-titulo">Maiores posições</span><div class="painel" style="padding:4px 14px">' + maiores.map(g => {
            const rp = g.k > 0 ? (g.v / g.k - 1) * 100 : null;
            return `<div class="m-linha">
                <span><strong>${esc(g.a?.ticker)}</strong><span class="qtd">${qtdFmt(g.qtd)}</span></span>
                <span class="dir">${brlCurto(g.v)} <span class="${classe(rp)}">${rp != null ? pct(rp) : ''}</span></span>
            </div>`;
        }).join('') + '</div>';
}

// ====================================================================
// TELA: EVOLUÇÃO
// ====================================================================
function renderEvolucao() {
    if (abaAtual !== 'evolucao') return;
    if (!window.Chart) { aviso('Biblioteca de gráficos não carregou (verifique a internet).'); return; }
    const cids = cidsEscopo();
    const base = montarBase(cids);
    const R = resumoPeriodo(cids, base);
    const ult = R.ult;

    $('resumo-evolucao').innerHTML = !ult
        ? kpi('Sem dados', '—', 'Os fechamentos são gravados automaticamente a cada dia de pregão.')
        : kpi('Patrimônio', brl.format(ult.V), `investido ${brl.format(ult.I)}`) +
          kpi('Resultado em aberto', sinalBrl(ult.V - ult.I), ult.I > 0 ? `${seta(ult.V - ult.I)}${pct((ult.V / ult.I - 1) * 100)} sobre o custo` : '', classe(ult.V - ult.I), classe(ult.V - ult.I)) +
          kpi(ult.data === 'AGORA' ? 'Hoje' : 'Último fechamento', R.varDia != null ? pct(R.varDia) : '—',
              R.varDiaRs != null ? `${seta(R.varDiaRs)}${sinalBrl(R.varDiaRs)}` : '', classe(R.varDia), classe(R.varDiaRs)) +
          kpi('Rentabilidade no período', R.rent != null ? pct(R.rent) : '—',
              R.inicio ? `desde ${dataBR(R.inicio === 'AGORA' ? hojeSP() : R.inicio)}` : '', classe(R.rent)) +
          kpi('Proventos no período', brl.format(R.provPeriodo), `${R.vis.length} fechamento(s) no período`);

    renderTabelaAtivos(cids, R);

    // ---------- rentabilidade acumulada por carteira ----------
    const carts = DB.carteiras.filter(c => cids.has(c.id));
    const datasets = [];
    const linha = (r, label, cor, tracejado) => datasets.push({
        label, borderColor: cor, backgroundColor: cor, tension: .25, borderWidth: tracejado ? 2.5 : 2,
        pointRadius: R.vis.length > 60 ? 0 : 2, borderDash: tracejado ? [6, 4] : [],
        data: r.vis.map(p => p.ativo ? +((p.cota / r.cotaBase - 1) * 100).toFixed(2) : null)
    });
    carts.forEach((c, i) => linha(resumoPeriodo(new Set([c.id]), base), c.nome, CORES[i % CORES.length], false));
    if (carts.length > 1) linha(R, 'Total', '#E6EAF0', true);

    // Ibovespa no mesmo período (fechamentos guardados + agora), para comparar
    const datasVis = base.datas.slice(R.ini);
    const ibov = datasVis.map(d => base.precosPorData.get(d)?.[IBOV] ?? null);
    const ibovBase = (R.ini > 0 ? base.precosPorData.get(base.datas[R.ini - 1])?.[IBOV] : null) ?? ibov.find(v => v != null);
    if (ibovBase && ibov.filter(v => v != null).length >= 2) {
        datasets.push({
            label: 'Ibovespa', borderColor: '#E8A23A', backgroundColor: '#E8A23A', borderDash: [2, 3], borderWidth: 2,
            tension: .25, pointRadius: 0,
            data: ibov.map(v => v != null ? +((v / ibovBase - 1) * 100).toFixed(2) : null)
        });
    }
    desenhar('g-rentabilidade', {
        type: 'line',
        data: { labels: R.rotulos, datasets },
        options: opcoesLinha(v => num(v, 1) + '%', R.rotulosLongos, v => num(v) + '%', true)
    });

    // ---------- resultado em aberto por ativo ----------
    const porAtivo = new Map();
    for (const p of calcularPosicoes().values()) {
        if (!cids.has(p.carteira_id) || p.qtd <= 0) continue;
        const t = ativoDe(p.ativo_id)?.ticker;
        porAtivo.set(t, (porAtivo.get(t) || 0) + valorDe(p).valor - p.custo);
    }
    const resAtivos = [...porAtivo.entries()].sort((a, b) => b[1] - a[1]);
    desenhar('g-resultado', {
        type: 'bar',
        data: {
            labels: resAtivos.map(x => x[0]),
            datasets: [{ data: resAtivos.map(x => +x[1].toFixed(2)), backgroundColor: resAtivos.map(x => x[1] >= 0 ? '#3FB97A' : '#F2737B'), borderRadius: 4 }]
        },
        options: {
            indexAxis: 'y', responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => sinalBrl(c.raw) } } },
            scales: { x: { ticks: { callback: brlCurto } }, y: { grid: { display: false } } }
        }
    });

    // ---------- proventos por mês ----------
    const hoje = hojeSP();
    const [ano, mes] = hoje.split('-').map(Number);
    const meses = [];
    for (let i = 11; i >= 0; i--) meses.push(new Date(Date.UTC(ano, mes - 1 - i, 1)).toISOString().slice(0, 7));
    const porMes = Object.fromEntries(meses.map(m => [m, 0]));
    for (const d of DB.dividendos) {
        if (!cids.has(d.carteira_id)) continue;
        const m = d.data_pagamento.slice(0, 7);
        if (m in porMes) porMes[m] += Number(d.valor_total);
    }
    desenhar('g-proventos', {
        type: 'bar',
        data: {
            labels: meses.map(m => m.slice(5) + '/' + m.slice(2, 4)),
            datasets: [{ data: meses.map(m => +porMes[m].toFixed(2)), backgroundColor: '#3FB97A', borderRadius: 4 }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => brl.format(c.raw) } } },
            scales: { x: { grid: { display: false } }, y: { ticks: { callback: brlCurto } } }
        }
    });
}

// ====================================================================
// EVOLUÇÃO: tabela de ativos (soma o mesmo ativo das carteiras filtradas)
// ====================================================================
let ordemAtivos = { campo: 'valor', desc: true };

document.addEventListener('click', (e) => {
    const th = e.target.closest('.tabela-ativos th[data-ordenar]');
    if (!th) return;
    const campo = th.dataset.ordenar;
    ordemAtivos = ordemAtivos.campo === campo ? { campo, desc: !ordemAtivos.desc } : { campo, desc: campo !== 'ticker' };
    renderEvolucao();
});

// Minigráfico: preço de fechamento de cada dia salvo no período (+ cotação atual) contra a linha do preço médio
function sparkline(precos, pm, W = 150, H = 34) {
    if (precos.length < 2) return '<span class="sutil">—</span>';
    const P = 3;
    const min = Math.min(pm, ...precos), max = Math.max(pm, ...precos);
    const amp = max - min || 1;
    const x = (i) => P + i * (W - 2 * P) / (precos.length - 1);
    const y = (v) => H - P - (v - min) / amp * (H - 2 * P);
    const pontos = precos.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    const ult = precos.at(-1);
    const cor = ult >= pm ? '#4CC98A' : '#F2737B';
    const desc = `Preço foi de ${num(precos[0])} para ${num(ult)}; preço médio ${num(pm)}`;
    return `<svg class="spark" viewBox="0 0 ${W} ${H}" role="img" aria-label="${desc}">
        <line x1="${P}" x2="${W - P}" y1="${y(pm).toFixed(1)}" y2="${y(pm).toFixed(1)}" stroke="#8B95A3" stroke-width="1" stroke-dasharray="3 3"></line>
        <polyline points="${pontos}" fill="none" stroke="${cor}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"></polyline>
        <circle cx="${x(precos.length - 1).toFixed(1)}" cy="${y(ult).toFixed(1)}" r="2.6" fill="${cor}"></circle>
    </svg>`;
}

function renderTabelaAtivos(cids, R) {
    // consolida por ativo
    const mapa = new Map();
    for (const p of calcularPosicoes().values()) {
        if (!cids.has(p.carteira_id) || p.qtd <= 0) continue;
        const a = ativoDe(p.ativo_id);
        const g = mapa.get(p.ativo_id) || { a, ticker: a?.ticker || '', qtd: 0, custo: 0 };
        g.qtd += p.qtd; g.custo += p.custo;
        mapa.set(p.ativo_id, g);
    }
    const datasVis = R.base.datas.slice(R.ini);
    const linhas = [...mapa.values()].map(g => {
        const cot = COTACOES[normTicker(g.ticker)];
        const pm = g.custo / g.qtd;
        const cotacao = cot ? cot.preco : null;
        const valor = g.qtd * (cotacao ?? pm);
        const rend = valor - g.custo;
        const precos = datasVis.map(d => R.base.precosPorData.get(d)?.[normTicker(g.ticker)]).filter(v => v != null);
        return { ...g, pm, cotacao, dia: cot ? cot.variacao : null, valor, rend, rendPct: g.custo > 0 ? rend / g.custo * 100 : 0, precos };
    });

    const { campo, desc } = ordemAtivos;
    linhas.sort((x, y) => {
        const vx = x[campo] ?? -Infinity, vy = y[campo] ?? -Infinity;
        const c = typeof vx === 'string' ? vx.localeCompare(vy) : vx - vy;
        return desc ? -c : c;
    });
    document.querySelectorAll('.tabela-ativos th[data-ordenar]').forEach(th => {
        if (th.dataset.ordenar === campo) th.setAttribute('aria-sort', desc ? 'descending' : 'ascending');
        else th.removeAttribute('aria-sort');
    });

    const maxAbs = Math.max(...linhas.map(l => Math.abs(l.rendPct)), 1);
    const sinal = (v) => (v > 0.004 ? '+' : v < -0.004 ? '−' : '') + num(Math.abs(v));
    $('tb-evol-ativos').innerHTML = linhas.map(l => {
        const larg = Math.min(50, Math.abs(l.rendPct) / maxAbs * 50);
        const barra = `<span class="rend-barra"><i style="${l.rendPct >= 0 ? 'left:50%' : 'right:50%'};width:${larg.toFixed(1)}%;background:${l.rendPct >= 0 ? '#3FB97A' : '#F2737B'}"></i></span>`;
        return `<tr>
            <td><strong>${esc(l.ticker)}</strong><span class="ativo-nome">${esc(l.a?.nome || '')}</span></td>
            <td class="num">${qtdFmt(l.qtd)}</td>
            <td class="num">${num(l.pm)}</td>
            <td class="num">${num(l.custo)}</td>
            <td class="num">${l.cotacao != null ? num(l.cotacao) : '—'}</td>
            <td class="num ${classe(l.dia)}">${l.dia != null ? `<span class="seta-dia">${seta(l.dia)}${pct(l.dia)}</span>` : '—'}</td>
            <td class="num">${num(l.valor)}${l.cotacao == null ? ' <span class="sutil" title="Sem cotação: usando o preço médio">*</span>' : ''}</td>
            <td class="num ${classe(l.rend)}">${sinal(l.rend)}</td>
            <td class="num ${classe(l.rendPct)}">${pct(l.rendPct)}${barra}</td>
            <td>${sparkline(l.precos, l.pm)}</td>
        </tr>`;
    }).join('') || '<tr><td colspan="10" class="vazio">Nenhum ativo em posição nas carteiras selecionadas.</td></tr>';

    const tCusto = linhas.reduce((s, l) => s + l.custo, 0), tValor = linhas.reduce((s, l) => s + l.valor, 0);
    const tRend = tValor - tCusto, tPct = tCusto > 0 ? tRend / tCusto * 100 : 0;
    $('tf-evol-ativos').innerHTML = !linhas.length ? '' : `<tr>
        <td>Total (${linhas.length} ativo${linhas.length > 1 ? 's' : ''})</td><td></td><td></td>
        <td class="num">${num(tCusto)}</td><td></td><td></td>
        <td class="num">${num(tValor)}</td>
        <td class="num ${classe(tRend)}">${sinal(tRend)}</td>
        <td class="num ${classe(tPct)}">${pct(tPct)}</td><td></td>
    </tr>`;

    // ---------- celular: cartões ----------
    $('ordem-ativos-cel').value = `${campo}|${desc ? 'desc' : 'asc'}`;
    const cel = (rot, val, cls = '') => `<div><span>${rot}</span><strong class="${cls}">${val}</strong></div>`;
    $('m-evol-ativos').innerHTML = linhas.map(l => `
        <article class="ativo-card">
            <div class="ac-topo">
                <div class="ac-nome"><strong>${esc(l.ticker)}</strong><small>${esc(l.a?.nome || '')}</small></div>
                <div class="ac-rend ${classe(l.rendPct)}">
                    <strong>${seta(l.rendPct)}${pct(l.rendPct)}</strong>
                    <small>${sinal(l.rend)}</small>
                </div>
            </div>
            <div class="ac-spark">${sparkline(l.precos, l.pm, 320, 44)}</div>
            <div class="ac-grade">
                ${cel('Quant.', qtdFmt(l.qtd))}
                ${cel('Preço médio', num(l.pm))}
                ${cel('Cotação', l.cotacao != null ? num(l.cotacao) : '—')}
                ${cel('Investido', num(l.custo))}
                ${cel('Valor atual', num(l.valor) + (l.cotacao == null ? '*' : ''))}
                ${cel('Dia', l.dia != null ? seta(l.dia) + pct(l.dia) : '—', classe(l.dia))}
            </div>
        </article>`).join('') || '<p class="sutil">Nenhum ativo em posição nas carteiras selecionadas.</p>';
    if (linhas.length) {
        $('m-evol-ativos').innerHTML += `
        <div class="ativo-card total">
            <div class="ac-topo">
                <div class="ac-nome"><strong>Total</strong><small>${linhas.length} ativo${linhas.length > 1 ? 's' : ''} · investido ${brl.format(tCusto)}</small></div>
                <div class="ac-rend ${classe(tPct)}"><strong>${seta(tPct)}${pct(tPct)}</strong><small>${sinal(tRend)}</small></div>
            </div>
            <div class="ac-grade dois">${cel('Valor atual', brl.format(tValor))}${cel('Rendimento', sinal(tRend), classe(tRend))}</div>
        </div>`;
    }
}

$('ordem-ativos-cel').addEventListener('change', (e) => {
    const [campo, sentido] = e.target.value.split('|');
    ordemAtivos = { campo, desc: sentido === 'desc' };
    renderEvolucao();
});

function opcoesLinha(fmtEixo, rotulosLongos, fmtDica = fmtEixo, legenda = true) {
    return {
        responsive: true, maintainAspectRatio: false, spanGaps: true,
        interaction: { mode: 'index', intersect: false },
        plugins: {
            legend: { display: legenda, labels: { color: '#A9B2BE', boxWidth: 12, boxHeight: 3 } },
            tooltip: { backgroundColor: '#11151B', borderColor: '#34404D', borderWidth: 1, padding: 10, callbacks: {
                title: (itens) => rotulosLongos[itens[0].dataIndex],
                label: (c) => ` ${c.dataset.label}: ${c.raw == null ? '—' : fmtDica(c.raw)}`
            } }
        },
        scales: {
            x: { ticks: { maxRotation: 0, autoSkipPadding: 16 }, grid: { display: false } },
            y: { ticks: { callback: fmtEixo } }
        }
    };
}

function desenhar(id, config) {
    if (GRAFICOS[id]) GRAFICOS[id].destroy();
    GRAFICOS[id] = new Chart($(id), config);
}

// ====================================================================
// BUSCA DE ATIVO (autocomplete) — usada em Ordens e Proventos
// ====================================================================
function adivinharTipo(ticker, nome = '') {
    const n = nome.toUpperCase();
    if (/\d{2}$/.test(ticker) && /^(3[2-5]|39)$/.test(ticker.slice(-2))) return 'BDR';
    if (/ETF|ÍNDICE|INDICE|ISHARES/.test(n)) return 'ETF';
    if (/FII|FUNDO|IMOBILI/.test(n)) return 'FII';
    if (ticker.endsWith('11') && !n) return 'FII';
    return 'ACAO';
}

async function cadastrarAtivoRapido(ticker) {
    let nome = null, tipo;
    try {   // tenta pegar o nome na brapi (se falhar, cadastra só com o ticker)
        const r = await consultarBrapi(ticker);
        nome = r.longName || r.shortName || null;
    } catch { /* sem token ou ticker inválido */ }
    tipo = adivinharTipo(ticker, nome || '');
    const { data, error } = await sb.from('ativos').insert({ ticker, nome, tipo }).select().single();
    if (error) { alert('Erro ao cadastrar ativo: ' + error.message); return null; }
    DB.ativos.push(data);
    DB.ativos.sort((a, b) => a.ticker.localeCompare(b.ticker));
    renderAtivos();
    return data;
}

function ligarBuscaAtivo(prefixo, aoSelecionar) {
    const input = $(prefixo + '-ativo-busca');
    const oculto = $(prefixo + '-ativo');
    const caixa = input.parentElement.querySelector('.sugestoes');
    let itens = [], sel = -1;

    const fechar = () => { caixa.classList.add('oculto'); sel = -1; };
    const escolher = async (item) => {
        let a = item.ativo;
        if (item.novo) {
            caixa.innerHTML = '<div>Cadastrando…</div>';
            a = await cadastrarAtivoRapido(item.novo);
            if (!a) return;
        }
        oculto.value = a.id;
        input.value = a.ticker + (a.nome ? ' — ' + a.nome : '');
        fechar();
        aoSelecionar && aoSelecionar(a);
    };
    const desenharLista = () => {
        caixa.innerHTML = itens.map((it, i) => it.novo
            ? `<div class="novo ${i === sel ? 'sel' : ''}" data-i="${i}">+ Cadastrar <strong>${esc(it.novo)}</strong> como novo ativo</div>`
            : `<div class="${i === sel ? 'sel' : ''}" data-i="${i}"><strong>${esc(it.ativo.ticker)}</strong><small>${esc(it.ativo.nome || TIPOS_ATIVO[it.ativo.tipo])}</small></div>`
        ).join('');
        caixa.classList.toggle('oculto', !itens.length);
    };
    const filtrar = () => {
        const termo = input.value.trim().toUpperCase();
        const t = normTicker(termo.split(' — ')[0]);
        if (!termo) { itens = DB.ativos.slice(0, 12).map(ativo => ({ ativo })); sel = -1; desenharLista(); return; }
        const comeca = DB.ativos.filter(a => a.ticker.startsWith(t));
        const contem = DB.ativos.filter(a => !a.ticker.startsWith(t) &&
            (a.ticker.includes(t) || (a.nome || '').toUpperCase().includes(termo)));
        itens = [...comeca, ...contem].slice(0, 12).map(ativo => ({ ativo }));
        if (/^[A-Z0-9]{4,12}$/.test(t) && !DB.ativos.some(a => a.ticker === t)) itens.push({ novo: t });
        sel = itens.length ? 0 : -1;
        desenharLista();
    };

    input.addEventListener('input', () => { oculto.value = ''; filtrar(); });
    input.addEventListener('focus', filtrar);
    input.addEventListener('keydown', (e) => {
        if (caixa.classList.contains('oculto')) return;
        if (e.key === 'ArrowDown') { sel = Math.min(sel + 1, itens.length - 1); desenharLista(); e.preventDefault(); }
        else if (e.key === 'ArrowUp') { sel = Math.max(sel - 1, 0); desenharLista(); e.preventDefault(); }
        else if (e.key === 'Enter' && sel >= 0) { e.preventDefault(); escolher(itens[sel]); }
        else if (e.key === 'Escape') fechar();
    });
    caixa.addEventListener('mousedown', (e) => {   // mousedown: acontece antes do blur
        const d = e.target.closest('[data-i]');
        if (d) { e.preventDefault(); escolher(itens[Number(d.dataset.i)]); }
    });
    input.addEventListener('blur', () => setTimeout(() => {
        fechar();
        if (!oculto.value) {   // digitou o ticker exato e saiu do campo: seleciona sozinho
            const t = normTicker(input.value.split(' — ')[0]);
            const a = DB.ativos.find(x => x.ticker === t);
            if (a) escolher({ ativo: a });
        }
    }, 150));

    return {
        definir: (ativoId) => {
            const a = ativoDe(ativoId);
            oculto.value = a ? a.id : '';
            input.value = a ? a.ticker + (a.nome ? ' — ' + a.nome : '') : '';
        },
        limpar: () => { oculto.value = ''; input.value = ''; }
    };
}

const buscaOrdem = ligarBuscaAtivo('ordem', () => { atualizarInfoOrdem(); $('ordem-qtd').focus(); });
const buscaProvento = ligarBuscaAtivo('provento', () => $('provento-valor').focus());

// ====================================================================
// TELA: ORDENS
// ====================================================================
['ordem-qtd', 'ordem-preco', 'ordem-taxas', 'ordem-tipo'].forEach(id => $(id).addEventListener('input', atualizarTotalOrdem));
['ordem-carteira', 'ordem-data', 'ordem-tipo'].forEach(id => $(id).addEventListener('change', atualizarInfoOrdem));
$('filtro-carteira-ordens').addEventListener('change', renderOrdens);
$('filtro-ativo-ordens').addEventListener('input', renderOrdens);

function atualizarTotalOrdem() {
    const q = Number($('ordem-qtd').value || 0), p = Number($('ordem-preco').value || 0), tx = Number($('ordem-taxas').value || 0);
    const total = $('ordem-tipo').value === 'C' ? q * p + tx : q * p - tx;
    $('ordem-total').value = q && p ? brl.format(total) : '';
}

function atualizarInfoOrdem() {
    const cid = $('ordem-carteira').value, aid = $('ordem-ativo').value;
    if (!cid || !aid) { $('ordem-info').textContent = ''; return; }
    const pos = calcularPosicoes($('ordem-data').value || null, $('ordem-id').value || null).get(cid + '|' + aid);
    const a = ativoDe(aid);
    const cot = COTACOES[normTicker(a?.ticker)];
    const partes = [];
    partes.push(pos && pos.qtd > 0
        ? `Posição nesta carteira na data: ${qtdFmt(pos.qtd)} · PM ${brl.format(pos.pm)}`
        : 'Sem posição deste ativo nesta carteira na data.');
    if (cot) partes.push(`Cotação atual ${brl.format(cot.preco)}`);
    $('ordem-info').textContent = partes.join(' · ');
    if (!$('ordem-preco').value && cot && !$('ordem-id').value) { $('ordem-preco').value = cot.preco; atualizarTotalOrdem(); }
}

function renderOrdens() {
    const fc = $('filtro-carteira-ordens').value;
    const fa = normTicker($('filtro-ativo-ordens').value);
    const lista = [...DB.ordens].reverse().filter(o =>
        (!fc || o.carteira_id === fc) && (!fa || (ativoDe(o.ativo_id)?.ticker || '').includes(fa)));
    $('tb-ordens').innerHTML = lista.map(o => {
        const a = ativoDe(o.ativo_id);
        const bruto = Number(o.quantidade) * Number(o.preco), tx = Number(o.taxas || 0);
        const total = o.tipo === 'C' ? bruto + tx : bruto - tx;
        return `<tr>
            <td>${dataBR(o.data_ordem)}</td><td>${esc(carteiraDe(o.carteira_id)?.nome)}</td>
            <td><strong>${esc(a?.ticker)}</strong></td>
            <td class="${o.tipo === 'C' ? 'lucro' : 'prejuizo'}">${o.tipo === 'C' ? 'Compra' : 'Venda'}</td>
            <td class="num">${qtdFmt(o.quantidade)}</td><td class="num">${brl.format(o.preco)}</td>
            <td class="num">${brl.format(tx)}</td><td class="num">${brl.format(total)}</td>
            ${botoes('ordens', o.id)}
        </tr>`;
    }).join('') || '<tr><td colspan="9" class="vazio">Nenhuma ordem.</td></tr>';
}

// ====================================================================
// TELA: PROVENTOS
// ====================================================================
function renderProventos() {
    const nomes = { DIVIDENDO: 'Dividendo', JCP: 'JCP', RENDIMENTO: 'Rendimento' };
    $('tb-proventos').innerHTML = DB.dividendos.map(d => `<tr>
        <td>${dataBR(d.data_pagamento)}</td><td>${esc(carteiraDe(d.carteira_id)?.nome)}</td>
        <td><strong>${esc(ativoDe(d.ativo_id)?.ticker)}</strong></td><td>${nomes[d.tipo] || d.tipo}</td>
        <td class="num lucro">${brl.format(d.valor_total)}</td>${botoes('dividendos', d.id)}
    </tr>`).join('') || '<tr><td colspan="6" class="vazio">Nenhum provento lançado.</td></tr>';
}

// ====================================================================
// TELAS: ATIVOS e CARTEIRAS
// ====================================================================
function renderAtivos() {
    const nOrdens = {};
    for (const o of DB.ordens) nOrdens[o.ativo_id] = (nOrdens[o.ativo_id] || 0) + 1;
    $('tb-ativos').innerHTML = DB.ativos.map(a => {
        const cot = COTACOES[a.ticker];
        return `<tr>
            <td><strong>${esc(a.ticker)}</strong></td><td>${esc(a.nome)}</td><td>${TIPOS_ATIVO[a.tipo] || a.tipo}</td>
            <td class="num">${cot ? brl.format(cot.preco) : '—'}</td><td class="num">${nOrdens[a.id] || 0}</td>
            ${botoes('ativos', a.id)}
        </tr>`;
    }).join('') || '<tr><td colspan="6" class="vazio">Nenhum ativo cadastrado.</td></tr>';
}

function renderCarteiras() {
    const pos = [...calcularPosicoes().values()];
    $('tb-carteiras').innerHTML = DB.carteiras.map(c => {
        const minhas = pos.filter(p => p.carteira_id === c.id && p.qtd > 0);
        const patrimonio = minhas.reduce((s, p) => s + p.qtd * (COTACOES[normTicker(ativoDe(p.ativo_id)?.ticker)]?.preco ?? p.pm), 0);
        const nFech = DB.fechamentos.filter(f => f.carteira_id === c.id).length;
        return `<tr>
            <td><strong>${esc(c.nome)}</strong></td><td>${esc(c.descricao)}</td>
            <td class="num">${minhas.length}</td><td class="num">${brl.format(patrimonio)}</td><td class="num">${nFech}</td>
            ${botoes('carteiras', c.id)}
        </tr>`;
    }).join('') || '<tr><td colspan="6" class="vazio">Nenhuma carteira.</td></tr>';
}

$('btn-buscar-nome').addEventListener('click', async () => {
    const t = normTicker($('ativo-ticker').value);
    if (!t) { alert('Informe o ticker.'); return; }
    $('btn-buscar-nome').disabled = true;
    try {
        const r = await consultarBrapi(t);
        $('ativo-nome').value = r.longName || r.shortName || '';
        $('ativo-tipo').value = adivinharTipo(t, $('ativo-nome').value);
    } catch (err) {
        alert('Não encontrei na brapi: ' + err.message + (lerLocal(CHAVE_TOKEN, '') ? '' : '\n(Sem token só funcionam PETR4, VALE3, MGLU3 e ITUB4.)'));
    } finally {
        $('btn-buscar-nome').disabled = false;
    }
});

// ====================================================================
// SELECTS DE CARTEIRA
// ====================================================================
function preencherSelects() {
    desenharFiltroCarteira();
    const op = DB.carteiras.map(c => `<option value="${c.id}">${esc(c.nome)}</option>`).join('');
    document.querySelectorAll('.sel-carteira-todas').forEach(s => {
        const v = s.value;
        s.innerHTML = '<option value="">Todas</option>' + op;
        s.value = DB.carteiras.some(c => c.id === v) ? v : '';
    });
    document.querySelectorAll('.sel-carteira').forEach(s => {
        const v = s.value;
        s.innerHTML = op;
        if (DB.carteiras.some(c => c.id === v)) s.value = v;
    });
    if (!$('ordem-data').value) $('ordem-data').value = hojeSP();
    if (!$('provento-data').value) $('provento-data').value = hojeSP();
}

// ====================================================================
// FORMULÁRIOS (inserir / editar)
// ====================================================================
const MSG_ERRO = {
    '23505': 'já existe um registro com esse nome/ticker.',
    '23503': 'este registro está em uso (ex.: ativo com ordens ou proventos). Exclua os lançamentos dele antes.'
};
const traduzErro = (e) => MSG_ERRO[e.code] || e.message;

const FORMS = {
    ativo: {
        tabela: 'ativos', novo: 'Novo ativo', editando: 'Editando ativo',
        ler: () => ({ ticker: normTicker($('ativo-ticker').value), nome: $('ativo-nome').value.trim() || null, tipo: $('ativo-tipo').value }),
        preencher: (r) => { $('ativo-ticker').value = r.ticker; $('ativo-nome').value = r.nome || ''; $('ativo-tipo').value = r.tipo; },
        limpar: () => { $('ativo-ticker').value = ''; $('ativo-nome').value = ''; $('ativo-tipo').value = 'ACAO'; }
    },
    carteira: {
        tabela: 'carteiras', novo: 'Nova carteira', editando: 'Editando carteira',
        ler: () => ({ nome: $('carteira-nome').value.trim(), descricao: $('carteira-descricao').value.trim() || null }),
        preencher: (r) => { $('carteira-nome').value = r.nome; $('carteira-descricao').value = r.descricao || ''; },
        limpar: () => { $('carteira-nome').value = ''; $('carteira-descricao').value = ''; }
    },
    ordem: {
        tabela: 'ordens', novo: 'Nova ordem', editando: 'Editando ordem',
        ler: () => ({
            carteira_id: $('ordem-carteira').value, ativo_id: $('ordem-ativo').value, tipo: $('ordem-tipo').value,
            data_ordem: $('ordem-data').value, quantidade: Number($('ordem-qtd').value),
            preco: Number($('ordem-preco').value), taxas: Number($('ordem-taxas').value || 0)
        }),
        preencher: (r) => {
            $('ordem-carteira').value = r.carteira_id; buscaOrdem.definir(r.ativo_id); $('ordem-tipo').value = r.tipo;
            $('ordem-data').value = r.data_ordem; $('ordem-qtd').value = r.quantidade;
            $('ordem-preco').value = r.preco; $('ordem-taxas').value = r.taxas;
            atualizarTotalOrdem(); atualizarInfoOrdem();
        },
        limpar: () => {   // mantém carteira e data para lançar várias ordens seguidas
            buscaOrdem.limpar(); $('ordem-qtd').value = ''; $('ordem-preco').value = ''; $('ordem-taxas').value = 0;
            $('ordem-total').value = ''; $('ordem-info').textContent = '';
        }
    },
    provento: {
        tabela: 'dividendos', novo: 'Novo provento', editando: 'Editando provento',
        ler: () => ({
            carteira_id: $('provento-carteira').value, ativo_id: $('provento-ativo').value, tipo: $('provento-tipo').value,
            data_pagamento: $('provento-data').value, valor_total: Number($('provento-valor').value)
        }),
        preencher: (r) => {
            $('provento-carteira').value = r.carteira_id; buscaProvento.definir(r.ativo_id); $('provento-tipo').value = r.tipo;
            $('provento-data').value = r.data_pagamento; $('provento-valor').value = r.valor_total;
        },
        limpar: () => { buscaProvento.limpar(); $('provento-valor').value = ''; }
    }
};

function cancelarEdicao(nome) {
    $(nome + '-id').value = '';
    $('titulo-form-' + nome).textContent = FORMS[nome].novo;
    FORMS[nome].limpar();
}

for (const nome of Object.keys(FORMS)) {
    $('form-' + nome).addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = FORMS[nome];
        const dados = f.ler();
        const id = $(nome + '-id').value || null;

        if ((nome === 'ordem' || nome === 'provento')) {
            if (!dados.carteira_id) { alert('Cadastre antes uma carteira.'); return; }
            if (!dados.ativo_id) { alert('Selecione o ativo na lista (ou use "+ Cadastrar").'); $(nome + '-ativo-busca').focus(); return; }
        }
        if (nome === 'ordem' && dados.tipo === 'V') {
            const p = calcularPosicoes(dados.data_ordem, id).get(dados.carteira_id + '|' + dados.ativo_id);
            if (!p || dados.quantidade > p.qtd + 1e-9) {
                alert(`Venda de ${qtdFmt(dados.quantidade)} é maior que a posição desta carteira em ${dataBR(dados.data_ordem)} ` +
                      `(${qtdFmt(p?.qtd || 0)}).\nConfira a carteira, a data ou lance antes a compra.`);
                return;
            }
        }

        const { error } = id ? await sb.from(f.tabela).update(dados).eq('id', id) : await sb.from(f.tabela).insert(dados);
        if (error) { alert('Erro ao salvar: ' + traduzErro(error)); return; }
        cancelarEdicao(nome);
        await recarregarTudo(false);
        if (nome === 'ordem') $('ordem-ativo-busca').focus();
    });
}
document.querySelectorAll('[data-cancelar]').forEach(b => b.addEventListener('click', () => cancelarEdicao(b.dataset.cancelar)));

// ---------- editar / excluir (botões nas tabelas) ----------
const TABELA_FORM = { ativos: 'ativo', carteiras: 'carteira', ordens: 'ordem', dividendos: 'provento' };
const botoes = (tabela, id) =>
    `<td class="num"><button class="btn-mini" data-editar="${tabela}" data-id="${id}">Editar</button>` +
    `<button class="btn-mini perigo" data-excluir="${tabela}" data-id="${id}">Excluir</button></td>`;

document.addEventListener('click', async (e) => {
    const bEd = e.target.closest('[data-editar]');
    const bEx = e.target.closest('[data-excluir]');

    if (bEd) {
        const tabela = bEd.dataset.editar, nome = TABELA_FORM[tabela];
        const reg = DB[tabela].find(r => r.id === bEd.dataset.id);
        if (!reg) return;
        $(nome + '-id').value = reg.id;
        $('titulo-form-' + nome).textContent = FORMS[nome].editando;
        FORMS[nome].preencher(reg);
        $('form-' + nome).scrollIntoView({ behavior: 'smooth' });
    }

    if (bEx) {
        const tabela = bEx.dataset.excluir;
        let msg = 'Excluir este registro?';
        if (tabela === 'carteiras') msg = 'Excluir a carteira apaga TAMBÉM as ordens, proventos e fechamentos dela. Continuar?';
        if (!confirm(msg)) return;
        const { error } = await sb.from(tabela).delete().eq('id', bEx.dataset.id);
        if (error) { alert('Erro ao excluir: ' + traduzErro(error)); return; }
        await recarregarTudo(false);
    }
});

// ====================================================================
// CONFIGURAÇÕES
// ====================================================================
$('cfg-token').value = lerLocal(CHAVE_TOKEN, '');
$('form-config').addEventListener('submit', async (e) => {
    e.preventDefault();
    gravarLocal(CHAVE_TOKEN, $('cfg-token').value.trim());
    gravarLocal(CHAVE_CACHE, {});
    alert('Token salvo neste navegador.');
    await recarregarTudo(true);
});
$('btn-limpar-cache').addEventListener('click', () => {
    gravarLocal(CHAVE_CACHE, {});
    alert('Cache limpo. Clique em "Atualizar Cotações".');
});
