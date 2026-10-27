const SUPABASE_URL = 'https://fjnyiizsgqzlfvbirxjs.supabase.co';
const SUPABASE_KEY = 'sb_publishable_kgtacUBF-Zu84LBgM6xG2w_b339h_eA';
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

function mostrarAba(aba) {
    document.querySelectorAll('.aba-conteudo').forEach(el => el.classList.remove('ativa'));
    document.getElementById('aba-' + aba).classList.add('ativa');
    document.getElementById('titulo-pagina').innerText = aba === 'ativas' ? 'Carteiras Ativas' : 'Carteiras Favoritas';
}

async function buscarCotacaoReal(ticker) {
    const mockPrecos = {
        'PETR4.SA': 38.50,
        'WEGE3.SA': 40.10
    };
    return mockPrecos[ticker] || 10.00;
}

async function carregarDados() {
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
        const precoAtual = await buscarCotacaoReal(pos.ticker);

        if (pos.tipo_carteira === 'ATIVA') {
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

carregarDados();
