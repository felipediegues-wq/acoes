// ====================================================================
// app.js — Portal de Ações (Supabase + GitHub Pages)
// ====================================================================
// Obs.: o cliente se chama "sb". O nome "supabase" já é usado pela
// biblioteca do CDN (window.supabase) — redeclarar com const quebrava
// o script inteiro ("Identifier 'supabase' has already been declared").
const sb = window.supabase.createClient(APP_CONFIG.SUPABASE_URL, APP_CONFIG.SUPABASE_KEY);

const $ = (id) => document.getElementById(id);
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const num = (v, d = 2) => Number(v).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
const qtdFmt = (v) => Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 4 });
const pct = (v) => (v >= 0 ? '+' : '') + num(v) + '%';
const classe = (v) => (v > 0 ? 'lucro' : v < 0 ? 'prejuizo' : '');
const dataBR = (iso) => iso ? iso.slice(0, 10).split('-').reverse().join('/') : '';
const hoje = () => new Date().toLocaleDateString('sv-SE'); // yyyy-mm-dd no fuso local
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const normTicker = (t) => String(t || '').trim().toUpperCase().replace(/\.SA$/, '');

// Estado em memória
const DB = { carteiras: [], ativos: [], ordens: [], dividendos: [] };
let COTACOES = {};

const TITULOS = {
    posicao: 'Posição', favoritas: 'Favoritas', ordens: 'Ordens',
    proventos: 'Proventos', cadastros: 'Carteiras e Ativos', config: 'Configurações'
};

// ====================================================================
// LOGIN
// ====================================================================
$('form-login').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('login-erro').textContent = '';
    const { error } = await sb.auth.signInWithPassword({
        email: $('login-email').value.trim(),
        password: $('login-senha').value
    });
    if (error) $('login-erro').textContent = 'Falha no login: ' + error.message;
});

$('btn-sair').addEventListener('click', () => sb.auth.signOut());

