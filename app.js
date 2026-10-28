// ====================================================================
// app.js — Portal de Ações v2 (Supabase + GitHub Pages)
// --------------------------------------------------------------------
//  Cadastros: Ativos, Carteiras · Lançamentos: Ordens, Proventos
//  Posição calculada a partir das ordens (preço médio padrão Receita)
//  Fechamento diário por carteira gravado no banco + gráficos de evolução
// ====================================================================
const sb = window.supabase.createClient(APP_CONFIG.SUPABASE_URL, APP_CONFIG.SUPABASE_KEY);

// ---------------- utilitários ----------------
const $ = (id) => document.getElementById(id);
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const num = (v, d = 2) => Number(v).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
const qtdFmt = (v) => Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 4 });
const pct = (v) => (v >= 0 ? '+' : '') + num(v) + '%';
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
    posicao: 'Posição', evolucao: 'Evolução das Carteiras', ordens: 'Ordens', proventos: 'Proventos',
    ativos: 'Ativos', carteiras: 'Carteiras', config: 'Configurações'
};
let abaAtual = 'posicao';

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
$('btn-sair').addEventListener('click', () => sb.auth.signOut());

sb.auth.onAuthStateChange((_evento, sessao) => {
    if (sessao) {
        $('tela-login').classList.add('oculto');
        $('tela-app').classList.remove('oculto');
        $('usuario-email').textContent = sessao.user.email;
        setTimeout(() => recarregarTudo(false), 0);
    } else {
        $('tela-app').classList.add('oculto');
        $('tela-login').classList.remove('oculto');
    }
});

// ====================================================================
// NAVEGAÇÃO
// ====================================================================
document.querySelectorAll('.sidebar a[data-aba]').forEach(a => a.addEventListener('click', (e) => {
    e.preventDefault();
    mostrarAba(a.dataset.aba);
}));

function mostrarAba(aba) {
    abaAtual = aba;
    document.querySelectorAll('.aba-conteudo').forEach(el => el.classList.remove('ativa'));
    document.querySelectorAll('.sidebar a[data-aba]').forEach(el => el.classList.toggle('ativo', el.dataset.aba === aba));
    $('aba-' + aba).classList.add('ativa');
    $('titulo-pagina').textContent = TITULOS[aba];
    if (aba === 'evolucao') renderEvolucao();   // gráfico precisa estar visível para medir o tamanho
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
        preencherSelects();
        await atualizarCotacoes(forcarCotacao);
        await salvarFechamentos();
        renderTudo();
    } catch (err) {
        console.error(err);
        aviso('Erro ao acessar o banco: ' + (err.message || err));
    } finally {
        btn.disabled = false;
    }
}

