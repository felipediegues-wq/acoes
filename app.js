// 1. Configuração do Supabase (com chaves atualizadas)
const SUPABASE_URL = 'https://fjnyiizsgqzlfvbirxjs.supabase.co';
const SUPABASE_KEY = 'sb_publishable_kgtacUBF-Zu84LBgM6xG2w_b339h_eA';
const clienteSupabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// 2. Controle de Abas e Títulos
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
    
    // Se abrir a tela de ordens, carrega a lista de carteiras no dropdown
    if (aba === 'nova-ordem') {
        carregarDropdownCarteiras();
    }
}

// 3. Simulação de Cotação em Tempo Real (Substituir no futuro por API real)
async function buscarCotacaoReal(ticker) {
    const mockPrecos = {
        'PETR4.SA': 38.50,
        'WEGE3.SA': 40.10
    };
    // Retorna o preço de teste ou 10.00 como valor padrão
    return mockPrecos[ticker] || 10.00;
}

// 4. Carregar Dados na Tabela Principal
async function carregarDados() {
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

// 5. Salvar Nova Carteira
async function salvarCarteira(event) {
    event.preventDefault(); 
    
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

// 6. Carregar Dropdown de Carteiras na tela de Ordens
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

// 7. Salvar Nova Ordem (Compra/Venda)
async function salvarOrdem(event) {
    event.preventDefault();

    const carteira_id = document.getElementById('ordem-carteira').value;
    const ticker = document.getElementById('ordem-ticker').value.toUpperCase();
    const tipo = document.getElementById('ordem-tipo').value;
    const quantidade = document.getElementById('ordem-quantidade').value;
    const preco = document.getElementById('ordem-preco').value;
    const data_transacao = document.getElementById('ordem-data').value;

    // A. Verifica se o Ativo já existe na carteira selecionada
    let { data: ativos, error: errAtivo } = await clienteSupabase
        .from('ativos')
        .select('id')
        .eq('carteira_id', carteira_id)
        .eq('ticker', ticker);

    let ativo_id;

    if (ativos && ativos.length > 0) {
        ativo_id = ativos[0].id; // Já existe, pega o ID
    } else {
        // Não existe, cria o vínculo do ativo com a carteira primeiro
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

    // B. Registra a transação (Ordem)
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
        // Limpa os campos após o sucesso
        document.getElementById('ordem-quantidade').value = '';
        document.getElementById('ordem-preco').value = '';
        document.getElementById('ordem-ticker').value = '';
        // Atualiza os dados na tabela principal
        carregarDados(); 
    }
}

// Inicia o carregamento dos dados ao abrir a página
carregarDados();
