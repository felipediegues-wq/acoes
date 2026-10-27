const SUPABASE_URL = 'https://fjnyiizsgqzlfvbirxjs.supabase.co';
const SUPABASE_KEY = 'sb_publishable_kgtacUBF-Zu84LBgM6xG2w_b339h_eA';

// A variável passa a chamar-se 'clienteSupabase' para evitar conflitos
const clienteSupabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

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
    // Utilizamos a nova variável 'clienteSupabase' para comunicar com a base de dados
    const { data: posicoes, error } = await clienteSupabase
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

// --- NOVAS FUNÇÕES PARA CADASTRO ---

// Mudar os títulos ao trocar de aba
const titulos = {
    'ativas': 'Carteiras Ativas',
    'favoritas': 'Carteiras Favoritas',
    'nova-carteira': 'Criar Nova Carteira',
    'nova-ordem': 'Lançar Ordem (Compra/Venda)'
};

function mostrarAba(aba) {
    document.querySelectorAll('.aba-conteudo').forEach(el => el.classList.remove('ativa'));
    document.getElementById('aba-' + aba).classList.add('ativa');
    document.getElementById('titulo-pagina').innerText = titulos[aba];
    
    if (aba === 'nova-ordem') {
        carregarDropdownCarteiras();
    }
}

// Salvar Nova Carteira no Banco
async function salvarCarteira(event) {
    event.preventDefault(); // Impede a página de recarregar
    
    const nome = document.getElementById('cad-nome-carteira').value;
    const tipo = document.getElementById('cad-tipo-carteira').value;

    const { error } = await clienteSupabase
        .from('carteiras')
        .insert([{ nome_carteira: nome, tipo_carteira: tipo }]);

    if (error) {
        alert('Erro ao criar carteira: ' + error.message);
    } else {
        alert('Carteira criada com sucesso!');
        document.getElementById('cad-nome-carteira').value = '';
    }
}

// Carregar as carteiras no Select da tela de Ordens
async function carregarDropdownCarteiras() {
    const { data, error } = await clienteSupabase.from('carteiras').select('*');
    const select = document.getElementById('ordem-carteira');
    select.innerHTML = '';

    if (data) {
        data.forEach(cart => {
            select.innerHTML += `<option value="${cart.id}">${cart.nome_carteira} (${cart.tipo_carteira})</option>`;
        });
    }
}

// Lançar Compra ou Venda
async function salvarOrdem(event) {
    event.preventDefault();

    const carteira_id = document.getElementById('ordem-carteira').value;
    const ticker = document.getElementById('ordem-ticker').value.toUpperCase();
    const tipo = document.getElementById('ordem-tipo').value;
    const quantidade = document.getElementById('ordem-quantidade').value;
    const preco = document.getElementById('ordem-preco').value;
    const data_transacao = document.getElementById('ordem-data').value;

    // 1. Verifica se o Ativo já existe na carteira, se não, cria.
    let { data: ativos, error: errAtivo } = await clienteSupabase
        .from('ativos')
        .select('id')
        .eq('carteira_id', carteira_id)
        .eq('ticker', ticker);

    let ativo_id;

    if (ativos && ativos.length > 0) {
        ativo_id = ativos[0].id;
    } else {
        const { data: novoAtivo, error: errNovo } = await clienteSupabase
            .from('ativos')
            .insert([{ carteira_id: carteira_id, ticker: ticker }])
            .select();
        
        if (errNovo) {
            alert('Erro ao vincular ativo: ' + errNovo.message);
            return;
        }
        ativo_id = novoAtivo[0].id;
    }

    // 2. Insere a transação
    const { error: errTransacao } = await clienteSupabase
        .from('transacoes')
        .insert([{ 
            ativo_id: ativo_id, 
            tipo_operacao: tipo, 
            quantidade: quantidade, 
            preco_unitario: preco, 
            data_operacao: data_transacao 
        }]);

    if (errTransacao) {
        alert('Erro ao registrar ordem: ' + errTransacao.message);
    } else {
        alert('Ordem registrada com sucesso!');
        document.getElementById('ordem-quantidade').value = '';
        document.getElementById('ordem-preco').value = '';
        carregarDados(); // Atualiza a tabela principal
    }
}

carregarDados();