function renderTudo() {
    renderPosicao();
    renderOrdens();
    renderProventos();
    renderAtivos();
    renderCarteiras();
    atualizarInfoOrdem();
    if (abaAtual === 'evolucao') renderEvolucao();
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
    const res = await fetch(url);
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
    const tickers = tickersEmUso();
    const pendentes = tickers.filter(t => forcar || !cache[t] || Date.now() - cache[t].em > intervaloAutoMs());
    const falhas = [];

    for (let i = 0; i < pendentes.length; i += 4) {          // até 4 consultas em paralelo
        const lote = pendentes.slice(i, i + 4);
        const resp = await Promise.allSettled(lote.map(buscarCotacao));
        resp.forEach((r, k) => {
            if (r.status === 'fulfilled') cache[lote[k]] = r.value;
            else falhas.push(lote[k]);
        });
    }
    gravarLocal(CHAVE_CACHE, cache);
    COTACOES = cache;
    atualizarInfoCotacao();

    if (falhas.length) {
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

function atualizarInfoCotacao() {
    const horarios = tickersEmUso().map(t => COTACOES[t]?.em).filter(Boolean);
    if (!horarios.length) { $('info-cotacao').textContent = ''; return; }
    const hora = (ms) => new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
    const maisAntiga = Math.min(...horarios);
    $('info-cotacao').textContent = janelaAutomatica()
        ? `Cotações de ${hora(maisAntiga)} · próxima ~${hora(maisAntiga + intervaloAutoMs())} (automática)`
        : `Cotações de ${hora(maisAntiga)} · pregão fechado`;
}

let autoRodando = false;
async function cicloAutomatico() {
    if (autoRodando || document.hidden || $('tela-app').classList.contains('oculto') || !DB.ordens.length) return;
    if (!janelaAutomatica()) { atualizarInfoCotacao(); return; }
    autoRodando = true;
    try {
        await atualizarCotacoes(false);       // só busca o que venceu
        await salvarFechamentos();
        renderPosicao();
        renderAtivos();
        renderCarteiras();
        if (abaAtual === 'evolucao') renderEvolucao();
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
// TELA: POSIÇÃO
// ====================================================================
$('filtro-carteira-posicao').addEventListener('change', renderPosicao);
$('mostrar-zeradas').addEventListener('change', renderPosicao);

function precoAtual(ticker, pm) {
    const c = COTACOES[normTicker(ticker)];
    return c ? c.preco : null;
}

function renderPosicao() {
    const filtro = $('filtro-carteira-posicao').value;
    const zeradas = $('mostrar-zeradas').checked;
    const lista = [...calcularPosicoes().values()]
        .filter(p => !filtro || p.carteira_id === filtro)
        .filter(p => zeradas || p.qtd > 0);

    const nomeCart = (p) => carteiraDe(p.carteira_id)?.nome || '';
    const tick = (p) => ativoDe(p.ativo_id)?.ticker || '';
    lista.sort((x, y) => (nomeCart(x) + tick(x)).localeCompare(nomeCart(y) + tick(y)));

    // total por carteira para a coluna "% Cart."
    const totCart = {};
    for (const p of lista) {
        const pa = precoAtual(tick(p));
        totCart[p.carteira_id] = (totCart[p.carteira_id] || 0) + p.qtd * (pa ?? p.pm);
    }

    let tCusto = 0, tAtual = 0, tProv = 0, tReal = 0, semCotacao = false;
    const linhas = lista.map(p => {
        const t = tick(p);
        const cot = COTACOES[normTicker(t)];
        const valorAtual = cot ? p.qtd * cot.preco : null;
        const resultado = valorAtual != null ? valorAtual - p.custo : null;
        const rent = resultado != null && p.custo > 0 ? (resultado / p.custo) * 100 : null;
        const part = totCart[p.carteira_id] ? (p.qtd * (cot?.preco ?? p.pm)) / totCart[p.carteira_id] * 100 : 0;

        tCusto += p.custo; tProv += p.proventos; tReal += p.realizado;
        if (valorAtual != null) tAtual += valorAtual; else if (p.qtd > 0) { semCotacao = true; tAtual += p.custo; }

        const alerta = p.alerta ? ' <span title="Existe venda maior que a posição na data — confira as ordens">⚠️</span>' : '';
        return `<tr class="${p.qtd === 0 ? 'zerada' : ''}">
            <td>${esc(nomeCart(p))}</td>
            <td><strong>${esc(t)}</strong>${alerta}</td>
            <td class="num">${qtdFmt(p.qtd)}</td>
            <td class="num">${p.qtd ? brl.format(p.pm) : '—'}</td>
            <td class="num">${cot ? brl.format(cot.preco) : '—'}</td>
            <td class="num ${cot ? classe(cot.variacao) : ''}">${cot ? pct(cot.variacao) : '—'}</td>
            <td class="num">${brl.format(p.custo)}</td>
            <td class="num">${valorAtual != null ? brl.format(valorAtual) : '—'}</td>
            <td class="num ${classe(resultado)}">${resultado != null ? brl.format(resultado) : '—'}</td>
            <td class="num ${classe(rent)}">${rent != null ? pct(rent) : '—'}</td>
            <td class="num">${p.qtd ? num(part, 1) + '%' : '—'}</td>
            <td class="num lucro">${brl.format(p.proventos)}</td>
            <td class="num ${classe(p.realizado)}">${brl.format(p.realizado)}</td>
        </tr>`;
    });

    $('tb-posicao').innerHTML = linhas.join('') ||
        '<tr><td colspan="13" class="vazio">Nenhuma posição. Cadastre uma carteira, um ativo e lance uma ordem de compra.</td></tr>';

    const resNaoReal = tAtual - tCusto;
    const rentTotal = tCusto > 0 ? (resNaoReal / tCusto) * 100 : 0;
    $('resumo-posicao').innerHTML = `
        <div class="item"><span>Custo total</span><strong>${brl.format(tCusto)}</strong></div>
        <div class="item"><span>Valor atual${semCotacao ? ' (parcial)' : ''}</span><strong>${brl.format(tAtual)}</strong></div>
        <div class="item"><span>Resultado não realizado</span><strong class="${classe(resNaoReal)}">${brl.format(resNaoReal)}</strong><small class="${classe(rentTotal)}">${pct(rentTotal)}</small></div>
        <div class="item"><span>Proventos recebidos</span><strong class="lucro">${brl.format(tProv)}</strong></div>
        <div class="item"><span>Lucro realizado (vendas)</span><strong class="${classe(tReal)}">${brl.format(tReal)}</strong></div>`;
}

// ====================================================================
// TELA: EVOLUÇÃO
// ====================================================================
let periodoDias = 0;
const GRAFICOS = {};
const CORES = ['#4caf50', '#42a5f5', '#ffb74d', '#ab47bc', '#ef5350', '#26c6da', '#d4e157', '#8d6e63', '#ec407a', '#78909c'];

$('filtro-carteira-evolucao').addEventListener('change', renderEvolucao);
$('agrupar-alocacao').addEventListener('change', renderEvolucao);
document.querySelectorAll('#periodos button').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('#periodos button').forEach(x => x.classList.toggle('ativo', x === b));
    periodoDias = Number(b.dataset.periodo);
    renderEvolucao();
}));

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

function renderEvolucao() {
    if (abaAtual !== 'evolucao') return;
    if (typeof Chart === 'undefined') { aviso('Biblioteca de gráficos não carregou (verifique a internet).'); return; }

    const filtro = $('filtro-carteira-evolucao').value;
    const cartsEscopo = filtro ? DB.carteiras.filter(c => c.id === filtro) : DB.carteiras;
    const cidsEscopo = new Set(cartsEscopo.map(c => c.id));

    // datas com fechamento salvo
    const datasSet = new Set(DB.fechamentos.filter(f => cidsEscopo.has(f.carteira_id)).map(f => f.data));
    let datas = [...datasSet].sort();

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

    const serieTotal = montarSerie(cidsEscopo, datas, precosPorData, posPorData);

    // recorte do período
    let ini = 0;
    if (periodoDias > 0) {
        const corte = somaDias(hoje, -periodoDias);
        ini = serieTotal.findIndex(p => p.data === 'AGORA' || p.data >= corte);
        if (ini < 0) ini = serieTotal.length;
    }
    const visiveis = serieTotal.slice(ini);
    const rotulos = visiveis.map(p => p.data === 'AGORA' ? 'Agora' : dataBR(p.data).slice(0, 5));
    const rotulosLongos = visiveis.map(p => p.data === 'AGORA' ? 'Agora' : dataBR(p.data));

    // ---------- cards ----------
    // base da rentabilidade = cota no fechamento anterior ao período (ou 1 = preço pago, se o período começa no início)
    const cotaBase = (serie) => ini > 0 ? serie[ini - 1].cota : 1;
    const ult = visiveis.at(-1);
    const penult = visiveis.length > 1 ? visiveis.at(-2) : (ini > 0 ? serieTotal[ini - 1] : null);
    const rentPeriodo = ult ? (ult.cota / cotaBase(serieTotal) - 1) * 100 : 0;
    const provPeriodo = visiveis.reduce((s, p) => s + p.P, 0);
    const varDia = ult && penult ? ult.r * 100 : null;
    const varDiaRs = ult && penult ? ult.V + ult.P - penult.V - ult.F : null;
    const rotuloDia = ult?.data === 'AGORA' ? 'Hoje (desde o último fechamento)' : 'Último fechamento';

    $('resumo-evolucao').innerHTML = !visiveis.length
        ? '<div class="item"><span>Sem dados</span><strong>—</strong><small>Os fechamentos são gravados automaticamente a cada dia de pregão.</small></div>'
        : `<div class="item"><span>Patrimônio</span><strong>${brl.format(ult.V)}</strong></div>
           <div class="item"><span>Valor investido</span><strong>${brl.format(ult.I)}</strong></div>
           <div class="item"><span>Resultado em aberto</span><strong class="${classe(ult.V - ult.I)}">${brl.format(ult.V - ult.I)}</strong></div>
           <div class="item"><span>${rotuloDia}</span><strong class="${classe(varDia)}">${varDia != null ? pct(varDia) : '—'}</strong>
                <small class="${classe(varDiaRs)}">${varDiaRs != null ? brl.format(varDiaRs) : ''}</small></div>
           <div class="item"><span>Rentabilidade no período</span><strong class="${classe(rentPeriodo)}">${pct(rentPeriodo)}</strong>
                <small class="lucro">${provPeriodo ? 'proventos ' + brl.format(provPeriodo) : ''}</small></div>`;

    // ---------- gráfico: patrimônio x investido ----------
    desenhar('g-patrimonio', {
        type: 'line',
        data: {
            labels: rotulos,
            datasets: [
                { label: 'Patrimônio', data: visiveis.map(p => p.ativo ? +p.V.toFixed(2) : null), borderColor: CORES[0], backgroundColor: 'rgba(76,175,80,.12)', fill: true, tension: .25, pointRadius: 2 },
                { label: 'Valor investido', data: visiveis.map(p => p.ativo ? +p.I.toFixed(2) : null), borderColor: '#9e9e9e', borderDash: [6, 4], fill: false, stepped: true, pointRadius: 0 }
            ]
        },
        options: opcoesLinha(v => brl.format(v), rotulosLongos)
    });

    // ---------- gráfico: rentabilidade por carteira ----------
    const datasetsRent = [];
    const linhaRent = (serie, label, cor, tracejado) => {
        const s = serie.slice(ini);
        const base = cotaBase(serie);
        datasetsRent.push({
            label, borderColor: cor, backgroundColor: cor, tension: .25, pointRadius: 2, borderWidth: tracejado ? 3 : 2,
            borderDash: tracejado ? [6, 4] : [],
            data: s.map(p => p.ativo && base ? +((p.cota / base - 1) * 100).toFixed(2) : null)
        });
    };
    cartsEscopo.forEach((c, i) => linhaRent(montarSerie(new Set([c.id]), datas, precosPorData, posPorData), c.nome, CORES[i % CORES.length], false));
    if (cartsEscopo.length > 1) linhaRent(serieTotal, 'Total', '#ffffff', true);

    desenhar('g-rentabilidade', {
        type: 'line',
        data: { labels: rotulos, datasets: datasetsRent },
        options: opcoesLinha(v => num(v) + '%', rotulosLongos)
    });

    // ---------- gráfico: alocação atual ----------
    const agrupar = $('agrupar-alocacao').value;
    const grupos = {};
    for (const p of calcularPosicoes().values()) {
        if (!cidsEscopo.has(p.carteira_id) || p.qtd <= 0) continue;
        const a = ativoDe(p.ativo_id);
        const valor = p.qtd * (COTACOES[normTicker(a?.ticker)]?.preco ?? p.pm);
        const chave = agrupar === 'tipo' ? TIPOS_ATIVO[a?.tipo] || 'Outro'
                    : agrupar === 'carteira' ? carteiraDe(p.carteira_id)?.nome : a?.ticker;
        grupos[chave] = (grupos[chave] || 0) + valor;
    }
    const alocacao = Object.entries(grupos).sort((a, b) => b[1] - a[1]);
    const totalAloc = alocacao.reduce((s, x) => s + x[1], 0);
    desenhar('g-alocacao', {
        type: 'doughnut',
        data: {
            labels: alocacao.map(x => x[0]),
            datasets: [{ data: alocacao.map(x => +x[1].toFixed(2)), backgroundColor: alocacao.map((_, i) => CORES[i % CORES.length]), borderColor: '#1e1e1e', borderWidth: 2 }]
        },
        options: {
            responsive: true, maintainAspectRatio: false, cutout: '60%',
            plugins: {
                legend: { position: 'right', labels: { color: '#ccc', boxWidth: 12 } },
                tooltip: { callbacks: { label: (c) => `${c.label}: ${brl.format(c.raw)} (${num(c.raw / totalAloc * 100, 1)}%)` } }
            }
        }
    });

    // ---------- gráfico: proventos por mês ----------
    const meses = [];
    const [ano, mes] = hoje.split('-').map(Number);
    for (let i = 11; i >= 0; i--) {
        const d = new Date(Date.UTC(ano, mes - 1 - i, 1));
        meses.push(d.toISOString().slice(0, 7));
    }
    const porMes = Object.fromEntries(meses.map(m => [m, 0]));
    for (const d of DB.dividendos) {
        if (!cidsEscopo.has(d.carteira_id)) continue;
        const m = d.data_pagamento.slice(0, 7);
        if (m in porMes) porMes[m] += Number(d.valor_total);
    }
    desenhar('g-proventos', {
        type: 'bar',
        data: {
            labels: meses.map(m => m.slice(5) + '/' + m.slice(2, 4)),
            datasets: [{ label: 'Proventos', data: meses.map(m => +porMes[m].toFixed(2)), backgroundColor: 'rgba(76,175,80,.7)', borderRadius: 4 }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => brl.format(c.raw) } } },
            scales: {
                x: { ticks: { color: '#999' }, grid: { display: false } },
                y: { ticks: { color: '#999', callback: v => brl.format(v) }, grid: { color: '#2a2a2a' } }
            }
        }
    });
}

function opcoesLinha(formato, rotulosLongos) {
    return {
        responsive: true, maintainAspectRatio: false, spanGaps: true,
        interaction: { mode: 'index', intersect: false },
        plugins: {
            legend: { labels: { color: '#ccc', boxWidth: 12 } },
            tooltip: { callbacks: {
                title: (itens) => rotulosLongos[itens[0].dataIndex],
                label: (c) => `${c.dataset.label}: ${c.raw == null ? '—' : formato(c.raw)}`
            } }
        },
        scales: {
            x: { ticks: { color: '#999', maxRotation: 0, autoSkipPadding: 12 }, grid: { color: '#262626' } },
            y: { ticks: { color: '#999', callback: formato }, grid: { color: '#2a2a2a' } }
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