sb.auth.onAuthStateChange((_evento, sessao) => {
    if (sessao) {
        $('tela-login').classList.add('oculto');
        $('tela-app').classList.remove('oculto');
        $('usuario-email').textContent = sessao.user.email;
        // setTimeout: recomendação do supabase-js para não chamar a API dentro do callback
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
    document.querySelectorAll('.aba-conteudo').forEach(el => el.classList.remove('ativa'));
    document.querySelectorAll('.sidebar a[data-aba]').forEach(el => el.classList.toggle('ativo', el.dataset.aba === aba));
    $('aba-' + aba).classList.add('ativa');
    $('titulo-pagina').textContent = TITULOS[aba];
}

function aviso(msg) {
    $('aviso').textContent = msg || '';
    $('aviso').classList.toggle('oculto', !msg);
}

// ====================================================================
// CARGA DO BANCO
// ====================================================================
async function carregarBanco() {
    const [c, a, o, d] = await Promise.all([
        sb.from('carteiras').select('*').order('nome'),
        sb.from('ativos').select('*').order('ticker'),
        sb.from('ordens').select('*').order('data_ordem').order('created_at'),
        sb.from('dividendos').select('*').order('data_pagamento', { ascending: false })
    ]);
    const erro = c.error || a.error || o.error || d.error;
    if (erro) throw erro;
    DB.carteiras = c.data; DB.ativos = a.data; DB.ordens = o.data; DB.dividendos = d.data;
}

async function recarregarTudo(forcarCotacao) {
    const btn = $('btn-atualizar');
    btn.disabled = true;
    try {
        await carregarBanco();
        renderCadastros();
        renderOrdens();
        renderProventos();
        preencherSelects();
        await atualizarCotacoes(forcarCotacao);
        renderPosicao();
        renderFavoritas();
    } catch (err) {
        console.error(err);
        aviso('Erro ao acessar o banco: ' + (err.message || err));
    } finally {
        btn.disabled = false;
    }
}

$('btn-atualizar').addEventListener('click', () => recarregarTudo(true));
$('filtro-carteira-posicao').addEventListener('change', renderPosicao);
$('mostrar-zeradas').addEventListener('change', renderPosicao);

// ====================================================================
// COTAÇÕES — brapi.dev (plano gratuito: 1 ticker por chamada)
// ====================================================================
const CHAVE_TOKEN = 'brapi_token';
const CHAVE_CACHE = 'cache_cotacoes';

function lerLocal(chave, padrao) {
    try { return JSON.parse(localStorage.getItem(chave)) ?? padrao; } catch { return padrao; }
}
function gravarLocal(chave, valor) {
    try { localStorage.setItem(chave, JSON.stringify(valor)); } catch { /* navegador bloqueou */ }
}

async function buscarCotacao(ticker, token) {
    const url = `https://brapi.dev/api/quote/${encodeURIComponent(ticker)}` + (token ? `?token=${encodeURIComponent(token)}` : '');
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${ticker}: HTTP ${res.status}`);
    const json = await res.json();
    const r = json.results && json.results[0];
    if (!r || r.regularMarketPrice == null) throw new Error(`${ticker}: sem cotação`);
    return { preco: Number(r.regularMarketPrice), variacao: Number(r.regularMarketChangePercent || 0), em: Date.now() };
}

async function atualizarCotacoes(forcar) {
    const token = lerLocal(CHAVE_TOKEN, '');
    const cache = lerLocal(CHAVE_CACHE, {});
    const validade = intervaloAutoMs();
    const tickers = [...new Set(DB.ativos.map(a => normTicker(a.ticker)))];

    const pendentes = tickers.filter(t => forcar || !cache[t] || Date.now() - cache[t].em > validade);
    const falhas = [];

    // até 4 consultas em paralelo
    for (let i = 0; i < pendentes.length; i += 4) {
        const lote = pendentes.slice(i, i + 4);
        const resp = await Promise.allSettled(lote.map(t => buscarCotacao(t, token)));
        resp.forEach((r, k) => {
            if (r.status === 'fulfilled') cache[lote[k]] = r.value;
            else falhas.push(lote[k]);
        });
    }
    gravarLocal(CHAVE_CACHE, cache);
    COTACOES = cache;

    atualizarInfoCotacao();

    if (falhas.length) {
        aviso(`Não consegui cotar: ${falhas.join(', ')}.` +
              (token ? ' Confira se o ticker existe na B3.' : ' Sem token da brapi só PETR4, VALE3, MGLU3 e ITUB4 funcionam — cadastre o token em Configurações.') +
              ' (usando último valor guardado, se houver)');
    } else {
        aviso('');
    }
}

// ====================================================================
// ATUALIZAÇÃO AUTOMÁTICA
//  - roda a cada minuto, mas só consulta a brapi quando o cache venceu
//    (intervalo ATUALIZAR_AUTO_MIN do config.js)
//  - só com a aba visível e usuário logado
//  - só no horário do pregão (fora dele a cotação não muda)
// ====================================================================
function intervaloAutoMs() {
    return Math.max(5, Number(APP_CONFIG.ATUALIZAR_AUTO_MIN) || 15) * 60 * 1000;
}

function pregaoAberto() {
    // hora de Brasília, independente do fuso do computador
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Sao_Paulo', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false
    }).formatToParts(new Date()).map(x => [x.type, x.value]));
    const minutos = (Number(p.hour) % 24) * 60 + Number(p.minute);
    const diaUtil = !['Sat', 'Sun'].includes(p.weekday);
    return diaUtil && minutos >= 10 * 60 && minutos <= 18 * 60;   // feriados da B3 não são tratados
}

function atualizarInfoCotacao() {
    const horarios = [...new Set(DB.ativos.map(a => normTicker(a.ticker)))]
        .map(t => COTACOES[t]?.em).filter(Boolean);
    if (!horarios.length) { $('info-cotacao').textContent = ''; return; }
    const hora = (ms) => new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const maisAntiga = Math.min(...horarios);
    $('info-cotacao').textContent = pregaoAberto()
        ? `Cotações de ${hora(maisAntiga)} · próxima ~${hora(maisAntiga + intervaloAutoMs())} (automática)`
        : `Cotações de ${hora(maisAntiga)} · pregão fechado`;
}

let autoRodando = false;
async function cicloAutomatico() {
    if (autoRodando || document.hidden || $('tela-app').classList.contains('oculto') || !DB.ativos.length) return;
    if (!pregaoAberto()) { atualizarInfoCotacao(); return; }
    autoRodando = true;
    try {
        await atualizarCotacoes(false);   // só busca o que venceu
        renderPosicao();
        renderFavoritas();
    } catch (err) {
        console.error('Atualização automática falhou:', err);
    } finally {
        autoRodando = false;
    }
}

setInterval(cicloAutomatico, 60 * 1000);
// voltou para a aba depois de um tempo? atualiza na hora se o cache venceu
document.addEventListener('visibilitychange', () => { if (!document.hidden) cicloAutomatico(); });

// ====================================================================
// CÁLCULO DA POSIÇÃO (preço médio no padrão da Receita)
//  - Compra: custo += qtd*preço + taxas; PM = custo / qtd
//  - Venda : não altera o PM; lucro realizado = qtd*(preço - PM) - taxas
//  - Posição zerou: PM e custo voltam a zero
// ====================================================================
function calcularPosicoes() {
    const porAtivo = {};
    for (const a of DB.ativos) {
        porAtivo[a.id] = { ativo: a, qtd: 0, custo: 0, pm: 0, realizado: 0, proventos: 0, vendaMaiorQuePosicao: false };
    }
    for (const o of DB.ordens) {
        const p = porAtivo[o.ativo_id];
        if (!p) continue;
        const q = Number(o.quantidade), preco = Number(o.preco), taxas = Number(o.taxas || 0);
        if (o.tipo === 'C') {
            p.custo += q * preco + taxas;
            p.qtd += q;
            p.pm = p.custo / p.qtd;
        } else {
            if (q > p.qtd + 1e-9) p.vendaMaiorQuePosicao = true;
            p.realizado += q * (preco - p.pm) - taxas;
            p.qtd -= q;
            p.custo = p.pm * p.qtd;
            if (p.qtd <= 1e-9) { p.qtd = 0; p.custo = 0; p.pm = 0; }
        }
    }
    for (const d of DB.dividendos) {
        if (porAtivo[d.ativo_id]) porAtivo[d.ativo_id].proventos += Number(d.valor_total);
    }
    return porAtivo;
}

const carteiraDe = (id) => DB.carteiras.find(c => c.id === id);
const ativoDe = (id) => DB.ativos.find(a => a.id === id);

function renderPosicao() {
    const filtro = $('filtro-carteira-posicao').value;
    const zeradas = $('mostrar-zeradas').checked;
    const posicoes = Object.values(calcularPosicoes())
        .filter(p => carteiraDe(p.ativo.carteira_id)?.tipo === 'ATIVA')
        .filter(p => !filtro || p.ativo.carteira_id === filtro)
        .filter(p => zeradas || p.qtd > 0);

    posicoes.sort((x, y) => (carteiraDe(x.ativo.carteira_id).nome + x.ativo.ticker)
        .localeCompare(carteiraDe(y.ativo.carteira_id).nome + y.ativo.ticker));

    let tCusto = 0, tAtual = 0, tProv = 0, tReal = 0, semCotacao = false;
    const linhas = posicoes.map(p => {
        const t = normTicker(p.ativo.ticker);
        const cot = COTACOES[t];
        const valorAtual = cot ? p.qtd * cot.preco : null;
        const resultado = valorAtual != null ? valorAtual - p.custo : null;
        const rent = resultado != null && p.custo > 0 ? (resultado / p.custo) * 100 : null;

        tCusto += p.custo; tProv += p.proventos; tReal += p.realizado;
        if (valorAtual != null) tAtual += valorAtual; else if (p.qtd > 0) semCotacao = true;

        const alerta = p.vendaMaiorQuePosicao ? ' <span title="Existe venda maior que a posição na data — confira as ordens">⚠️</span>' : '';
        return `<tr class="${p.qtd === 0 ? 'zerada' : ''}">
            <td>${esc(carteiraDe(p.ativo.carteira_id).nome)}</td>
            <td><strong>${esc(t)}</strong>${alerta}</td>
            <td class="num">${qtdFmt(p.qtd)}</td>
            <td class="num">${p.qtd ? brl.format(p.pm) : '—'}</td>
            <td class="num">${cot ? brl.format(cot.preco) : '—'}</td>
            <td class="num ${cot ? classe(cot.variacao) : ''}">${cot ? pct(cot.variacao) : '—'}</td>
            <td class="num">${brl.format(p.custo)}</td>
            <td class="num">${valorAtual != null ? brl.format(valorAtual) : '—'}</td>
            <td class="num ${classe(resultado)}">${resultado != null ? brl.format(resultado) : '—'}</td>
            <td class="num ${classe(rent)}">${rent != null ? pct(rent) : '—'}</td>
            <td class="num lucro">${brl.format(p.proventos)}</td>
            <td class="num ${classe(p.realizado)}">${brl.format(p.realizado)}</td>
        </tr>`;
    });

    $('tb-posicao').innerHTML = linhas.join('') ||
        '<tr><td colspan="12" class="vazio">Nenhuma posição. Cadastre uma carteira ATIVA, um ativo e lance uma ordem de compra.</td></tr>';

    const resNaoReal = tAtual - tCusto;
    const rentTotal = tCusto > 0 ? (resNaoReal / tCusto) * 100 : 0;
    $('resumo').innerHTML = `
        <div class="item"><span>Custo total</span><strong>${brl.format(tCusto)}</strong></div>
        <div class="item"><span>Valor atual${semCotacao ? ' (parcial)' : ''}</span><strong>${brl.format(tAtual)}</strong></div>
        <div class="item"><span>Resultado não realizado</span><strong class="${classe(resNaoReal)}">${brl.format(resNaoReal)} (${pct(rentTotal)})</strong></div>
        <div class="item"><span>Proventos recebidos</span><strong class="lucro">${brl.format(tProv)}</strong></div>
        <div class="item"><span>Lucro realizado (vendas)</span><strong class="${classe(tReal)}">${brl.format(tReal)}</strong></div>`;
}

function renderFavoritas() {
    const favs = DB.ativos.filter(a => carteiraDe(a.carteira_id)?.tipo === 'FAVORITA');
    $('tb-favoritas').innerHTML = favs.map(a => {
        const t = normTicker(a.ticker);
        const cot = COTACOES[t];
        const alvo = a.preco_alvo != null ? Number(a.preco_alvo) : null;
        const dist = cot && alvo ? ((alvo / cot.preco) - 1) * 100 : null;
        return `<tr>
            <td>${esc(carteiraDe(a.carteira_id).nome)}</td>
            <td><strong>${esc(t)}</strong></td>
            <td class="num">${cot ? brl.format(cot.preco) : '—'}</td>
            <td class="num ${cot ? classe(cot.variacao) : ''}">${cot ? pct(cot.variacao) : '—'}</td>
            <td class="num">${alvo != null ? brl.format(alvo) : '—'}</td>
            <td class="num ${classe(dist)}">${dist != null ? pct(dist) : '—'}</td>
            <td>${esc(a.observacao)}</td>
        </tr>`;
    }).join('') || '<tr><td colspan="7" class="vazio">Nenhum ativo em carteira FAVORITA.</td></tr>';
}

// ====================================================================
// LISTAGENS DE CADASTRO
// ====================================================================
const botoes = (tabela, id) =>
    `<td class="num"><button class="btn-mini" data-editar="${tabela}" data-id="${id}">Editar</button>` +
    `<button class="btn-mini perigo" data-excluir="${tabela}" data-id="${id}">Excluir</button></td>`;

function renderCadastros() {
    $('tb-carteiras').innerHTML = DB.carteiras.map(c => `<tr>
        <td>${esc(c.nome)}</td><td>${c.tipo === 'ATIVA' ? 'Ativa' : 'Favorita'}</td>
        <td class="num">${DB.ativos.filter(a => a.carteira_id === c.id).length}</td>${botoes('carteiras', c.id)}
    </tr>`).join('') || '<tr><td colspan="4" class="vazio">Nenhuma carteira.</td></tr>';

    const ativosOrd = [...DB.ativos].sort((x, y) =>
        (carteiraDe(x.carteira_id)?.nome + x.ticker).localeCompare(carteiraDe(y.carteira_id)?.nome + y.ticker));
    $('tb-ativos').innerHTML = ativosOrd.map(a => `<tr>
        <td>${esc(carteiraDe(a.carteira_id)?.nome)}</td><td><strong>${esc(a.ticker)}</strong></td>
        <td class="num">${a.preco_alvo != null ? brl.format(a.preco_alvo) : '—'}</td>${botoes('ativos', a.id)}
    </tr>`).join('') || '<tr><td colspan="4" class="vazio">Nenhum ativo.</td></tr>';
}

function renderOrdens() {
    const lista = [...DB.ordens].reverse(); // mais recentes primeiro
    $('tb-ordens').innerHTML = lista.map(o => {
        const a = ativoDe(o.ativo_id);
        const total = Number(o.quantidade) * Number(o.preco) + (o.tipo === 'C' ? 1 : -1) * Number(o.taxas || 0);
        return `<tr>
            <td>${dataBR(o.data_ordem)}</td><td>${esc(carteiraDe(a?.carteira_id)?.nome)}</td>
            <td><strong>${esc(a?.ticker)}</strong></td>
            <td class="${o.tipo === 'C' ? 'lucro' : 'prejuizo'}">${o.tipo === 'C' ? 'Compra' : 'Venda'}</td>
            <td class="num">${qtdFmt(o.quantidade)}</td><td class="num">${brl.format(o.preco)}</td>
            <td class="num">${brl.format(o.taxas || 0)}</td><td class="num">${brl.format(total)}</td>
            ${botoes('ordens', o.id)}
        </tr>`;
    }).join('') || '<tr><td colspan="9" class="vazio">Nenhuma ordem lançada.</td></tr>';
}

function renderProventos() {
    const nomes = { DIVIDENDO: 'Dividendo', JCP: 'JCP', RENDIMENTO: 'Rendimento' };
    $('tb-proventos').innerHTML = DB.dividendos.map(d => {
        const a = ativoDe(d.ativo_id);
        return `<tr>
            <td>${dataBR(d.data_pagamento)}</td><td>${esc(carteiraDe(a?.carteira_id)?.nome)}</td>
            <td><strong>${esc(a?.ticker)}</strong></td><td>${nomes[d.tipo] || d.tipo}</td>
            <td class="num lucro">${brl.format(d.valor_total)}</td>${botoes('dividendos', d.id)}
        </tr>`;
    }).join('') || '<tr><td colspan="6" class="vazio">Nenhum provento lançado.</td></tr>';
}

function preencherSelects() {
    const opCarteiras = DB.carteiras.map(c => `<option value="${c.id}">${esc(c.nome)}</option>`).join('');
    const filtro = $('filtro-carteira-posicao');
    const sel = filtro.value;
    filtro.innerHTML = '<option value="">Todas</option>' +
        DB.carteiras.filter(c => c.tipo === 'ATIVA').map(c => `<option value="${c.id}">${esc(c.nome)}</option>`).join('');
    filtro.value = DB.carteiras.some(c => c.id === sel) ? sel : '';

    $('ativo-carteira').innerHTML = opCarteiras;

    // ordens e proventos só fazem sentido em carteiras ATIVAS
    const ativosAtivos = DB.ativos
        .filter(a => carteiraDe(a.carteira_id)?.tipo === 'ATIVA')
        .sort((x, y) => (carteiraDe(x.carteira_id).nome + x.ticker).localeCompare(carteiraDe(y.carteira_id).nome + y.ticker));
    const opAtivos = ativosAtivos.map(a => `<option value="${a.id}">${esc(a.ticker)} — ${esc(carteiraDe(a.carteira_id).nome)}</option>`).join('');
    $('ordem-ativo').innerHTML = opAtivos;
    $('provento-ativo').innerHTML = opAtivos;

    if (!$('ordem-data').value) $('ordem-data').value = hoje();
    if (!$('provento-data').value) $('provento-data').value = hoje();
}

// ====================================================================
// FORMULÁRIOS (inserir / editar)
// ====================================================================
async function salvar(tabela, id, dados) {
    const q = id ? sb.from(tabela).update(dados).eq('id', id) : sb.from(tabela).insert(dados);
    const { error } = await q;
    if (error) {
        alert('Erro ao salvar: ' + (error.code === '23505' ? 'esse ticker já está nessa carteira.' : error.message));
        return false;
    }
    return true;
}

const FORMS = {
    carteira: {
        tabela: 'carteiras', titulo: 'carteira',
        ler: () => ({ nome: $('carteira-nome').value.trim(), tipo: $('carteira-tipo').value }),
        preencher: (r) => { $('carteira-nome').value = r.nome; $('carteira-tipo').value = r.tipo; },
        limpar: () => { $('carteira-nome').value = ''; }
    },
    ativo: {
        tabela: 'ativos', titulo: 'ativo',
        ler: () => ({
            carteira_id: $('ativo-carteira').value,
            ticker: normTicker($('ativo-ticker').value),
            preco_alvo: $('ativo-alvo').value === '' ? null : Number($('ativo-alvo').value),
            observacao: $('ativo-obs').value.trim() || null
        }),
        preencher: (r) => {
            $('ativo-carteira').value = r.carteira_id; $('ativo-ticker').value = r.ticker;
            $('ativo-alvo').value = r.preco_alvo ?? ''; $('ativo-obs').value = r.observacao ?? '';
        },
        limpar: () => { $('ativo-ticker').value = ''; $('ativo-alvo').value = ''; $('ativo-obs').value = ''; }
    },
    ordem: {
        tabela: 'ordens', titulo: 'ordem',
        ler: () => ({
            ativo_id: $('ordem-ativo').value, tipo: $('ordem-tipo').value, data_ordem: $('ordem-data').value,
            quantidade: Number($('ordem-qtd').value), preco: Number($('ordem-preco').value),
            taxas: Number($('ordem-taxas').value || 0)
        }),
        preencher: (r) => {
            $('ordem-ativo').value = r.ativo_id; $('ordem-tipo').value = r.tipo; $('ordem-data').value = r.data_ordem;
            $('ordem-qtd').value = r.quantidade; $('ordem-preco').value = r.preco; $('ordem-taxas').value = r.taxas;
        },
        limpar: () => { $('ordem-qtd').value = ''; $('ordem-preco').value = ''; $('ordem-taxas').value = 0; }
    },
    provento: {
        tabela: 'dividendos', titulo: 'provento',
        ler: () => ({
            ativo_id: $('provento-ativo').value, tipo: $('provento-tipo').value,
            data_pagamento: $('provento-data').value, valor_total: Number($('provento-valor').value)
        }),
        preencher: (r) => {
            $('provento-ativo').value = r.ativo_id; $('provento-tipo').value = r.tipo;
            $('provento-data').value = r.data_pagamento; $('provento-valor').value = r.valor_total;
        },
        limpar: () => { $('provento-valor').value = ''; }
    }
};

function cancelarEdicao(nome) {
    $(nome + '-id').value = '';
    $('titulo-form-' + nome).textContent = 'Nov' + (nome === 'carteira' || nome === 'ordem' ? 'a ' : 'o ') + FORMS[nome].titulo;
    FORMS[nome].limpar();
}

for (const nome of Object.keys(FORMS)) {
    $('form-' + nome).addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = FORMS[nome];
        const dados = f.ler();
        if ((nome === 'ordem' || nome === 'provento') && !dados.ativo_id) {
            alert('Cadastre antes um ativo em uma carteira ATIVA.');
            return;
        }
        if (nome === 'ativo' && !dados.carteira_id) { alert('Cadastre antes uma carteira.'); return; }
        if (await salvar(f.tabela, $(nome + '-id').value || null, dados)) {
            cancelarEdicao(nome);
            await recarregarTudo(false);
        }
    });
}
document.querySelectorAll('[data-cancelar]').forEach(b => b.addEventListener('click', () => cancelarEdicao(b.dataset.cancelar)));

// Editar / excluir (delegação de eventos nas tabelas)
const TABELA_FORM = { carteiras: 'carteira', ativos: 'ativo', ordens: 'ordem', dividendos: 'provento' };

document.addEventListener('click', async (e) => {
    const bEd = e.target.closest('[data-editar]');
    const bEx = e.target.closest('[data-excluir]');

    if (bEd) {
        const tabela = bEd.dataset.editar, nome = TABELA_FORM[tabela];
        const reg = DB[tabela].find(r => r.id === bEd.dataset.id);
        if (!reg) return;
        $(nome + '-id').value = reg.id;
        $('titulo-form-' + nome).textContent = 'Editando ' + FORMS[nome].titulo;
        FORMS[nome].preencher(reg);
        $('form-' + nome).scrollIntoView({ behavior: 'smooth' });
    }

    if (bEx) {
        const tabela = bEx.dataset.excluir;
        let msg = 'Excluir este registro?';
        if (tabela === 'carteiras') msg = 'Excluir a carteira apaga TAMBÉM todos os ativos, ordens e proventos dela. Continuar?';
        if (tabela === 'ativos') msg = 'Excluir o ativo apaga TAMBÉM as ordens e proventos dele. Continuar?';
        if (!confirm(msg)) return;
        const { error } = await sb.from(tabela).delete().eq('id', bEx.dataset.id);
        if (error) { alert('Erro ao excluir: ' + error.message); return; }
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
