// 1. Configuração do Supabase (Coloque suas chaves aqui)
const SUPABASE_URL = '[https://fjnyiizsgqzlfvbirxjs.supabase.co](https://fjnyiizsgqzlfvbirxjs.supabase.co)';
const SUPABASE_KEY = 'sb_publishable_kgtacUBF-Zu84LBgM6xG2w_b339h_eA';
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// Função auxiliar para trocar as abas na tela
function mostrarAba(aba) {
    document.querySelectorAll('.aba-conteudo').forEach(el => el.classList.remove('ativa'));
    document.getElementById('aba-' + aba).classList.add('ativa');
    document.getElementById('titulo-pagina').innerText = aba === 'ativas' ? 'Carteiras Ativas' : 'Carteiras Favoritas';
}

// Função simulada para buscar cotação (Substitua por uma API real como brapi.dev)
async function buscarCotacaoReal(ticker) {
    // Exemplo de integração real com brapi.dev:
    // const res = await fetch(`https://brapi.dev/api/quote/${ticker}?token=SEU_TOKEN`);
    // const data = await res.json();
    // return data.results[0].regularMarketPrice;
    
    // Simulação temporária para a interface funcionar imediatamente
    const mockPrecos = {
        'PETR4.SA': 38.50,
        'WEGE3.SA': 40.10
    };
    return mockPrecos[ticker] || 10.00;
}

// 2. Carregar dados do Banco de Dados
async function carregarDados() {
    // Consumindo a View criada no PostgreSQL
    const { data: posicoes, error } = await supabase
        .from('vw_posicao_atual')
        .select('*');

    if (error) {
        console.error('Erro ao buscar dados:', error);
        return;
    }

    const tbAtivas = document.getElementById('tb-ativas');
    const tbFavoritas = document.getElementById('tb-favoritas');
    
    tbAtivas.innerHTML = '';
    tbFavoritas.innerHTML = '';

    for (const pos of posicoes) {
        // Busca o preço na internet
        const precoAtual = await buscarCotacaoReal(pos.ticker);

        if (pos.tipo_carteira === 'ATIVA') {
            // Regra para carteiras com ordens de compra e venda
            const rentabilidade = ((precoAtual / pos.preco_medio) - 1) * 100;
            const classeRent = rentabilidade >= 0 ? 'lucro' : 'prejuizo';
            const rendimentoText = rentabilidade >= 0 ? `+${rentabilidade.toFixed(2)}%` : `${rentabilidade.toFixed(2)}%`;

            tbAtivas.innerHTML += `
                <tr>
                    <td>${pos.nome_carteira}</td>
                    <td><strong>${pos.ticker}</strong></td>
                    <td>${pos.quantidade_total}</td>
                    <td>R$ ${pos.preco_medio.toFixed(2)}</td>
                    <td>R$ ${precoAtual.toFixed(2)}</td>
                    <td class="lucro">R$ ${pos.total_dividendos.toFixed(2)}</td>
                    <td class="${classeRent}">${rendimentoText}</td>
                </tr>
            `;
        } else if (pos.tipo_carteira === 'FAVORITA') {
            // Regra para carteiras de acompanhamento (Watchlist)
            tbFavoritas.innerHTML += `
                <tr>
                    <td>${pos.nome_carteira}</td>
                    <td><strong>${pos.ticker}</strong></td>
                    <td>R$ ${precoAtual.toFixed(2)}</td>
                </tr>
            `;
        }
    }
}

// Carregar ao abrir a página
carregarDados();
