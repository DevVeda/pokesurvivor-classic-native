/* ui.js — las pantallas de la partida en la PS5, para mando, dibujadas en el canvas.
 *
 * La interfaz de la web es HTML y aquí no se ve. Estas pantallas sustituyen a las de
 * G.RunUI con las mismas funciones (showLevelUp, showItemChoice, showPause, showOver):
 * la lógica del juego no cambia, sólo cómo se enseña y cómo se elige.
 *
 *   ✕ elegir · ○ atrás / continuar · △ cambiar las cartas · cruceta o stick: moverse · Options: continuar
 * Mientras hay una abierta, el juego no ve el mando (si no, ○ le llegaba también como Esc).
 *
 * Se dibujan encima del juego en cada fotograma (browser.js llama a psOverlay).
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
(() => {
  const screen = (globalThis.psUiCanvas || document.getElementById('game')).getContext('2d');   // (la web: su lienzo encima del juego, shim/web.js)
  // Las pantallas se dibujan en un lienzo aparte sólo cuando cambia algo (su key()), y cada fotograma se
  // copia: repintar todo el texto en cada fotograma costaba ~15 ms (con las cartas, 28 ms por fotograma).
  const buf = document.createElement('canvas');
  buf.width = ps.W; buf.height = ps.H;
  const bufCtx = buf.getContext('2d');
  let ctx = screen, lastKey = null;
  // Se maqueta siempre a 960x540 y se escala ×K a la pantalla de verdad (ps.W x ps.H: en escritorio, la resolución de Ajustes).
  // OX: si la pantalla es más ancha que 16:9 (un móvil), lo maquetado va centrado y OX es lo que sobra a cada lado.
  const W = 960, H = 540;
  // OY: si es más estrecha que 16:9 (una ventana del navegador), se escala por el ancho y lo maquetado va centrado en alto.
  let K, OX, OY, MX, LX;
  // Menú principal (medidas de la web a 1280x720, por 0,75): el panel de la derecha pegado al borde derecho de verdad y el
  // logo y el compañero centrados en lo que queda a su izquierda (en un móvil 20:9, más ancho que 16:9). Se rehace con
  // cada cambio de tamaño (la web en el móvil carga a veces en vertical o con la barra del navegador).
  const fit = () => {
    K = Math.min(ps.H / H, ps.W / W); OX = (ps.W / K - W) / 2; OY = (ps.H / K - H) / 2;
    MX = 694 + OX; LX = Math.round((MX - 19 - OX) / 2);
  };
  fit();
  // La pantalla cambia de tamaño (la ventana del navegador, shim/web.js): se vuelve a escalar y a pintar todo.
  globalThis.psResize = () => {
    fit();
    buf.width = ps.W; buf.height = ps.H;
    dimCv = null; lastKey = null;
  };
  const FONT = 'Pixelify';
  // Colores de css/style.css (:root). panel/panel2/line: .panel y .card de la web, sobre la caja azul.
  const C = { bg: 'rgba(3,6,16,0.8)', panel: 'rgba(0,0,0,0.22)', panel2: 'rgba(255,255,255,0.12)', line: 'rgba(244,248,255,0.25)', text: '#ffffff',
              muted: '#b9cbf0', gold: '#ffd23f', red: '#ff5f6d', navy: '#0a1430', box1: '#2c519f', box2: '#1a3170', edge: '#f4f8ff',
              edgeIn: '#5b83d6', edgeOut: '#0b1838' };

  // Los textos que sólo tiene la PS5 (el resto ya está en los diccionarios del juego, js/data/lang-*.js y js/lang/).
  // Columnas: en, fr, it, pt-BR, zh-Hans, zh-Hant. Los idiomas sin columna usan el inglés (la capa de reserva).
  // @step native/dom
  const PS5_TEXTS = {
    'Multijugador': ['Multiplayer', 'Multijoueur', 'Multigiocatore', 'Multijogador', '多人游戏', '多人遊戲'],
    'Crear sala': ['Create room', 'Créer un salon', 'Crea stanza', 'Criar sala', '创建房间', '建立房間'],
    'Hasta 4 jugadores: enciende otro mando y elige su usuario. Cada uno entra, cambia de Pokémon o sale con su mando.': ['Up to 4 players: turn on another controller and pick its user. Each player joins, changes Pokémon or leaves with their own controller.', 'Jusqu’à 4 joueurs : allume une autre manette et choisis son utilisateur. Chacun rejoint, change de Pokémon ou part avec sa manette.', 'Fino a 4 giocatori: accendi un altro controller e scegli il suo utente. Ognuno entra, cambia Pokémon o esce con il suo controller.', 'Até 4 jogadores: ligue outro controle e escolha o usuário. Cada um entra, troca de Pokémon ou sai com o próprio controle.', '最多 4 名玩家：打开另一个手柄并选择其用户。每人用自己的手柄加入、更换宝可梦或退出。', '最多 4 名玩家：開啟另一個手把並選擇其使用者。每人用自己的手把加入、更換寶可夢或退出。'],
    'Pulsa {confirm} para entrar': ['Press {confirm} to join', 'Appuie sur {confirm} pour rejoindre', 'Premi {confirm} per entrare', 'Aperte {confirm} para entrar', '按 {confirm} 加入', '按 {confirm} 加入'],
    'cada mando': ['each controller', 'chaque manette', 'ogni controller', 'cada controle', '每个手柄', '每個手把'],
    'Ver': ['View', 'Voir', 'Vedi', 'Ver', '查看', '查看'],
    'Sin usar': ['Unused', 'Non utilisés', 'Non usati', 'Não usados', '未使用', '未使用'],
    'Recientes': ['Recent', 'Récents', 'Recenti', 'Recentes', '最近', '最近'],
    'Ninguno': ['None', 'Aucun', 'Nessuno', 'Nenhum', '无', '無'],
    'Inicial': ['Initial', 'Initiale', 'Iniziale', 'Inicial', '首字母', '首字母'],
    'Generación': ['Generation', 'Génération', 'Generazione', 'Geração', '世代', '世代'],
    'Quedan {x}': ['{x} left', 'Il en reste {x}', 'Ne restano {x}', 'Restam {x}', '剩余 {x}', '剩餘 {x}'],
    'Esta versión ya no puede jugar online. Actualiza el juego a la última versión.': ['This version can no longer play online. Update the game to the latest version.', 'Cette version ne peut plus jouer en ligne. Mets le jeu à jour vers la dernière version.', 'Questa versione non può più giocare online. Aggiorna il gioco all’ultima versione.', 'Esta versão não pode mais jogar online. Atualize o jogo para a versão mais recente.', '此版本已无法在线游戏。请将游戏更新到最新版本。', '此版本已無法線上遊戲。請將遊戲更新到最新版本。'],
    'Cooperativo local': ['Local co-op', 'Coop locale', 'Coop locale', 'Cooperativo local', '本地合作', '本地合作'],
    'Listo': ['Ready', 'Prêt', 'Pronto', 'Pronto', '就绪', '就緒'],
    'Viendo el resumen': ['Viewing the summary', 'Regarde le résumé', 'Sta guardando il riepilogo', 'Vendo o resumo', '正在查看总结', '正在查看總結'],
    'Empezar ya ({x} s)': ['Start now ({x} s)', 'Lancer maintenant ({x} s)', 'Inizia ora ({x} s)', 'Começar já ({x} s)', '立即开始（{x} 秒）', '立即開始（{x} 秒）'],
    'El anfitrión empieza otra partida en {x} s': ['The host starts another game in {x} s', 'L’hôte lance une autre partie dans {x} s', 'L’host inizia un’altra partita tra {x} s', 'O anfitrião começa outra partida em {x} s', '房主将在 {x} 秒后开始新一局', '房主將在 {x} 秒後開始新一局'],
    'Alguien sigue viendo el resumen: al empezar tendrá 10 s para volver.': ['Someone is still viewing the summary: when you start, they get 10 s to come back.', 'Quelqu’un regarde encore le résumé : au lancement, il aura 10 s pour revenir.', 'Qualcuno sta ancora guardando il riepilogo: all’avvio avrà 10 s per tornare.', 'Alguém ainda está vendo o resumo: ao começar, terá 10 s para voltar.', '有人仍在查看总结：开始后他有 10 秒返回。', '有人仍在查看總結：開始後他有 10 秒返回。'],
    'Fuera': ['Out', 'Absent', 'Fuori', 'Fora', '退出', '退出'],
    'Empezar': ['Start', 'Commencer', 'Inizia', 'Começar', '开始', '開始'],
    'Tu compañero': ['Your partner', 'Ton partenaire', 'Il tuo compagno', 'Seu parceiro', '你的伙伴', '你的夥伴'],
    'Esperando a que todos estén listos': ['Waiting for everyone to be ready', 'En attente que tout le monde soit prêt', 'In attesa che tutti siano pronti', 'Esperando todos ficarem prontos', '等待所有人准备就绪', '等待所有人準備就緒'],
    '[LR] [L1] [R1] mover · [UD] filtro': ['[LR] [L1] [R1] move · [UD] filter', '[LR] [L1] [R1] bouger · [UD] filtre', '[LR] [L1] [R1] scorri · [UD] filtro', '[LR] [L1] [R1] mover · [UD] filtro', '[LR] [L1] [R1] 移动 · [UD] 筛选', '[LR] [L1] [R1] 移動 · [UD] 篩選'],
    '[T] shiny · [S] Pokédex · [O] salir': ['[T] shiny · [S] Pokédex · [O] leave', '[T] shiny · [S] Pokédex · [O] quitter', '[T] shiny · [S] Pokédex · [O] esci', '[T] shiny · [S] Pokédex · [O] sair', '[T] 异色 · [S] 图鉴 · [O] 退出', '[T] 異色 · [S] 圖鑑 · [O] 退出'],
    '[LR] cambiar · [O] salir': ['[LR] change · [O] leave', '[LR] changer · [O] quitter', '[LR] cambia · [O] esci', '[LR] trocar · [O] sair', '[LR] 更换 · [O] 退出', '[LR] 更換 · [O] 退出'],
    'Sonido con varios jugadores': ['Sound with several players', 'Son à plusieurs joueurs', 'Audio con più giocatori', 'Som com vários jogadores', '多人时的声音', '多人時的聲音'],
    'Mandos: cada uno oye su partida por el altavoz de su mando. Tele: sólo la del jugador 1.': ['Controllers: each player hears their game through their controller speaker. TV: only player 1’s.', 'Manettes : chacun entend sa partie par le haut-parleur de sa manette. Télé : seulement celle du joueur 1.', 'Controller: ognuno sente la sua partita dall’altoparlante del controller. TV: solo quella del giocatore 1.', 'Controles: cada um ouve a sua partida pelo alto-falante do controle. TV: só a do jogador 1.', '手柄：每人用自己手柄的扬声器听自己的游戏。电视：只有玩家 1 的。', '手把：每人用自己手把的揚聲器聽自己的遊戲。電視：只有玩家 1 的。'],
    'Mandos': ['Controllers', 'Manettes', 'Controller', 'Controles', '手柄', '手把'],
    'Conectar mandos': ['Connect controllers', 'Connecter les manettes', 'Collega i controller', 'Conectar controles', '连接手柄', '連接手把'],
    'Mando Pro, Joy-Con en pareja o la consola en las manos.': ['Pro Controller, paired Joy-Con or handheld.', 'Manette Pro, Joy-Con par paire ou mode portable.', 'Controller Pro, Joy-Con in coppia o modalità portatile.', 'Controle Pro, Joy-Con em par ou modo portátil.', 'Pro 手柄、成对的 Joy-Con 或掌机模式。', 'Pro 手把、成對的 Joy-Con 或掌機模式。'],
    'Joy-Con sueltos': ['Single Joy-Con', 'Joy-Con seuls', 'Joy-Con singoli', 'Joy-Con avulsos', '单个 Joy-Con', '單個 Joy-Con'],
    'Un Joy-Con de lado por jugador: hasta 4 con dos pares.': ['One sideways Joy-Con per player: up to 4 with two pairs.', 'Un Joy-Con à l’horizontale par joueur : jusqu’à 4 avec deux paires.', 'Un Joy-Con in orizzontale per giocatore: fino a 4 con due coppie.', 'Um Joy-Con na horizontal por jogador: até 4 com dois pares.', '每人横握一个 Joy-Con：两对最多 4 人。', '每人橫握一個 Joy-Con：兩對最多 4 人。'],
    'Tele': ['TV', 'Télé', 'TV', 'TV', '电视', '電視'],
    'Página': ['Page', 'Page', 'Pagina', 'Página', '页', '頁'],
    'Favoritos': ['Favourites', 'Favoris', 'Preferiti', 'Favoritos', '收藏', '收藏'],
    'filtro': ['filter', 'filtre', 'filtro', 'filtro', '筛选', '篩選'],
    'salir': ['leave', 'quitter', 'esci', 'sair', '退出', '退出'],
    'Todos': ['All', 'Tous', 'Tutti', 'Todos', '全部', '全部'],
    '[T] [LR] cambiar · [O] salir': ['[T] [LR] change · [O] leave', '[T] [LR] changer · [O] quitter', '[T] [LR] cambia · [O] esci', '[T] [LR] trocar · [O] sair', '[T] [LR] 更换 · [O] 退出', '[T] [LR] 更換 · [O] 退出'],
    'Esperando a otro mando…': ['Waiting for another controller…', 'En attente d’une autre manette…', 'In attesa di un altro controller…', 'Esperando outro controle…', '正在等待另一个手柄…', '正在等待另一個手把…'],
    'Espera a que el jugador 1 pulse Jugar': ['Wait for player 1 to press Play', 'Attends que le joueur 1 appuie sur Jouer', 'Aspetta che il giocatore 1 prema Gioca', 'Espere o jogador 1 apertar Jogar', '等待玩家 1 按下开始', '等待玩家 1 按下開始'],
    'Ocultar': ['Hide', 'Masquer', 'Nascondi', 'Ocultar', '隐藏', '隱藏'],
    'Autor original': ['Original author', 'Auteur original', 'Autore originale', 'Autor original', '原作者', '原作者'],
    'Esperando a los demás…': ['Waiting for the others…', 'En attente des autres…', 'In attesa degli altri…', 'Esperando os outros…', '正在等待其他人…', '正在等待其他人…'],
    '¡nuevo!': ['new!', 'nouveau !', 'nuovo!', 'novo!', '新！', '新！'],
    'Elegir movimientos': ['Choose moves', 'Choisir les capacités', 'Scegli le mosse', 'Escolher golpes', '选择招式', '選擇招式'],
    'Mostrar': ['Show', 'Afficher', 'Mostra', 'Mostrar', '显示', '顯示'],
    'Sólo': ['Only', 'Seulement', 'Solo', 'Só', '仅限', '僅限'],
    'Solo': ['Solo', 'Solo', 'Da solo', 'Solo', '单人', '單人'],
    'Limpiar filtros': ['Clear filters', 'Effacer les filtres', 'Cancella filtri', 'Limpar filtros', '清除筛选', '清除篩選'],
    'Elegir de compañero': ['Choose as partner', 'Choisir comme partenaire', 'Scegli come compagno', 'Escolher como parceiro', '选为伙伴', '選為夥伴'],
    'Legendarios vencidos': ['Legendaries defeated', 'Légendaires vaincus', 'Leggendari sconfitti', 'Lendários derrotados', '已击败的传说宝可梦', '已擊敗的傳說寶可夢'],
    'No se pudo entrar.': ['Could not log in.', 'Connexion impossible.', 'Accesso non riuscito.', 'Não foi possível entrar.', '无法登录。', '無法登入。'],
    'Entrar / Crear cuenta': ['Log in / Sign up', 'Connexion / Créer un compte', 'Accedi / Crea account', 'Entrar / Criar conta', '登录 / 注册', '登入 / 註冊'],
    'Guardado.': ['Saved.', 'Sauvegardé.', 'Salvato.', 'Salvo.', '已保存。', '已儲存。'],
    'Ver perfil': ['View profile', 'Voir le profil', 'Vedi profilo', 'Ver perfil', '查看资料', '查看資料'],
    'Ya no sois amigos: {x}': ['You are no longer friends: {x}', 'Vous n’êtes plus amis : {x}', 'Non siete più amici: {x}', 'Vocês não são mais amigos: {x}', '你们已不再是好友：{x}', '你們已不再是好友：{x}'],
    'Tu apodo': ['Your nickname', 'Ton pseudo', 'Il tuo soprannome', 'Seu apelido', '你的昵称', '你的暱稱'],
    'Entrando en la sala…': ['Joining the room…', 'Connexion au salon…', 'Entro nella stanza…', 'Entrando na sala…', '正在进入房间…', '正在進入房間…'],
    'No se pudo invitar ({x}).': ['Could not invite ({x}).', 'Invitation impossible ({x}).', 'Invito non riuscito ({x}).', 'Não foi possível convidar ({x}).', '无法邀请（{x}）。', '無法邀請（{x}）。'],
    'No se pudo entrar en la sala ({x}).': ['Could not join the room ({x}).', 'Impossible de rejoindre le salon ({x}).', 'Impossibile entrare nella stanza ({x}).', 'Não foi possível entrar na sala ({x}).', '无法进入房间（{x}）。', '無法進入房間（{x}）。'],
    'Aún no lo tienes. Consíguelo en el banner de {x} o derrotándolo cuando salga shiny.': ['You don’t have it yet. Get it from the {x} banner or by defeating it when it appears shiny.', 'Tu ne l’as pas encore. Obtiens-le dans la bannière {x} ou en le battant quand il apparaît chromatique.', 'Non lo hai ancora. Ottienilo nel banner di {x} o sconfiggendolo quando appare cromatico.', 'Você ainda não tem. Consiga no banner de {x} ou derrotando-o quando aparecer shiny.', '你还没有它。可在{x}卡池获得，或在它以异色出现时击败它。', '你還沒有它。可在{x}卡池獲得，或在它以異色出現時擊敗它。'],
    'Stick izq. / Cruceta': ['Left stick / D-pad', 'Stick gauche / Croix', 'Stick sinistro / Croce', 'Analógico esquerdo / Direcional', '左摇杆 / 方向键', '左搖桿 / 方向鍵'],
    'Eventos': ['Events', 'Événements', 'Eventi', 'Eventos', '活动', '活動'],
    'Forzar el evento (mapa, caramelos, skins, banner). Pulsa {confirm} para aplicar: el juego se reinicia.': ['Force the event (map, candy, skins, banner). Press {confirm} to apply: the game restarts.', 'Forcer l’événement (carte, bonbons, skins, bannière). Appuie sur {confirm} pour appliquer : le jeu redémarre.', 'Forza l’evento (mappa, caramelle, skin, banner). Premi {confirm} per applicare: il gioco si riavvia.', 'Forçar o evento (mapa, doces, skins, banner). Aperte {confirm} para aplicar: o jogo reinicia.', '强制活动（地图、糖果、皮肤、卡池）。按 {confirm} 应用：游戏会重启。', '強制活動（地圖、糖果、造型、卡池）。按 {confirm} 套用：遊戲會重新啟動。'],
    'Según la fecha': ['By date', 'Selon la date', 'In base alla data', 'Pela data', '按日期', '按日期'],
    'Siempre': ['Always', 'Toujours', 'Sempre', 'Sempre', '始终', '始終'],
    'Nunca': ['Never', 'Jamais', 'Mai', 'Nunca', '从不', '從不'],
    'Juego de fans gratuito y sin ánimo de lucro: sin anuncios ni compras. Pokémon y sus personajes son propiedad de Nintendo, Creatures y GAME FREAK; este proyecto no está afiliado a ellos.': ['Free, non-profit fan game: no ads or purchases. Pokémon and its characters are property of Nintendo, Creatures and GAME FREAK; this project is not affiliated with them.', 'Jeu de fans gratuit et sans but lucratif : sans pubs ni achats. Pokémon et ses personnages appartiennent à Nintendo, Creatures et GAME FREAK ; ce projet n’est pas affilié à eux.', 'Gioco di fan gratuito e senza scopo di lucro: niente pubblicità né acquisti. Pokémon e i suoi personaggi sono di proprietà di Nintendo, Creatures e GAME FREAK; questo progetto non è affiliato a loro.', 'Jogo de fãs gratuito e sem fins lucrativos: sem anúncios nem compras. Pokémon e seus personagens são propriedade da Nintendo, Creatures e GAME FREAK; este projeto não é afiliado a elas.', '免费的非营利粉丝游戏：没有广告也没有内购。Pokémon 及其角色归 Nintendo、Creatures 和 GAME FREAK 所有；本项目与它们无关。', '免費的非營利粉絲遊戲：沒有廣告也沒有內購。Pokémon 及其角色歸 Nintendo、Creatures 和 GAME FREAK 所有；本專案與它們無關。'],
    'Música y sonidos': ['Music and sounds', 'Musique et sons', 'Musica e suoni', 'Música e sons', '音乐和音效', '音樂和音效'],
    '¿Cerrar sesión?': ['Log out?', 'Se déconnecter ?', 'Uscire?', 'Sair?', '要退出登录吗？', '要登出嗎？'],
    'Lo de esta cuenta queda guardado en la nube.': ['Everything in this account stays saved in the cloud.', 'Tout ce qui est sur ce compte reste sauvegardé dans le cloud.', 'Tutto ciò che è in questo account resta salvato nel cloud.', 'Tudo desta conta fica salvo na nuvem.', '此账号的内容会保存在云端。', '此帳號的內容會儲存在雲端。'],
    'Versión nativa por DevVeda (GPL-3.0) · Juego original © 2026 JPTER78 (PolyForm Noncommercial 1.0.0)': ['Native version by DevVeda (GPL-3.0) · Original game © 2026 JPTER78 (PolyForm Noncommercial 1.0.0)', 'Version native par DevVeda (GPL-3.0) · Jeu original © 2026 JPTER78 (PolyForm Noncommercial 1.0.0)', 'Versione nativa di DevVeda (GPL-3.0) · Gioco originale © 2026 JPTER78 (PolyForm Noncommercial 1.0.0)', 'Versão nativa por DevVeda (GPL-3.0) · Jogo original © 2026 JPTER78 (PolyForm Noncommercial 1.0.0)', '原生版本：DevVeda（GPL-3.0）· 原版游戏 © 2026 JPTER78（PolyForm Noncommercial 1.0.0）', '原生版本：DevVeda（GPL-3.0）· 原版遊戲 © 2026 JPTER78（PolyForm Noncommercial 1.0.0）'],
    'Proyecto de fan sin ánimo de lucro · Sprites: SpriteCollab (CC BY-NC 4.0) · Pokémon © Nintendo/Creatures/GAME FREAK': ['Non-profit fan project · Sprites: SpriteCollab (CC BY-NC 4.0) · Pokémon © Nintendo/Creatures/GAME FREAK', 'Projet de fan sans but lucratif · Sprites : SpriteCollab (CC BY-NC 4.0) · Pokémon © Nintendo/Creatures/GAME FREAK', 'Progetto di fan senza scopo di lucro · Sprite: SpriteCollab (CC BY-NC 4.0) · Pokémon © Nintendo/Creatures/GAME FREAK', 'Projeto de fã sem fins lucrativos · Sprites: SpriteCollab (CC BY-NC 4.0) · Pokémon © Nintendo/Creatures/GAME FREAK', '非营利粉丝项目 · 精灵图：SpriteCollab (CC BY-NC 4.0) · Pokémon © Nintendo/Creatures/GAME FREAK', '非營利粉絲專案 · 精靈圖：SpriteCollab (CC BY-NC 4.0) · Pokémon © Nintendo/Creatures/GAME FREAK'],
    'Mejorar Pokémon': ['Upgrade Pokémon', 'Améliorer le Pokémon', 'Potenzia Pokémon', 'Melhorar Pokémon', '强化宝可梦', '強化寶可夢'],
    'Cambiar Pokémon': ['Change Pokémon', 'Changer de Pokémon', 'Cambia Pokémon', 'Trocar Pokémon', '更换宝可梦', '更換寶可夢'],
    'Atajos': ['Shortcuts', 'Raccourcis', 'Scorciatoie', 'Atalhos', '快捷键', '快捷鍵'],
    'Abrir en el móvil': ['Open on your phone', 'Ouvrir sur ton téléphone', 'Apri sul telefono', 'Abrir no celular', '在手机上打开', '在手機上開啟'],
    'Escanéalo con el móvil o escribe la dirección en el navegador:': ['Scan it with your phone or type the address in a browser:', 'Scanne-le avec ton téléphone ou tape l’adresse dans un navigateur :', 'Scansionalo con il telefono o scrivi l’indirizzo nel browser:', 'Escaneie com o celular ou digite o endereço no navegador:', '用手机扫描，或在浏览器中输入这个地址：', '用手機掃描，或在瀏覽器中輸入這個網址：'],
    'La versión original de PokéSurvivor era de código abierto; desde el 4 de noviembre de 2026 es de código cerrado.': ['The original PokéSurvivor used to be open source; since November 4, 2026 it has been closed source.', 'Le PokéSurvivor original était open source ; depuis le 4 novembre 2026, son code est fermé.', 'Il PokéSurvivor originale era open source; dal 4 novembre 2026 è a codice chiuso.', 'O PokéSurvivor original era de código aberto; desde 4 de novembro de 2026 é de código fechado.', '原版 PokéSurvivor 曾经是开源的；自 2026 年 11 月 4 日起改为闭源。', '原版 PokéSurvivor 曾經是開源的；自 2026 年 11 月 4 日起改為閉源。'],
    'PokéSurvivor Classic es gratis, sin anuncios ni compras. Si quieres ayudar a pagar los servidores, puedes donar en Ko-fi (escanéalo con el móvil):': ['PokéSurvivor Classic is free, with no ads or purchases. If you want to help pay for the servers, you can donate on Ko-fi (scan it with your phone):', 'PokéSurvivor Classic est gratuit, sans pubs ni achats. Si tu veux aider à payer les serveurs, tu peux faire un don sur Ko-fi (scanne-le avec ton téléphone) :', 'PokéSurvivor Classic è gratis, senza pubblicità né acquisti. Se vuoi aiutare a pagare i server, puoi donare su Ko-fi (scansionalo con il telefono):', 'PokéSurvivor Classic é grátis, sem anúncios nem compras. Se quiser ajudar a pagar os servidores, pode doar no Ko-fi (escaneie com o celular):', 'PokéSurvivor Classic 免费，没有广告也没有内购。想帮忙支付服务器费用，可以在 Ko-fi 捐助（用手机扫描）：', 'PokéSurvivor Classic 免費，沒有廣告也沒有內購。想幫忙支付伺服器費用，可以在 Ko-fi 捐助（用手機掃描）：'],
    'Escribe esta dirección en el navegador del móvil o del ordenador:': ['Type this address in your phone or computer browser:', 'Saisis cette adresse dans le navigateur de ton téléphone ou ordinateur :', 'Scrivi questo indirizzo nel browser del telefono o del computer:', 'Digite este endereço no navegador do celular ou do computador:', '在手机或电脑的浏览器中输入这个地址：', '在手機或電腦的瀏覽器中輸入這個網址：'],
    'Shinies conseguidos': ['Shinies caught', 'Shinies obtenus', 'Shiny ottenuti', 'Shinies conseguidos', '获得的闪光宝可梦', '獲得的閃光寶可夢'],
    'Jugador': ['Player', 'Joueur', 'Giocatore', 'Jogador', '玩家', '玩家'],
    'y': ['and', 'et', 'e', 'e', '和', '和'],
    'Tu elección': ['Your pick', 'Ton choix', 'La tua scelta', 'Sua escolha', '你的选择', '你的選擇'],
    'Mientras haya alguno encendido no se guarda nada (ni aquí ni en la nube, ni a mano ni solo) y no hay marcas en el ranking. Al apagarlos todos vuelves a tu partida tal cual.': ['While any of them is on nothing is saved (neither here nor in the cloud, neither manually nor automatically) and there are no leaderboard marks. Turning them all off brings back your save exactly as it was.', 'Tant qu’une est activée, rien n’est sauvegardé (ni ici ni dans le cloud, ni à la main ni automatiquement) et aucun score au classement. En les désactivant toutes, tu retrouves ta partie telle quelle.', 'Finché ce n’è uno attivo non si salva nulla (né qui né nel cloud, né a mano né in automatico) e nessun record in classifica. Disattivandoli tutti torni al tuo salvataggio così com’era.', 'Enquanto algum estiver ligado nada é salvo (nem aqui nem na nuvem, nem manualmente nem automaticamente) e não há marcas no ranking. Ao desligar todos, você volta ao seu save como estava.', '只要开启任意一项，就不会保存任何内容（本机和云端、手动和自动都不保存），也不计入排行榜。全部关闭后恢复你原来的存档。', '只要開啟任意一項，就不會儲存任何內容（本機和雲端、手動和自動都不儲存），也不計入排行榜。全部關閉後恢復你原來的存檔。'],
    'Trucos: sin guardar': ['Cheats: no saving', 'Triches : sans sauvegarde', 'Trucchi: senza salvataggio', 'Truques: sem salvar', '作弊：不保存', '作弊：不儲存'],
    'Mientras haya algún truco encendido, tu partida NO se guarda (ni aquí ni en la nube) y tus partidas no llegan al ranking. Al apagarlos vuelves a tu partida de antes; lo que pase mientras, se pierde.': ['While any cheat is on, your save is NOT kept (neither here nor in the cloud) and your runs don’t reach the leaderboard. Turning them off brings back your previous save; anything in between is lost.', 'Tant qu’une triche est activée, ta partie n’est PAS sauvegardée (ni ici ni dans le cloud) et tes parties n’arrivent pas au classement. En les désactivant, tu retrouves ta partie d’avant ; ce qui se passe entre-temps est perdu.', 'Finché c’è un trucco attivo, il tuo salvataggio NON viene salvato (né qui né nel cloud) e le tue partite non arrivano in classifica. Disattivandoli torni al salvataggio di prima; quello che succede nel frattempo si perde.', 'Enquanto algum truque estiver ligado, seu save NÃO é salvo (nem aqui nem na nuvem) e suas partidas não chegam ao ranking. Ao desligar, você volta ao save de antes; o que acontecer nesse meio-tempo se perde.', '只要开启任意作弊，你的存档就不会保存（本机和云端都不保存），对局也不会计入排行榜。关闭后恢复之前的存档；期间的进度会丢失。', '只要開啟任意作弊，你的存檔就不會儲存（本機和雲端都不儲存），對局也不會計入排行榜。關閉後恢復之前的存檔；期間的進度會遺失。'],
    'Activar': ['Turn on', 'Activer', 'Attiva', 'Ativar', '开启', '開啟'],
    'Con trucos no se guarda nada.': ['Nothing is saved while cheats are on.', 'Rien n’est sauvegardé avec les triches.', 'Con i trucchi non si salva nulla.', 'Com truques nada é salvo.', '开启作弊时不会保存任何内容。', '開啟作弊時不會儲存任何內容。'],
    'Con el modo dev: el evento de Halloween aunque no sea su fecha (mapa, caramelos, skins, banner). El juego se reinicia.': ['With dev mode: the Halloween event even when it isn’t its date (map, candy, skins, banner). The game restarts.', 'Avec le mode dev : l’événement Halloween même hors de sa date (carte, bonbons, skins, bannière). Le jeu redémarre.', 'Con la modalità dev: l’evento di Halloween anche fuori data (mappa, caramelle, skin, banner). Il gioco si riavvia.', 'Com o modo dev: o evento de Halloween mesmo fora da data (mapa, doces, skins, banner). O jogo reinicia.', '开发模式下：即使不在日期内也开启万圣节活动（地图、糖果、皮肤、卡池）。游戏会重新启动。', '開發模式下：即使不在日期內也開啟萬聖節活動（地圖、糖果、造型、卡池）。遊戲會重新啟動。'],
    'Se combinan entre sí. Orden y tipo: elige uno.': ['They combine. Order and type: pick one.', 'Ils se combinent. Ordre et type : choisis-en un.', 'Si combinano. Ordine e tipo: scegline uno.', 'Eles se combinam. Ordem e tipo: escolha um.', '可以组合使用。排序和属性：各选一个。', '可以組合使用。排序和屬性：各選一個。'],
    'Filtros': ['Filters', 'Filtres', 'Filtri', 'Filtros', '筛选', '篩選'],
    'Orden': ['Order', 'Ordre', 'Ordine', 'Ordem', '排序', '排序'],
    'No se pudo conectar con los servidores. Inténtalo de nuevo.': ['Could not reach the servers. Try again.', 'Impossible de joindre les serveurs. Réessaie.', 'Impossibile raggiungere i server. Riprova.', 'Não foi possível conectar aos servidores. Tente de novo.', '无法连接服务器，请重试。', '無法連線伺服器，請重試。'],
    'Conectando…': ['Connecting…', 'Connexion…', 'Connessione…', 'Conectando…', '连接中…', '連線中…'],
    'Botones': ['Buttons', 'Boutons', 'Pulsanti', 'Botões', '按钮', '按鈕'],
    'Bloqueado': ['Locked', 'Verrouillé', 'Bloccato', 'Bloqueado', '未解锁', '未解鎖'],
    'Desplazar': ['Scroll', 'Défiler', 'Scorri', 'Rolar', '滚动', '捲動'],
    'Ficha': ['Details', 'Fiche', 'Scheda', 'Ficha', '详情', '詳情'],
    'Filtro': ['Filter', 'Filtre', 'Filtro', 'Filtro', '筛选', '篩選'],
    'Hueco': ['Slot', 'Emplacement', 'Slot', 'Espaço', '栏位', '欄位'],
    'Mover': ['Move', 'Déplacer', 'Muovi', 'Mover', '移动', '移動'],
    'Ningún Pokémon con estos filtros': ['No Pokémon match these filters', 'Aucun Pokémon avec ces filtres', 'Nessun Pokémon con questi filtri', 'Nenhum Pokémon com esses filtros', '没有符合筛选的宝可梦', '沒有符合篩選的寶可夢'],
    'Normal / shiny': ['Normal / shiny', 'Normal / chromatique', 'Normale / cromatico', 'Normal / brilhante', '普通 / 闪光', '普通 / 異色'],
    'Qué movimiento va siempre en cada hueco': ['Which move always goes in each slot', 'Quelle attaque va dans chaque emplacement', 'Quale mossa va in ogni slot', 'Qual golpe vai em cada espaço', '每个栏位固定放哪个招式', '每個欄位固定放哪個招式'],
    'Se gasta al enseñarla y la aprende para siempre': ['Used up when taught; learned forever', 'Consommée en l\'apprenant, apprise pour toujours', 'Si consuma insegnandola, la impara per sempre', 'É gasta ao ensinar e aprendida para sempre', '教授后消耗，永久学会', '教授後消耗，永久學會'],
    'Se guarda lo que hayas conseguido.': ['What you earned is kept.', 'Ce que tu as gagné est conservé.', 'Ciò che hai ottenuto resta salvato.', 'O que você conseguiu fica salvo.', '已获得的奖励会保留。', '已獲得的獎勵會保留。'],
    'Siguientes': ['Next', 'Suivants', 'Successivi', 'Próximos', '下一页', '下一頁'],
    'Sí, abandonar': ['Yes, quit', 'Oui, abandonner', 'Sì, abbandona', 'Sim, abandonar', '是，放弃', '是，放棄'],
    '¿Abandonar la run?': ['Quit the run?', 'Abandonner la partie ?', 'Abbandonare la run?', 'Abandonar a run?', '放弃本局？', '放棄本局？'],
    'Tirar': ['Pull', 'Tirer', 'Tira', 'Girar', '抽取', '抽取'],
    'Repetido': ['Duplicate', 'Doublon', 'Doppione', 'Repetido', '重复', '重複'],
    'de serie': ['default', 'par défaut', 'predefinita', 'padrão', '默认', '預設'],
    'usar': ['use', 'utiliser', 'usa', 'usar', '使用', '使用'],
    'vetado': ['banned', 'exclue', 'esclusa', 'vetado', '已禁用', '已禁用'],
    'Resolución': ['Resolution', 'Résolution', 'Risoluzione', 'Resolução', '分辨率', '解析度'],
    'Más alta: más nítido, y más trabajo para el ordenador.': ['Higher: sharper, and more work for the computer.', 'Plus haute : plus net, et plus de travail pour l’ordinateur.', 'Più alta: più nitido, e più lavoro per il computer.', 'Mais alta: mais nítido, e mais trabalho para o computador.', '越高越清晰，电脑负担也越大。', '越高越清晰，電腦負擔也越大。'],
    'Pulsa {confirm} para cambiar: el juego se reinicia.': ['Press {confirm} to change: the game restarts.', 'Appuie sur {confirm} pour changer : le jeu redémarre.', 'Premi {confirm} per cambiare: il gioco si riavvia.', 'Aperte {confirm} para mudar: o jogo reinicia.', '按 {confirm} 切换：游戏会重新启动。', '按 {confirm} 切換：遊戲會重新啟動。'],
    'Aplicar': ['Apply', 'Appliquer', 'Applica', 'Aplicar', '应用', '套用'],
    'La misma cuenta y la misma partida que en la web': ['The same account and save as on the website', 'Le même compte et la même partie que sur le site', 'Lo stesso account e lo stesso salvataggio del sito', 'A mesma conta e o mesmo jogo do site', '与网页版相同的账号和存档', '與網頁版相同的帳號和存檔'],
    'Usar la cuenta de la consola': ['Use the console account', 'Utiliser le compte de la console', "Usa l'account della console", 'Usar a conta do console', '使用主机账号', '使用主機帳號'],
    'Usar una cuenta online': ['Use an online account', 'Utiliser un compte en ligne', 'Usa un account online', 'Usar uma conta online', '使用在线账号', '使用線上帳號'],
    'Cuenta de la consola': ['Console account', 'Compte de la console', 'Account della console', 'Conta do console', '主机账号', '主機帳號'],
    'Tu partida se guarda sólo en esta PS5.': ['Your save is only stored on this PS5.', 'Ta partie est enregistrée seulement sur cette PS5.', 'Il salvataggio resta solo su questa PS5.', 'Seu jogo fica salvo só neste PS5.', '存档只保存在这台 PS5 上。', '存檔只儲存在這台 PS5 上。'],
    'La misma cuenta y la misma partida que en la web. La primera vez puedes juntar tu partida de la consola con la online.': ['The same account and save as on the website. The first time you can merge your console save with the online one.', 'Le même compte et la même partie que sur le site. La première fois, tu peux fusionner ta partie de la console avec celle en ligne.', 'Lo stesso account e salvataggio del sito. La prima volta puoi unire il salvataggio della console con quello online.', 'A mesma conta e o mesmo jogo do site. Na primeira vez você pode juntar o jogo do console com o online.', '与网页版相同的账号和存档。第一次可以把主机存档与在线存档合并。', '與網頁版相同的帳號和存檔。第一次可以把主機存檔與線上存檔合併。'],
    'Sin conexión con la nube': ['No connection to the cloud', 'Pas de connexion au cloud', 'Nessuna connessione al cloud', 'Sem conexão com a nuvem', '无法连接云端', '無法連線雲端'],
    'La cuenta online no se pudo abrir': ['The online account could not be opened', "Le compte en ligne n'a pas pu s'ouvrir", "Non è stato possibile aprire l'account online", 'Não foi possível abrir a conta online', '无法打开在线账号', '無法開啟線上帳號'],
    'Reintentar': ['Retry', 'Réessayer', 'Riprova', 'Tentar de novo', '重试', '重試'],
    'Guardar en la nube': ['Save to the cloud', 'Sauvegarder dans le cloud', 'Salva nel cloud', 'Salvar na nuvem', '保存到云端', '儲存到雲端'],
    'No responde. Revisa la conexión y vuelve a intentarlo.': ['No response. Check your connection and try again.', 'Pas de réponse. Vérifie ta connexion et réessaie.', 'Nessuna risposta. Controlla la connessione e riprova.', 'Sem resposta. Verifique a conexão e tente de novo.', '没有响应。请检查网络后重试。', '沒有回應。請檢查網路後重試。'],
    'Servidor': ['Server', 'Serveur', 'Server', 'Servidor', '服务器', '伺服器'],
    'Cambiar de servidor': ['Change server', 'Changer de serveur', 'Cambia server', 'Trocar de servidor', '更换服务器', '更換伺服器'],
    'Volver al servidor por defecto': ['Back to the default server', 'Revenir au serveur par défaut', 'Torna al server predefinito', 'Voltar ao servidor padrão', '恢复默认服务器', '恢復預設伺服器'],
    // @step server/load
    'Tu cuenta online, partida, amigos, ranking y cooperativo son de este servidor. Para usar otro, escribe su web (la que tiene pokesurvivor-server.json).': ['Your online account, save, friends, leaderboard and co-op belong to this server. To use another one, type its website (the one with pokesurvivor-server.json).', 'Ton compte en ligne, ta partie, tes amis, le classement et la coop appartiennent à ce serveur. Pour en utiliser un autre, écris son site (celui qui a pokesurvivor-server.json).', 'Account online, salvataggio, amici, classifica e cooperativa appartengono a questo server. Per usarne un altro, scrivi il suo sito (quello con pokesurvivor-server.json).', 'Sua conta online, jogo, amigos, ranking e cooperativo são deste servidor. Para usar outro, digite o site dele (o que tem pokesurvivor-server.json).', '你的在线账号、存档、好友、排行榜和合作模式都属于这个服务器。要使用其他服务器，请输入它的网址（带有 pokesurvivor-server.json 的那个）。', '你的線上帳號、存檔、好友、排行榜和合作模式都屬於這個伺服器。要使用其他伺服器，請輸入它的網址（帶有 pokesurvivor-server.json 的那個）。'],
    'Escribe la dirección del servidor.': ['Type the server address.', "Écris l'adresse du serveur.", "Scrivi l'indirizzo del server.", 'Digite o endereço do servidor.', '请输入服务器地址。', '請輸入伺服器位址。'],
    'La dirección tiene que ser https://…': ['The address must be https://…', "L'adresse doit être https://…", "L'indirizzo deve essere https://…", 'O endereço tem que ser https://…', '地址必须是 https://…', '位址必須是 https://…'],
    'No se encontró el servidor': ['Server not found', 'Serveur introuvable', 'Server non trovato', 'Servidor não encontrado', '找不到服务器', '找不到伺服器'],
    'Ese servidor no tiene una configuración válida.': ["That server doesn't have a valid configuration.", "Ce serveur n'a pas de configuration valide.", 'Quel server non ha una configurazione valida.', 'Esse servidor não tem uma configuração válida.', '该服务器的配置无效。', '該伺服器的設定無效。'],
    'No se pudo guardar.': ["Couldn't save.", "Impossible d'enregistrer.", 'Impossibile salvare.', 'Não foi possível salvar.', '无法保存。', '無法儲存。'],
    // @step server/acc screen "Ajustes → Cuenta"
    // Pantalla nativa (canvas): servidor actual, cambiarlo, volver al de por defecto o traer la partida de
    // la web.
    // @next load "cambiar"
    // @next reset
    // @next import
    'Traer mi partida de la web': ['Bring my save from the website', 'Récupérer ma partie du site', 'Porta il mio salvataggio dal sito', 'Trazer meu jogo do site', '从网页版导入存档', '從網頁版匯入存檔'],
    'Abre pokesurvivor.com en tu navegador y cambia tu partida de aquí (y la de la nube) por la que tengas allí.': ['Opens pokesurvivor.com in your browser and replaces your save here (and in the cloud) with the one you have there.', 'Ouvre pokesurvivor.com dans ton navigateur et remplace ta partie d’ici (et celle du cloud) par celle que tu as là-bas.', 'Apre pokesurvivor.com nel browser e sostituisce il salvataggio di qui (e del cloud) con quello che hai lì.', 'Abre pokesurvivor.com no navegador e troca o seu jogo daqui (e o da nuvem) pelo que você tem lá.', '在浏览器中打开 pokesurvivor.com，用那里的存档替换这里（以及云端）的存档。', '在瀏覽器中開啟 pokesurvivor.com，用那裡的存檔取代這裡（以及雲端）的存檔。'],
    'Anclado': ['Anchored', 'Ancré', 'Ancorato', 'Ancorado', '锚定', '錨定'],
    'Dónde aparece el joystick: donde pones el dedo (y te sigue o se queda ahí) o siempre en el mismo sitio, abajo a la izquierda.': ['Where the joystick appears: where you put your finger (following it or staying there) or always in the same spot, bottom left.', 'Où apparaît le joystick : là où tu poses le doigt (il le suit ou reste là) ou toujours au même endroit, en bas à gauche.', 'Dove appare il joystick: dove metti il dito (lo segue o resta lì) o sempre nello stesso punto, in basso a sinistra.', 'Onde o joystick aparece: onde você põe o dedo (seguindo-o ou ficando ali) ou sempre no mesmo lugar, embaixo à esquerda.', '摇杆出现的位置：手指按下处（跟随手指或停在原处），或始终在左下角同一位置。', '搖桿出現的位置：手指按下處（跟隨手指或停在原處），或始終在左下角同一位置。'],
    'Toca la pantalla': ['Touch screen', 'Écran tactile', 'Touch screen', 'Tela de toque', '触摸屏', '觸控螢幕'],
    'Arrastra en cualquier sitio para moverte; toca un ataque o una esfera para usarlos y el botón de arriba a la derecha para pausar.': ['Drag anywhere to move; tap a move or an orb to use it and the top-right button to pause.', 'Fais glisser n’importe où pour te déplacer ; touche une capacité ou une sphère pour l’utiliser et le bouton en haut à droite pour mettre en pause.', 'Trascina ovunque per muoverti; tocca una mossa o una sfera per usarla e il pulsante in alto a destra per mettere in pausa.', 'Arraste em qualquer lugar para se mover; toque num golpe ou numa esfera para usá-los e no botão no canto superior direito para pausar.', '在任意位置拖动即可移动；点按招式或宝珠即可使用，点按右上角按钮暂停。', '在任意位置拖動即可移動；點按招式或寶珠即可使用，點按右上角按鈕暫停。'],
    'Varios jugadores en este dispositivo: el teclado (si lo hay) es el jugador 1 y cada mando entra pulsando {confirm} en el suyo. Sin teclado, hacen falta dos mandos.': ['Several players on this device: the keyboard (if there is one) is player 1 and each controller joins by pressing {confirm} on it. Without a keyboard, you need two controllers.', 'Plusieurs joueurs sur cet appareil : le clavier (s’il y en a un) est le joueur 1 et chaque manette rejoint en appuyant sur {confirm}. Sans clavier, il faut deux manettes.', 'Più giocatori su questo dispositivo: la tastiera (se c’è) è il giocatore 1 e ogni controller entra premendo {confirm}. Senza tastiera, servono due controller.', 'Vários jogadores neste aparelho: o teclado (se houver) é o jogador 1 e cada controle entra apertando {confirm} nele. Sem teclado, são precisos dois controles.', '在此设备上多人游戏：键盘（如果有）是玩家 1，每个手柄按 {confirm} 加入。没有键盘时需要两个手柄。', '在此裝置上多人遊戲：鍵盤（如果有）是玩家 1，每個手把按 {confirm} 加入。沒有鍵盤時需要兩個手把。'],
    'Elige el archivo .json de tu partida (el que baja la extensión de PokéSurvivor en pokesurvivor.com).': ['Pick your save .json file (the one the PokéSurvivor extension downloads on pokesurvivor.com).', 'Choisis le fichier .json de ta partie (celui que télécharge l’extension PokéSurvivor sur pokesurvivor.com).', 'Scegli il file .json del tuo salvataggio (quello che scarica l’estensione di PokéSurvivor su pokesurvivor.com).', 'Escolha o arquivo .json do seu jogo (o que a extensão do PokéSurvivor baixa em pokesurvivor.com).', '选择你的存档 .json 文件（pokesurvivor.com 上 PokéSurvivor 扩展下载的那个）。', '選擇你的存檔 .json 檔案（pokesurvivor.com 上 PokéSurvivor 擴充功能下載的那個）。'],
    'Toca el código para abrir la dirección en el navegador y escríbelo allí; luego vuelve al juego.': ['Tap the code to open the address in your browser and type it there; then come back to the game.', 'Touche le code pour ouvrir l’adresse dans ton navigateur et tape-le là-bas ; puis reviens au jeu.', 'Tocca il codice per aprire l’indirizzo nel browser e scrivilo lì; poi torna al gioco.', 'Toque no código para abrir o endereço no navegador e digite-o lá; depois volte ao jogo.', '点按代码即可在浏览器中打开该地址并在那里输入；然后回到游戏。', '點按代碼即可在瀏覽器中開啟該網址並在那裡輸入；然後回到遊戲。'],
    'Importar partida de un archivo': ['Import save from a file', 'Importer une partie depuis un fichier', 'Importa salvataggio da un file', 'Importar jogo de um arquivo', '从文件导入存档', '從檔案匯入存檔'],
    'Esperando el archivo…': ['Waiting for the file…', 'En attente du fichier…', 'In attesa del file…', 'Esperando o arquivo…', '等待文件…', '等待檔案…'],
    'Arrastra a esta ventana el archivo .json de tu partida (el que baja la extensión de PokéSurvivor en pokesurvivor.com).': ['Drag your save .json file into this window (the one the PokéSurvivor extension downloads on pokesurvivor.com).', 'Fais glisser dans cette fenêtre le fichier .json de ta partie (celui que télécharge l’extension PokéSurvivor sur pokesurvivor.com).', 'Trascina in questa finestra il file .json del tuo salvataggio (quello che scarica l’estensione di PokéSurvivor su pokesurvivor.com).', 'Arraste para esta janela o arquivo .json do seu jogo (o que a extensão do PokéSurvivor baixa em pokesurvivor.com).', '把存档 .json 文件拖到这个窗口（就是 PokéSurvivor 扩展在 pokesurvivor.com 下载的那个）。', '把存檔 .json 檔案拖到這個視窗（就是 PokéSurvivor 擴充功能在 pokesurvivor.com 下載的那個）。'],
    'No se pudo leer el archivo.': ['Could not read the file.', 'Impossible de lire le fichier.', 'Impossibile leggere il file.', 'Não foi possível ler o arquivo.', '无法读取文件。', '無法讀取檔案。'],
    'Esperando a la web…': ['Waiting for the website…', 'En attente du site…', 'In attesa del sito…', 'Esperando o site…', '等待网页…', '等待網頁…'],
    'Se ha abierto pokesurvivor.com en tu navegador. Allí, acepta enviar tu partida al juego.': ['pokesurvivor.com has opened in your browser. There, accept sending your save to the game.', 'pokesurvivor.com s’est ouvert dans ton navigateur. Là-bas, accepte d’envoyer ta partie au jeu.', 'pokesurvivor.com si è aperto nel browser. Lì, accetta di inviare il salvataggio al gioco.', 'pokesurvivor.com abriu no seu navegador. Lá, aceite enviar seu jogo para o jogo.', 'pokesurvivor.com 已在浏览器中打开。请在那里同意把存档发送到游戏。', 'pokesurvivor.com 已在瀏覽器中開啟。請在那裡同意把存檔傳送到遊戲。'],
    'No se pudo abrir el navegador.': ["Couldn't open the browser.", "Impossible d'ouvrir le navigateur.", 'Impossibile aprire il browser.', 'Não foi possível abrir o navegador.', '无法打开浏览器。', '無法開啟瀏覽器。'],
    '¿Cambiar tu partida por la de la web?': ['Replace your save with the website one?', 'Remplacer ta partie par celle du site ?', 'Sostituire il salvataggio con quello del sito?', 'Trocar seu jogo pelo do site?', '用网页版存档替换你的存档？', '用網頁版存檔取代你的存檔？'],
    'Tu partida de aquí y la de la nube se sustituyen por la de la web ({x} Pokémon; ahora tienes {x}). No se puede deshacer.': ['Your save here and in the cloud are replaced by the website one ({x} Pokémon; you now have {x}). This cannot be undone.', 'Ta partie d’ici et celle du cloud sont remplacées par celle du site ({x} Pokémon ; tu en as {x}). Impossible d’annuler.', 'Il salvataggio di qui e del cloud viene sostituito da quello del sito ({x} Pokémon; ora ne hai {x}). Non si può annullare.', 'Seu jogo daqui e o da nuvem são substituídos pelo do site ({x} Pokémon; agora você tem {x}). Não dá para desfazer.', '这里和云端的存档将被网页版存档替换（{x} 只宝可梦；你现在有 {x} 只）。无法撤销。', '這裡和雲端的存檔將被網頁版存檔取代（{x} 隻寶可夢；你現在有 {x} 隻）。無法復原。'],
    'Sustituir': ['Replace', 'Remplacer', 'Sostituisci', 'Substituir', '替换', '取代'],
    'Partida traída de la web.': ['Save brought from the website.', 'Partie récupérée du site.', 'Salvataggio portato dal sito.', 'Jogo trazido do site.', '已从网页版导入存档。', '已從網頁版匯入存檔。'],
    'Esa partida no es válida.': ["That save isn't valid.", "Cette partie n'est pas valide.", 'Quel salvataggio non è valido.', 'Esse jogo não é válido.', '该存档无效。', '該存檔無效。'],
    'navegador': ['browser', 'navigateur', 'browser', 'navegador', '浏览器', '瀏覽器'],
    'Termina de entrar en el navegador…': ['Finish signing in in your browser…', 'Termine la connexion dans ton navigateur…', 'Completa l’accesso nel browser…', 'Termine de entrar no navegador…', '请在浏览器中完成登录…', '請在瀏覽器中完成登入…'],
    'Google no dejó entrar.': ['Google did not let you in.', 'Google a refusé la connexion.', 'Google non ha consentito l’accesso.', 'O Google não deixou entrar.', 'Google 拒绝了登录。', 'Google 拒絕了登入。'],
    'Sin conexión a internet.': ['No internet connection.', 'Pas de connexion internet.', 'Nessuna connessione a internet.', 'Sem conexão com a internet.', '没有网络连接。', '沒有網路連線。'],
    'Recoger todo': ['Claim all', 'Tout récupérer', 'Riscuoti tutto', 'Pegar tudo', '全部领取', '全部領取'],
    '¡{x} premios recogidos!': ['{x} rewards claimed!', '{x} récompenses récupérées !', '{x} premi riscossi!', '{x} prêmios pegos!', '已领取 {x} 个奖励！', '已領取 {x} 個獎勵！'],
    '¿Normal o shiny?': ['Normal or shiny?', 'Normal ou chromatique ?', 'Normale o shiny?', 'Normal ou shiny?', '普通还是闪光？', '普通還是閃光？'],
    'Jugar sin conexión': ['Play offline', 'Jouer hors ligne', 'Gioca offline', 'Jogar offline', '离线游玩', '離線遊玩'],
    'Jugar como invitado': ['Play as guest', 'Jouer en invité', 'Gioca come ospite', 'Jogar como convidado', '以游客身份游玩', '以訪客身分遊玩'],
    'Cuenta local': ['Local account', 'Compte local', 'Account locale', 'Conta local', '本地账号', '本機帳號'],
    'Tu partida se guarda sólo en este ordenador.': ['Your save is only kept on this computer.', 'Ta partie est enregistrée seulement sur cet ordinateur.', 'Il salvataggio resta solo su questo computer.', 'Seu jogo fica salvo só neste computador.', '你的存档只保存在这台电脑上。', '你的存檔只儲存在這台電腦上。'],
    'Firebase no contesta. Puedes reintentarlo o jugar sin conexión (tu partida de este ordenador).': ['Firebase is not responding. You can retry or play offline (your save on this computer).', 'Firebase ne répond pas. Tu peux réessayer ou jouer hors ligne.', 'Firebase non risponde. Puoi riprovare o giocare offline.', 'O Firebase não responde. Você pode tentar de novo ou jogar offline.', 'Firebase 没有响应。可以重试，或离线游玩。', 'Firebase 沒有回應。可以重試，或離線遊玩。'],
    'Versión': ['Version', 'Version', 'Versione', 'Versão', '版本', '版本'],
    'Windows, macOS y Linux': ['Windows, macOS and Linux', 'Windows, macOS et Linux', 'Windows, macOS e Linux', 'Windows, macOS e Linux', 'Windows、macOS 和 Linux', 'Windows、macOS 和 Linux'],
    'No se pudo abrir la cuenta online': ["Couldn't open the online account", "Impossible d'ouvrir le compte en ligne", "Impossibile aprire l'account online", 'Não foi possível abrir a conta online', '无法打开在线账号', '無法開啟線上帳號'],
    'Firebase no contesta. Puedes reintentarlo o seguir con la cuenta de la consola (tu partida de esta PS5).': ['Firebase is not responding. You can retry or keep using the console account (your save on this PS5).', 'Firebase ne répond pas. Tu peux réessayer ou continuer avec le compte de la console.', 'Firebase non risponde. Puoi riprovare o continuare con l\'account della console.', 'O Firebase não responde. Você pode tentar de novo ou seguir com a conta do console.', 'Firebase 没有响应。可以重试，或继续使用主机账号。', 'Firebase 沒有回應。可以重試，或繼續使用主機帳號。'],
    'Conectando…': ['Connecting…', 'Connexion…', 'Connessione…', 'Conectando…', '连接中…', '連線中…'],
    'Si guardas en la web (botón Guardar), aquí verás tu progreso.': ['If you save on the web (Save button), you will see your progress here.', 'Si tu sauvegardes sur le web (bouton Sauvegarder), tu verras ta progression ici.', 'Se salvi sul web (pulsante Salva), qui vedrai i tuoi progressi.', 'Se você salvar na web (botão Salvar), verá seu progresso aqui.', '在网页上保存（保存按钮）后，这里就能看到你的进度。', '在網頁上儲存（儲存按鈕）後，這裡就能看到你的進度。'],
    '¿Traer tu partida de la consola?': ['Bring your console save?', 'Récupérer ta partie de la console ?', 'Portare il salvataggio della console?', 'Trazer seu jogo do console?', '要导入主机存档吗？', '要匯入主機存檔嗎？'],
    'En esta PS5 ya tenías una partida. Se puede juntar con la de tu cuenta online: te quedas con lo mejor de las dos (Pokémon, monedas, mejoras, logros).': ['You already had a save on this PS5. It can be merged with your online account: you keep the best of both (Pokémon, coins, upgrades, achievements).', 'Tu avais déjà une partie sur cette PS5. Elle peut être fusionnée avec ton compte en ligne : tu gardes le meilleur des deux.', 'Avevi già un salvataggio su questa PS5. Si può unire al tuo account online: tieni il meglio di entrambi.', 'Você já tinha um jogo neste PS5. Dá para juntar com a conta online: fica com o melhor dos dois.', '这台 PS5 上已有存档，可以与在线账号合并，保留两边最好的进度。', '這台 PS5 上已有存檔，可以與線上帳號合併，保留兩邊最好的進度。'],
    'En la consola: {x} Pokémon · en la cuenta: {x}': ['On the console: {x} Pokémon · on the account: {x}', 'Sur la console : {x} Pokémon · sur le compte : {x}', 'Sulla console: {x} Pokémon · sull\'account: {x}', 'No console: {x} Pokémon · na conta: {x}', '主机：{x} 只宝可梦 · 账号：{x}', '主機：{x} 隻寶可夢 · 帳號：{x}'],
    'Sí, juntarlas': ['Yes, merge them', 'Oui, fusionner', 'Sì, uniscili', 'Sim, juntar', '是，合并', '是，合併'],
    'Partidas juntadas: pulsa Guardar para subirla a la nube.': ['Saves merged: press Save to upload it to the cloud.', 'Parties fusionnées : appuie sur Sauvegarder pour l\'envoyer.', 'Salvataggi uniti: premi Salva per caricarlo.', 'Jogos juntados: aperte Salvar para enviar à nuvem.', '已合并：按保存上传到云端。', '已合併：按儲存上傳到雲端。'],
    'No se pudo juntar la partida.': ["Couldn't merge the save.", "Impossible de fusionner la partie.", 'Impossibile unire il salvataggio.', 'Não foi possível juntar o jogo.', '无法合并存档。', '無法合併存檔。'],
    'Guardado en la nube.': ['Saved to the cloud.', 'Sauvegardé dans le cloud.', 'Salvato nel cloud.', 'Salvo na nuvem.', '已保存到云端。', '已儲存到雲端。'],
    'Ya estaba todo guardado.': ['Everything was already saved.', 'Tout était déjà sauvegardé.', 'Era già tutto salvato.', 'Já estava tudo salvo.', '已经全部保存。', '已經全部儲存。'],
    'Sin conexión: se guardará cuando vuelva.': ['Offline: it will save when the connection is back.', 'Hors ligne : la sauvegarde se fera au retour de la connexion.', 'Offline: si salverà quando torna la connessione.', 'Sem conexão: será salvo quando voltar.', '离线：恢复连接后保存。', '離線：恢復連線後儲存。'],
    'No se pudo guardar.': ["Couldn't save.", 'Impossible de sauvegarder.', 'Impossibile salvare.', 'Não foi possível salvar.', '无法保存。', '無法儲存。'],
    'Se guardará en {x} s.': ['It will save in {x} s.', 'Sauvegarde dans {x} s.', 'Si salverà tra {x} s.', 'Será salvo em {x} s.', '{x} 秒后保存。', '{x} 秒後儲存。'],
    'MAYÚSCULAS': ['CAPS', 'MAJ', 'MAIUSC', 'MAIÚSC', '大写', '大寫'],
    'minúsculas': ['lower', 'min', 'minusc', 'minúsc', '小写', '小寫'],
    'Borrar': ['Delete', 'Effacer', 'Cancella', 'Apagar', '删除', '刪除'],
    'Aceptar': ['OK', 'OK', 'OK', 'OK', '确定', '確定'],
    'Escribir': ['Type', 'Écrire', 'Scrivi', 'Digitar', '输入', '輸入'],
    'Mayúsculas': ['Caps', 'Majuscules', 'Maiuscole', 'Maiúsculas', '大写', '大寫'],
    'Escanéalo con el móvil (o abre la dirección) y escribe este código:': ['Scan it with your phone (or open the address) and enter this code:', 'Scanne-le avec ton téléphone (ou ouvre l’adresse) et saisis ce code :', 'Scansionalo con il telefono (o apri l’indirizzo) e inserisci questo codice:', 'Escaneie com o celular (ou abra o endereço) e digite este código:', '用手机扫描（或打开该网址）并输入此代码：', '用手機掃描（或打開該網址）並輸入此代碼：'],
    'El código caducó. Vuelve a intentarlo.': ['The code expired. Try again.', 'Le code a expiré. Réessaie.', 'Il codice è scaduto. Riprova.', 'O código expirou. Tente de novo.', '代码已过期，请重试。', '代碼已過期，請重試。'],
    '¿Te está gustando PokéSurvivor Classic? Lo hago yo solo y los servidores cuestan dinero. Si quieres, puedes ayudarme a mantenerlo en línea.': ['Enjoying PokéSurvivor Classic? I make it on my own and the servers cost money. If you like, you can help me keep it online.', 'Tu aimes PokéSurvivor Classic ? Je le fais seul et les serveurs coûtent de l’argent. Si tu veux, tu peux m’aider à le garder en ligne.', 'Ti sta piacendo PokéSurvivor Classic? Lo faccio da solo e i server costano. Se vuoi, puoi aiutarmi a tenerlo online.', 'Está gostando de PokéSurvivor Classic? Eu faço sozinho e os servidores custam dinheiro. Se quiser, pode me ajudar a mantê-lo online.', '喜欢 PokéSurvivor Classic 吗？这是我一个人做的，服务器需要花钱。如果愿意，你可以帮我让它继续在线。', '喜歡 PokéSurvivor Classic 嗎？這是我一個人做的，伺服器需要花錢。如果願意，你可以幫我讓它繼續上線。'],
    '{x} solicitudes de amistad': ['{x} friend requests', '{x} demandes d’ami', '{x} richieste di amicizia', '{x} pedidos de amizade', '{x} 个好友请求', '{x} 個好友請求'],
    '¿Cambiar de servidor?': ['Change server?', 'Changer de serveur ?', 'Cambiare server?', 'Trocar de servidor?', '更换服务器？', '更換伺服器？'],
    'Pasarás a «{x}» ({x}): otra cuenta online, otro ranking y otros amigos. Tu partida de aquí no se toca y puedes volver al servidor por defecto cuando quieras.': ['You will move to “{x}” ({x}): another online account, leaderboard and friends. Your save here is not touched and you can go back to the default server whenever you like.', 'Tu passeras sur « {x} » ({x}) : autre compte en ligne, autre classement et autres amis. Ta partie ici n’est pas touchée et tu peux revenir au serveur par défaut quand tu veux.', 'Passerai a «{x}» ({x}): altro account online, altra classifica e altri amici. Il salvataggio di qui non viene toccato e puoi tornare al server predefinito quando vuoi.', 'Você vai para «{x}» ({x}): outra conta online, outro ranking e outros amigos. Seu save daqui não é alterado e você pode voltar ao servidor padrão quando quiser.', '你将切换到「{x}」（{x}）：另一个在线账号、排行榜和好友。这里的存档不会改动，你随时可以回到默认服务器。', '你將切換到「{x}」（{x}）：另一個線上帳號、排行榜和好友。這裡的存檔不會改動，你隨時可以回到預設伺服器。'],
    'QuickJS, PlutoVG y SDL2 · GPL-3.0': ['QuickJS, PlutoVG and SDL2 · GPL-3.0', 'QuickJS, PlutoVG et SDL2 · GPL-3.0', 'QuickJS, PlutoVG e SDL2 · GPL-3.0', 'QuickJS, PlutoVG e SDL2 · GPL-3.0', 'QuickJS、PlutoVG 和 SDL2 · GPL-3.0', 'QuickJS、PlutoVG 和 SDL2 · GPL-3.0'],
    'QuickJS, PlutoVG, SDL2, libcurl, OpenSSL y libdatachannel · GPL-3.0': ['QuickJS, PlutoVG, SDL2, libcurl, OpenSSL and libdatachannel · GPL-3.0', 'QuickJS, PlutoVG, SDL2, libcurl, OpenSSL et libdatachannel · GPL-3.0', 'QuickJS, PlutoVG, SDL2, libcurl, OpenSSL e libdatachannel · GPL-3.0', 'QuickJS, PlutoVG, SDL2, libcurl, OpenSSL e libdatachannel · GPL-3.0', 'QuickJS、PlutoVG、SDL2、libcurl、OpenSSL 和 libdatachannel · GPL-3.0', 'QuickJS、PlutoVG、SDL2、libcurl、OpenSSL 和 libdatachannel · GPL-3.0'],
    'Windows, macOS y Linux': ['Windows, macOS and Linux', 'Windows, macOS et Linux', 'Windows, macOS e Linux', 'Windows, macOS e Linux', 'Windows、macOS 和 Linux', 'Windows、macOS 和 Linux'],
    'Cancelar': ['Cancel', 'Annuler', 'Annulla', 'Cancelar', '取消', '取消'],
    'Abrir': ['Open', 'Ouvrir', 'Apri', 'Abrir', '打开', '開啟'],
    'Elige su nueva naturaleza': ['Choose its new nature', 'Choisis sa nouvelle nature', 'Scegli la sua nuova natura', 'Escolha a nova natureza', '选择新的性格', '選擇新的性格'],
    'Elige su nueva habilidad': ['Choose its new ability', 'Choisis son nouveau talent', 'Scegli la sua nuova abilità', 'Escolha a nova habilidade', '选择新的特性', '選擇新的特性'],
    'Los movimientos que no quieres que te salgan en las cartas': ['The moves you don\'t want in your cards', 'Les attaques que tu ne veux pas voir dans les cartes', 'Le mosse che non vuoi nelle carte', 'Os golpes que você não quer nas cartas', '不想在卡牌中出现的招式', '不想在卡牌中出現的招式'],
    'Qué movimiento va siempre en cada hueco, para la memoria muscular.': ['Which move always goes in each slot, for muscle memory.', 'Quelle attaque va toujours dans chaque emplacement, pour la mémoire musculaire.', 'Quale mossa va sempre in ogni slot, per la memoria muscolare.', 'Qual golpe vai sempre em cada espaço, para a memória muscular.', '每个栏位固定放哪个招式，方便形成肌肉记忆。', '每個欄位固定放哪個招式，方便形成肌肉記憶。'],
    'Acción': ['Action', 'Action', 'Azione', 'Ação', '操作', '操作'],
    'Columna': ['Column', 'Colonne', 'Colonna', 'Coluna', '列', '欄'],
    'Es el nombre que verán tus amigos y el que sale en el ranking.': ['It is the name your friends will see and the one shown on the leaderboard.', "C'est le nom que verront tes amis et celui du classement.", 'È il nome che vedranno i tuoi amici e quello in classifica.', 'É o nome que seus amigos verão e o que aparece no ranking.', '这是好友看到的名字，也会显示在排行榜上。', '這是好友看到的名字，也會顯示在排行榜上。'],
    'Tu nombre y tu correo de Google no se enseñan a nadie.': ['Your name and your Google email are never shown to anyone.', "Ton nom et ton e-mail Google ne sont montrés à personne.", 'Il tuo nome e la tua email Google non vengono mostrati a nessuno.', 'Seu nome e seu e-mail do Google não são mostrados a ninguém.', '你的名字和 Google 邮箱不会展示给任何人。', '你的名字和 Google 信箱不會展示給任何人。'],
    'sin conexión': ['no connection', 'pas de connexion', 'nessuna connessione', 'sem conexão', '无网络连接', '無網路連線'],
    'No se pudo cargar el ranking': ["Couldn't load the leaderboard", 'Impossible de charger le classement', 'Impossibile caricare la classifica', 'Não foi possível carregar o ranking', '无法加载排行榜', '無法載入排行榜'],
    'No se pudo cargar.': ["Couldn't load.", 'Impossible de charger.', 'Impossibile caricare.', 'Não foi possível carregar.', '无法加载。', '無法載入。'],
    'dáselo a tus amigos para que te añadan.': ['give it to your friends so they can add you.', "donne-le à tes amis pour qu'ils t'ajoutent.", 'dallo ai tuoi amici perché ti aggiungano.', 'passe para seus amigos te adicionarem.', '把它告诉好友，让他们加你。', '把它告訴好友，讓他們加你。'],
    'Aún no tienes amigos añadidos. Pulsa Añadir amigo y escribe su apodo.': ["You haven't added any friends yet. Press Add friend and type their nickname.", "Tu n'as encore aucun ami. Appuie sur Ajouter un ami et écris son pseudo.", 'Non hai ancora amici. Premi Aggiungi amico e scrivi il suo nickname.', 'Você ainda não tem amigos. Aperte Adicionar amigo e digite o apelido.', '还没有好友。按“添加好友”并输入昵称。', '還沒有好友。按「新增好友」並輸入暱稱。'],
    'Categoría': ['Category', 'Catégorie', 'Categoria', 'Categoria', '类别', '類別'],
    'títulos': ['titles', 'titres', 'titoli', 'títulos', '称号', '稱號'],
    '{x} de {x} logros': ['{x} of {x} achievements', '{x} succès sur {x}', '{x} obiettivi su {x}', '{x} de {x} conquistas', '已获得 {x} / {x} 个成就', '已獲得 {x} / {x} 個成就'],
    'Datos de los Pokémon': ['Pokémon data', 'Données des Pokémon', 'Dati dei Pokémon', 'Dados dos Pokémon', '宝可梦数据', '寶可夢資料'],
    'Borrar cuenta': ['Delete account', 'Supprimer le compte', 'Elimina account', 'Excluir conta', '删除账号', '刪除帳號'],
    'Se borrarán tu cuenta y toda tu partida, para siempre. ¿Seguro?': ['Your account and all your progress will be deleted forever. Are you sure?', 'Ton compte et toute ta progression seront supprimés pour toujours. Tu es sûr ?', 'Il tuo account e tutti i tuoi progressi verranno eliminati per sempre. Sei sicuro?', 'Sua conta e todo o seu progresso serão excluídos para sempre. Tem certeza?', '你的账号和全部进度将被永久删除。确定吗？', '你的帳號和全部進度將被永久刪除。確定嗎？'],
    'Borrar para siempre': ['Delete forever', 'Supprimer pour toujours', 'Elimina per sempre', 'Excluir para sempre', '永久删除', '永久刪除'],
    'Borrando la cuenta…': ['Deleting account…', 'Suppression du compte…', 'Eliminazione account…', 'Excluindo a conta…', '正在删除账号…', '正在刪除帳號…'],
    'Cuenta borrada': ['Account deleted', 'Compte supprimé', 'Account eliminato', 'Conta excluída', '账号已删除', '帳號已刪除'],
    'No se pudo borrar la cuenta.': ['Could not delete the account.', 'Impossible de supprimer le compte.', 'Impossibile eliminare l’account.', 'Não foi possível excluir a conta.', '无法删除账号。', '無法刪除帳號。'],
    'Invencible': ['Invincibility', 'Invincibilité', 'Invincibilità', 'Invencibilidade', '无敌', '無敵'],
    'Modo turbo': ['Turbo mode', 'Mode turbo', 'Modalità turbo', 'Modo turbo', '加速模式', '加速模式'],
    'La partida va más rápida (los menús no).': ['The run goes faster (menus don’t).', 'La partie va plus vite (pas les menus).', 'La partita va più veloce (i menu no).', 'A partida fica mais rápida (os menus não).', '对局加速（菜单不变）。', '對局加速（選單不變）。'],
    'Trucos': ['Cheats', 'Triches', 'Trucchi', 'Truques', '作弊', '作弊'],
    'Fuente': ['Font', 'Police', 'Font', 'Fonte', '字体', '字型'],
    'Desbloquear todos los Pokémon': ['Unlock all Pokémon', 'Débloquer tous les Pokémon', 'Sblocca tutti i Pokémon', 'Desbloquear todos os Pokémon', '解锁全部宝可梦', '解鎖全部寶可夢'],
    'Desbloquear todos los shiny': ['Unlock all shiny', 'Débloquer tous les chromatiques', 'Sblocca tutti gli shiny', 'Desbloquear todos os shiny', '解锁全部闪光', '解鎖全部閃光'],
    'Mejoras al máximo': ['Max upgrades', 'Améliorations au maximum', 'Potenziamenti al massimo', 'Melhorias no máximo', '强化全满', '強化全滿'],
    'Se aplica al volver a abrir el juego.': ['Applies the next time you open the game.', 'S\'applique à la prochaine ouverture du jeu.', 'Si applica alla prossima apertura del gioco.', 'Vale na próxima vez que abrir o jogo.', '下次打开游戏时生效。', '下次開啟遊戲時生效。'],
    'Contador de FPS': ['FPS Counter', 'Compteur de FPS', 'Contatore FPS', 'Contador de FPS', 'FPS 计数器', 'FPS 計數器'],
    'Los FPS y el fotograma más lento (ms), arriba a la derecha.': ['FPS and the slowest frame (ms), top right.', 'Les FPS et l’image la plus lente (ms), en haut à droite.', 'Gli FPS e il fotogramma più lento (ms), in alto a destra.', 'Os FPS e o quadro mais lento (ms), no canto superior direito.', '右上角显示 FPS 和最慢的一帧（毫秒）。', '右上角顯示 FPS 和最慢的一幀（毫秒）。'],
    'Tus ataques van hacia donde empujes el stick derecho del mando en vez de al enemigo más cercano.': [
      'Your attacks go where you push the right stick instead of at the nearest enemy.',
      'Tes attaques vont là où tu pousses le stick droit au lieu de l\'ennemi le plus proche.',
      'I tuoi attacchi vanno dove spingi lo stick destro invece che verso il nemico più vicino.',
      'Seus ataques vão para onde você empurra o analógico direito em vez do inimigo mais próximo.',
      '攻击朝右摇杆推动的方向，而不是最近的敌人。', '攻擊朝右搖桿推動的方向，而不是最近的敵人。'],
  };
  if (G.I18n && G.I18n.add) ['en', 'fr', 'it', 'pt-BR', 'zh-Hans', 'zh-Hant'].forEach((lang, i) =>
    G.I18n.add(Object.fromEntries(Object.entries(PS5_TEXTS).map(([es, tr]) => [es, tr[i]])), lang));

  // Pokémon paradoja: nombre oficial en inglés, italiano y portugués (en el juego salen en español). Es lo de la rama
  // feat/add-paradox-names de la web (b7f2c70f), que aún no está en app.min.js; quitar cuando llegue.
  if (G.I18n && G.I18n.add) {
    const EN = { Colmilargo: 'Great Tusk', Colagrito: 'Scream Tail', Melenaleteo: 'Flutter Mane', Reptalada: 'Slither Wing', Pelarena: 'Sandy Shocks',
      Bramaluna: 'Roaring Moon', Ondulagua: 'Walking Wake', Ferrosaco: 'Iron Bundle', Ferropalmas: 'Iron Hands', Ferropolilla: 'Iron Moth',
      'Ferropúas': 'Iron Thorns', 'Ferropaladín': 'Iron Valiant', Ferroverdor: 'Iron Leaves' };
    G.I18n.add(EN, 'en'); G.I18n.add(EN, 'pt-BR');
    G.I18n.add({ Colmilargo: 'Grandizanne', Colagrito: 'Codaurlante', Melenaleteo: 'Crinealato', Reptalada: 'Alirasenti', Pelarena: 'Peldisabbia',
      Bramaluna: 'Lunaruggente', Ondulagua: 'Acquecrespe', Ferrosaco: 'Saccoferreo', Ferropalmas: 'Manoferrea', Ferropolilla: 'Falenaferrea',
      'Ferropúas': 'Spineferree', 'Ferropaladín': 'Eroeferreo', Ferroverdor: 'Fogliaferrea' }, 'it');
  }

  // ---------------- mando: pulsaciones (no mantener) ----------------
  // Distribución "standard": 0 ✕ · 1 ○ · 2 □ · 3 △ · 12-15 cruceta · ejes 0/1 stick izquierdo.
  let prev = [], prevDir = '', dirT = 0;
  // pantalla de carga del arranque (ver psOverlay al final); en el arnés de Node, no. En la web tampoco: no hay terreno que
  // generar ni sprites que descomprimir aparte, y tapaba el juego hasta que la cuenta (Firebase) contestaba.
  const CAN = ps.CAN || {};   // lo que puede esta plataforma (browser.js / web.js); nunca el nombre (preview.js: nada)
  let booting = ps.PAD !== 'node' && !CAN.page;
  globalThis.psCovered = () => booting;   // boot.js: tapado, el terreno se adelanta más deprisa
  function readInput(now) {
    const p = psPadRaw();
    const b = p.buttons;
    const ev = { a: b[0] && !prev[0], b: b[1] && !prev[1], x: b[2] && !prev[2], y: b[3] && !prev[3], start: b[9] && !prev[9], sel: b[8] && !prev[8], dx: 0, dy: 0 };
    // Dirección: cruceta o stick, con repetición al mantener (0,35 s y luego cada 0,12 s).
    const ax = p.axes;
    const dir = b[14] || ax[0] < -0.5 ? 'l' : b[15] || ax[0] > 0.5 ? 'r' : b[12] || ax[1] < -0.5 ? 'u' : b[13] || ax[1] > 0.5 ? 'd' : '';
    if (dir && (dir !== prevDir || now > dirT)) {
      dirT = now + (dir !== prevDir ? 350 : 120);
      ev.dx = dir === 'l' ? -1 : dir === 'r' ? 1 : 0;
      ev.dy = dir === 'u' ? -1 : dir === 'd' ? 1 : 0;
    }
    prevDir = dir;
    prev = b.slice();
    if (!booting) mouseNav(ev, now);
    return booting ? { dx: 0, dy: 0 } : ev;   // (cargando: no se elige nada a ciegas)
  }

  // ---------------- ratón (escritorio: browser.js, psMouse; la PS5 no tiene) ----------------
  // hots: los recuadros que se pueden apuntar, los que pintan btn, ring (el cursor) y cardRow en el último dibujo.
  // ponytail: navegación espacial: cada pantalla sólo entiende la cruceta, así que el ratón la imita: un paso hacia el
  // recuadro de debajo del puntero cada vez que se ha vuelto a dibujar, hasta que el cursor está en él (y el clic, ✕).
  // Lo que no se dibuja con esos tres no se apunta (con el teclado sí); si un paso no acerca el cursor, se deja.
  let hots = [];
  const pressQ = [];   // botones que pide un clic (press): se dan uno por fotograma, como si se pulsaran
  const press = (k, n = 1) => { for (let i = 0; i < n; i++) pressQ.push(k); };
  globalThis.psUiHots = () => hots;   // (diagnóstico: el arnés)
  globalThis.psKeyboard = (...a) => keyboard(...a);   // (diagnóstico: guiones de capturas)
  // (diagnóstico: guiones; abre cualquier pantalla del menú, p. ej. psScreen('goals', 0))
  globalThis.psScreen = (name, ...a) => {
    if (top) close();
    ({ upgrades: upgradesScreen, gacha: gachaScreen, dex: dexScreen, shop: shopScreen, bag: bagScreen, news: newsScreen,
       goals: goalsScreen, legal: legalScreen, rank: rankScreen, friends: friendsScreen, settings: settingsScreen,
       kofi: kofiScreen, menu: mainMenu, coop: localCoopScreen })[name](...a);
  };
  globalThis.psUiKey = () => lastKey;   // (diagnóstico: cambia cuando la pantalla abierta cambia algo)
  const nav = { t: 0, steps: 0, target: null, click: false, prev: '', alt: false };
  // act: lo que hace un clic sin mover el cursor: un botón ('b' = ○) o una función (mx, my, ev) que cambia la pantalla
  // directamente (la fila de Ajustes, el punto de un deslizador, una pestaña). Para lo que la cruceta no alcanza o va lenta.
  // Todo lo que se elige con el mando se tiene que poder elegir con un clic (native/CLAUDE.md, «Escritorio»).
  // hotXf: lo que se pinta con ctx.translate/scale (las cartas del núcleo, por zona) registra sus recuadros ya movidos.
  let hotXf = null;
  // focus: lo elige al instante (el ratón encima: sel = su índice), sin pasos de cruceta ni redibujos (focusTo). Las listas y
  // rejillas lo pasan siempre: con pasos, una rejilla grande (la Pokédex) se redibujaba decenas de veces por movimiento.
  function hot(x, y, w, h, on, act, focus) {
    if (hotXf) [x, y, w, h] = hotXf(x, y, w, h);
    const old = hots.find(r => r.x === x && r.y === y && r.w === w && r.h === h);
    if (old) { old.on = old.on || on; old.act = old.act || act; old.focus = old.focus || focus; }
    else hots.push(hotSc ? { x, y, w, h, on, act, focus, sc: true, y0: y } : { x, y, w, h, on, act, focus });   // (sc: se mueve con la lista)
  }
  const center = r => [r.x + r.w / 2, r.y + r.h / 2];
  // Desplazar por píxeles: la rueda entera (wheelPx) o `px` por paso de tecla o cruceta.
  const scrollStep = (ev, px) => (ev.wheelPx != null ? ev.wheelPx : ev.dy * px);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function mouseNav(ev, now) {
    const m = globalThis.psMouse;
    if (!m) return;
    // Una tecla o el mando mandan: se deja de llevar el cursor hacia donde estaba el ratón.
    if (ev.dx || ev.dy || ev.a || ev.b) { nav.target = null; nav.click = false; }
    if (pressQ.length) ev[pressQ.shift()] = true;   // (botones pedidos por un clic, uno por fotograma)
    if (m.num) { ev.num = m.num; m.num = 0; nav.target = null; }   // (tecla 1-9: browser.js)
    // Rueda (en muescas, con decimales: trackpad). NUNCA mueve el foco (regla de native/CLAUDE.md, «Foco»): sólo la vista.
    // wheelPx: lo que se desplaza en píxeles (scrollStep); wheelRows: filas enteras para las listas y rejillas, guardando lo
    // que sobra para el fotograma siguiente.
    // Sólo las pantallas que se desplazan (wheel: true en su open) reciben la rueda; en las demás no mueve nada (ni el foco).
    if (!(top && top.wheel)) { m.wheel = 0; nav.wheel = 0; }
    // Y sólo con el puntero (o el dedo que arrastra) dentro de la lista: el recuadro de sus elementos (los hot con foco
    // directo del último dibujo; una pantalla puede dar el suyo con wheelArea). Fuera, la rueda no mueve nada.
    if (m.wheel) {
      const area = top.wheelArea ? top.wheelArea() : hots.filter(r => r.focus).reduce((a, r) => !a ? [r.x, r.y, r.x + r.w, r.y + r.h]
        : [Math.min(a[0], r.x), Math.min(a[1], r.y), Math.max(a[2], r.x + r.w), Math.max(a[3], r.y + r.h)], null);
      const px = m.x / K - OX, py = m.y / K - OY;
      if (area && !(px >= area[0] && px < area[2] && py >= area[1] && py < area[3])) { m.wheel = 0; nav.wheel = 0; }
    }
    if (m.wheel || nav.wheel) {
      if (m.wheel) ev.wheelPx = -m.wheel * 48;
      const acc = (nav.wheel || 0) + m.wheel;
      m.wheel = 0;
      const rows = Math.trunc(acc);
      if (rows) ev.wheelRows = -rows;   // (rueda hacia arriba: filas de antes)
      nav.wheel = Math.max(-3, Math.min(3, acc - rows));
    }
    if (m.right) { ev.b = true; m.right = 0; }
    const mx = m.x / K - OX, my = m.y / K - OY;   // (psMouse viene en píxeles de ps.W)
    // Sólo cuenta como movimiento si de verdad se ha movido (4 px): con el ratón quieto el foco no se toca.
    if (m.moved) { m.moved = false; if (Math.hypot(mx - (nav.mx || 0), my - (nav.my || 0)) >= 4) { nav.mx = mx; nav.my = my; m.moved2 = true; } }
    // Bajo el puntero: una acción directa, si hay (la de encima); si no, el recuadro más grande (la tarjeta, no el botón de
    // precio que lleva dentro: a ése no llega la cruceta).
    const all = hots.filter(r => mx >= r.x && mx < r.x + r.w && my >= r.y && my < r.y + r.h);
    const under = all.filter(r => r.act).pop() || all.reduce((a, r) => (!a || r.w * r.h > a.w * a.h ? r : a), null);
    if (m.click && globalThis.psTextSink && !psTextSink.keep && !(under && under.act && under.act.text)) psTextSink('\n');   // (clic fuera del campo: deja de escribir)
    if (m.click && under && under.act) {
      m.click = 0; nav.target = null;
      if (typeof under.act === 'function') { under.act(mx, my, ev); lastKey = null; G.Audio.sfx('select'); } else ev[under.act] = true;
      return;
    }
    // Como la web: pasar el ratón por encima elige y el clic pulsa. Lo elegible bajo el puntero es el recuadro más grande sin
    // acción directa (la tarjeta, no su botón de precio): pasar por un icono o un deslizador no mueve el foco.
    const click = m.click, hover = m.moved2;
    m.click = 0; m.moved2 = false;
    if (!click && !hover) return;
    const direct = all.filter(r => r.focus).pop();
    if (direct) {   // (foco directo: una asignación)
      if (!direct.on) { direct.focus(); lastKey = null; G.Audio.sfx('select'); }
      if (click && !direct.act) ev.a = true;
      return;
    }
    // Sin foco directo: pasar por encima no hace nada (los pasos redibujaban la pantalla en cada movimiento); un clic sí lo
    // intenta, una vez.
    if (!click) return;
    const target = all.filter(r => !r.act).reduce((a, r) => (!a || r.w * r.h > a.w * a.h ? r : a), null);
    if (target && focusTo(target, now)) ev.a = true;
  }
  // Lleva el foco de la pantalla hasta el recuadro t en este mismo fotograma. Las pantallas no saben qué fila es cada
  // recuadro, así que se dan pasos de cruceta (input con dx/dy) y se vuelve a dibujar fuera de pantalla tras cada uno, sin
  // sonido: sólo se ve el resultado, no el recorrido (antes se veía saltar por los de en medio). Si no se llega (algo que
  // nunca se elige), los pasos se deshacen. → true si t queda elegido.
  // ponytail: hasta 12 pasos con un dibujo cada uno, sólo para lo que no tiene foco directo (hot(..., focus)): diálogos de
  // pocos botones. Una lista o rejilla nueva tiene que pasar `focus` a sus hot().
  function focusTo(t0, now) {
    const same = () => hots.find(h => h.x === t0.x && h.y === t0.y && h.w === t0.w && h.h === t0.h);
    let t = same(), cur = hots.find(r => r.on);
    if (!t || !cur) return false;
    if (t.on) return true;
    const scr = top, steps = [], sfx0 = G.Audio.sfx;
    const redraw = () => {
      hots = [];
      const c0 = ctx;
      ctx = bufCtx; ctx.setTransform(K, 0, 0, K, OX * K, OY * K); ctx.clearRect(-OX, -OY, W + 2 * OX, H + 2 * OY);
      try { scr.draw(now); } finally { ctx = c0; }
      lastKey = null;   // (psOverlay lo vuelve a pintar de verdad)
    };
    const step = (dx, dy) => { scr.input({ dx, dy }, now); if (top !== scr) return false; redraw(); return true; };
    let ok = false;
    G.Audio.sfx = () => {};
    try {
      for (let k = 0; k < 12 && !ok; k++) {   // (sin foco directo: pocos pasos y sólo si cada uno acerca)
        t = same(); cur = hots.find(r => r.on);
        if (!t || !cur) break;
        if (t.on) { ok = true; break; }
        const [tx, ty] = center(t), [cx, cy] = center(cur), ddx = Math.sign(tx - cx) || 0, ddy = Math.sign(ty - cy) || 0;
        const axes = Math.abs(ty - cy) * 1.5 > Math.abs(tx - cx) ? [[0, ddy], [ddx, 0]] : [[ddx, 0], [0, ddy]];
        let moved = false;
        for (const [sx, sy] of axes) {
          if (!sx && !sy) continue;
          const before = cur.x + ',' + cur.y;
          if (!step(sx, sy)) return false;   // (cambió de pantalla: no se toca más)
          steps.push([sx, sy]);
          const c2 = hots.find(r => r.on);
          const far = r => Math.hypot(center(r)[0] - tx, center(r)[1] - ty);
          if (c2 && c2.x + ',' + c2.y !== before) { moved = far(c2) < far(cur); break; }
        }
        if (!moved) break;
        if (same() && same().on) ok = true;
      }
      if (!ok) for (const [sx, sy] of steps.reverse()) step(-sx, -sy);
    } finally { G.Audio.sfx = sfx0; }
    if (ok && steps.length) sfx0('select');
    return ok;
  }

  // ---------------- dibujo ----------------
  const strip = s => String(s == null ? '' : s).replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
  const T = (s, kind) => (G.T ? G.T(s, kind) : s);
  function font(px, bold) { ctx.font = `${bold ? 'bold ' : ''}${px}px ${FONT}`; }
  // Con la sombra de la web (text-shadow: 2px 2px 0 #0a1430, aquí a 0,75); shadow null: sin sombra.
  // Botones en los textos: {confirm}, {back}… (ACT, abajo) se pintan con el icono del mando o la tecla que toque (padIcon).
  // Nunca se escribe un botón a mano (✕, «Enter», A): cada plataforma y cada mando tiene el suyo (native/CLAUDE.md).
  const TOKEN = /(\{[a-z0-9]+\})/;
  const tokW = (t, px) => padIcon(ACT[t.slice(1, -1)] || t.slice(1, -1), 0, -1000, px * 0.62) + 4;   // (medir: se pinta fuera)
  const partW = (p, px) => (TOKEN.test(p) && p[0] === '{' ? tokW(p, px) : ctx.measureText(p).width);
  function richText(s, x, y, px, color, align, bold, shadow) {
    const parts = s.split(TOKEN).filter(Boolean);
    font(px, bold);
    const w = parts.reduce((a, p) => a + partW(p, px), 0);
    x = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
    for (const p of parts) {
      font(px, bold);
      const pw = partW(p, px);
      if (p[0] === '{' && TOKEN.test(p)) padIcon(ACT[p.slice(1, -1)] || p.slice(1, -1), x + pw / 2 - 2, y + px * 0.55, px * 0.62);
      else text(p, x, y, px, color, 'left', bold, shadow);
      x += pw;
    }
  }
  // Lo que escribe el jugador y las teclas del teclado, tal cual: el traductor del canvas (i18n.js) cambiaba la «Y» por
  // «AND» y un nombre como «Rayo» por «Thunderbolt». asIs(() => …): lo que se dibuje dentro no se traduce.
  let rawText = false;
  const asIs = f => { rawText = true; try { return f(); } finally { rawText = false; } };
  const raw = (m, ...a) => (rawText && G.I18n && G.I18n.rawCanvas ? G.I18n.rawCanvas(ctx, m, ...a) : ctx[m](...a));
  function text(s, x, y, px, color, align = 'left', bold = false, shadow = C.navy) {
    if (typeof s === 'string' && s.indexOf('{') >= 0 && TOKEN.test(s)) return richText(s, x, y, px, color, align, bold, shadow);
    font(px, bold); ctx.textAlign = align; ctx.textBaseline = 'top';
    if (shadow) { const o = px >= 20 ? 2 : 1.5; ctx.fillStyle = shadow; raw('fillText', s, x + o, y + o); }
    ctx.fillStyle = color; raw('fillText', s, x, y);
  }
  // Partir midiendo palabra a palabra costaba 1 ms por párrafo en Android, en cada redibujo (la tienda, al desplazarse: 10-16 ms).
  // Mismo texto, ancho, letra y botones ({confirm}…: cambian con el mando o las teclas) = mismas líneas.
  // ponytail: se vacía entera al pasar de 400; LRU si alguna pantalla tiene más párrafos que eso.
  const wrapMemo = new Map();
  function wrap(s, maxW, px, bold) {
    const key = s + '|' + maxW + '|' + px + '|' + !!bold + '|' + rawText + '|' + !!globalThis.psKeys + '|' + (globalThis.psPadType || '');
    let out = wrapMemo.get(key);
    if (!out) {
      if (wrapMemo.size > 400) wrapMemo.clear();
      wrapMemo.set(key, out = wrapNow(s, maxW, px, bold));
    }
    font(px, bold);   // (quien llama cuenta con la letra puesta)
    return out.slice();
  }
  function wrapNow(s, maxW, px, bold) {
    font(px, bold);
    const out = [];
    let line = '';
    // Se traduce la frase entera ANTES de cortarla: el traductor del canvas (i18n.js) busca la frase exacta, y con cada
    // línea por separado sólo cambiaba palabras sueltas («Cruzas como un Thunderbolt hacia…»).
    for (const w of strip(T(strip(s))).split(' ')) {
      const t = line ? line + ' ' + w : w;
      if (line && t.split(TOKEN).reduce((a, p) => a + (p ? partW(p, px) : 0), 0) > maxW) { out.push(line); line = w; } else line = t;
      font(px, bold);
    }
    if (line) out.push(line);
    return out;
  }
  function rect(x, y, w, h, fill, stroke, lw = 2) {
    ctx.beginPath(); ctx.roundRect(x, y, w, h, 6);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
  }
  // .scr.dim: radial-gradient(circle at 50% 40%, rgba(10,20,50,.55), rgba(3,6,16,.88))
  // Pintado una vez: el degradado radial a pantalla completa por la CPU era la mitad de cada redibujo (3,8-7,5 ms en un
  // Mac; en Android, al desplazar las listas, 20 fps). Y el primero de cada redibujo ni siquiera va al búfer (copiarlo
  // allí, mezclando cada píxel, costaba otros 5 ms): psOverlay lo copia a la pantalla debajo del búfer (en la GPU, gratis).
  // (buf sobre dim) sobre el juego = buf sobre (dim sobre el juego): vale porque el primer dim() va antes que todo lo demás.
  let dimCv = null, dimDrawing = false, dimUnder = false;
  function dim() {
    if (!dimCv || dimCv.width !== ps.W || dimCv.height !== ps.H) {   // (o si cambió el tamaño: la ventana del navegador)
      dimCv = document.createElement('canvas'); dimCv.width = ps.W; dimCv.height = ps.H;
      const c = dimCv.getContext('2d');
      c.setTransform(K, 0, 0, K, OX * K, OY * K);
      const g = c.createRadialGradient(W / 2, H * 0.4, 0, W / 2, H * 0.4, Math.hypot(W / 2, H * 0.6));
      g.addColorStop(0, 'rgba(10,20,50,0.55)'); g.addColorStop(1, 'rgba(3,6,16,0.88)');
      c.fillStyle = g; c.fillRect(-OX, -OY, W + 2 * OX, H + 2 * OY);
    }
    if (dimDrawing && !dimUnder && ps.GPU) { dimUnder = true; return; }   // (pantalla por la CPU: dentro del búfer, que se copia igual)
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(dimCv, 0, 0); ctx.restore();
  }
  function rr(x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }
  function vgrad(y, h, a, b) { const g = ctx.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, a); g.addColorStop(1, b); return g; }
  // .box: degradado azul, borde blanco, anillo oscuro por fuera y azul claro por dentro.
  function box(x, y, w, h) {
    rr(x - 2, y - 2, w + 4, h + 4, 11); ctx.fillStyle = C.edgeOut; ctx.fill();
    rr(x, y, w, h, 9); ctx.fillStyle = C.edge; ctx.fill();
    rr(x + 2, y + 2, w - 4, h - 4, 7); ctx.fillStyle = vgrad(y, h, C.box1, C.box2); ctx.fill();
    rr(x + 3, y + 3, w - 6, h - 6, 6); ctx.strokeStyle = C.edgeIn; ctx.lineWidth = 1.5; ctx.stroke();
  }
  // .btn ('blue'), .btn.gold y .btn.ghost. on: el que tiene el cursor (anillo dorado).
  // focus: lo elige al instante con el ratón encima (hot), como cada elemento de una lista.
  function btn(x, y, w, h, label, kind = 'blue', on = false, px = 13, ico, focus) {
    hot(x, y, w, h, on && kind !== 'ghost', label === T('Volver') || label === T('Cerrar') ? 'b' : null, focus);   // (ghost on: elegido, no el cursor; «Volver»/«Cerrar»: ○ con un clic)
    if (kind === 'ghost') {
      rr(x, y, w, h, 7);
      if (on) { ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fill(); }
      ctx.strokeStyle = on ? C.edge : 'rgba(244,248,255,0.35)'; ctx.lineWidth = 2; ctx.stroke();
    } else {
      rr(x - 1.5, y - 1.5, w + 3, h + 6, 8); ctx.fillStyle = C.edgeOut; ctx.fill();
      rr(x, y, w, h, 7); ctx.fillStyle = kind === 'gold' ? '#fff7d6' : C.edge; ctx.fill();
      rr(x + 2, y + 2, w - 4, h - 4, 5);
      ctx.fillStyle = kind === 'gold' ? vgrad(y, h, '#ffe37a', '#f0a31e') : kind === 'off' ? vgrad(y, h, '#7d8494', '#555b68') : vgrad(y, h, '#3d67c0', '#26468f');
      ctx.fill();
    }
    if (on && kind !== 'ghost') { rr(x - 4, y - 4, w + 8, h + 10, 10); ctx.strokeStyle = C.gold; ctx.lineWidth = 2; ctx.stroke(); }   // ghost on: elegido (.seg), no cursor
    if (label == null) return;
    font(px, true);
    const iw = ico ? px + 6 : 0, tw = raw('measureText', label).width, x0 = x + (w - tw - iw) / 2;
    if (ico) icon(ico, x0, y + (h - px - 2) / 2, px + 2);
    text(label, x0 + iw, y + (h - px) / 2, px, kind === 'gold' ? '#3a2300' : '#fff', 'left', true, kind === 'gold' ? 'rgba(255,255,255,0.4)' : C.navy);
  }
  // .pill: píldora oscura con borde blanco. parts: [['icono'|null, 'texto'], ...]. Devuelve el ancho.
  function pill(x, y, parts, measureOnly) {
    font(11, true);
    let w = 20;
    for (const [ico, t] of parts) w += (ico ? 18 : 0) + (t ? ctx.measureText(t).width + 6 : 0);
    if (measureOnly) return w;
    rr(x - 1.5, y - 1.5, w + 3, 29, 15); ctx.fillStyle = C.edgeOut; ctx.fill();
    rr(x, y, w, 26, 13); ctx.fillStyle = 'rgba(10,20,50,0.85)'; ctx.fill(); ctx.strokeStyle = C.edge; ctx.lineWidth = 1.5; ctx.stroke();
    let cx = x + 10;
    for (const [ico, t] of parts) {
      if (ico) { icon(ico, cx, y + 5, 15); cx += 18; }
      if (t) { text(t, cx, y + 7, 11, '#fff', 'left', true); font(11, true); cx += ctx.measureText(t).width + 6; }
    }
    return w;
  }
  // #topbar (arriba a la derecha): monedas, tickets, cuenta, Novedades y sonido (Ajustes, en el menú).
  // focus: 'user' | 'news' | 'sound' (el cursor del mando está en la barra, desde el menú principal).
  // Marco del cursor, 3 px por fuera y con la misma forma (radio r del elemento + 3).
  const ring = (x, y, w, h, r, focus) => { hot(x, y, w, h, true, null, focus); rr(x - 3, y - 3, w + 6, h + 6, r + 3); ctx.strokeStyle = C.gold; ctx.lineWidth = 2; ctx.stroke(); };
  // Novedades (NEWS): news.json de la raíz (va dentro del juego: stage-game.sh) y, si el servidor tiene LIVE_BASE, el de
  // <LIVE_BASE>/news.json (se publican sin otro build). Por versión y fecha, con new / chg / fix (Nuevo, Cambios, Arreglos)
  // y cada frase { es, en }; los demás idiomas, por T() o en inglés. La versión del juego, de VERSION (la raíz).
  const PS_VERSION = String(ps.readFile(ps.ROOT + '/game/VERSION') || '').trim();
  // Lo que llega del servidor se limpia: fechas AAAA-MM-DD, textos cortos, como mucho 50 versiones.
  const newsFrom = j => {
    const ok = v => typeof v === 'string' && v.length <= 800;
    const pair = o => (o && ok(o.es) && ok(o.en) ? [o.es, o.en] : null);
    return (j && Array.isArray(j.news) ? j.news : []).filter(n => n && /^\d{4}-\d\d-\d\d$/.test(n.d)).slice(0, 50).map(n => {
      const e = { d: n.d, v: /^[\w.-]{1,20}$/.test(n.v || '') ? n.v : '', title: pair(n.title) };
      for (const k of ['new', 'chg', 'fix']) e[k] = (Array.isArray(n[k]) ? n[k] : []).map(pair).filter(Boolean).slice(0, 40);
      return e;
    });
  };
  let NEWS = (() => { try { return newsFrom(JSON.parse(ps.readFile(ps.ROOT + '/game/news.json') || 'null')); } catch (e) { return []; } })();
  if (!NEWS.length) NEWS = [{ d: '2026-11-05', v: PS_VERSION, title: null, new: [], chg: [], fix: [] }];
  { const base = (globalThis.PS_ENV || {}).liveBase;
    // @step publish/livebase net "LIVE_BASE sirve"
    // /update/* a los nativos y /news.json (Novedades nativas).
    // @next nclients
    if (base && globalThis.fetch) fetch(base + '/news.json', { cache: 'no-cache' }).then(r => (r.ok ? r.json() : null))
      .then(j => { const l = newsFrom(j); if (l.length) NEWS = l; }).catch(() => { /* sin red: las del juego */ }); }
  const newsUnseen = () => { try { return (localStorage.getItem('ps.news.seen') || '') < NEWS[0].d; } catch (e) { return false; } };
  // Botón de 30x26 sólo con icono (la barra de arriba).
  function iconBtn(x, kind, ico, focused) {
    btn(x, 10, 30, 26, null, kind, kind === 'ghost' && focused);
    icon(ico, x + 7, 15, 16);
    if (focused) ring(x, 10, 30, 26, 7);
  }
  // La barra de arriba (y el corazón de la izquierda): ✕ en ella desde el menú, o un clic desde cualquier pantalla.
  function barGo(id) {
    if (id === 'sound') { G.Audio.toggleMute(); G.Audio.sfx('select'); return; }
    if (id === 'save') { G.Audio.sfx('select'); cloudSave(); return; }
    if (id === 'full') { G.Audio.sfx('select'); ps.full(); return; }   // (la web: web.js)
    const go = { news: newsScreen, user: () => goalsScreen(2), support: kofiScreen, logout: logoutScreen }[id];
    if (!go) return;
    G.Audio.sfx('select'); if (top) close(); go();
  }
  // Como short() de la web (barra de arriba): entero hasta 99.999 y en corto desde ahí (9,8 M), con el idioma del sistema.
  const shortN = n => (n = +n || 0) < 1e5 ? n.toLocaleString() : new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: n < 1e6 ? 0 : 1 }).format(n);
  function topbar(focus) {
    const s = G.DB.save, t = (s && s.tickets) || { t1: 0, t10: 0 };
    // Halloween: los caramelos, al lado de los tickets (refreshCoins de la web).
    const tk = [['ticket', shortN(t.t1)], ['ticket10', shortN(t.t10)]].concat(G.Halloween.on && s ? [['candy', shortN((s.bag && s.bag.candy) || 0)]] : []);
    const items = [
      [() => pill(0, 0, [['coin', shortN(s ? s.coins : 0)]], true), x => pill(x, 10, [['coin', shortN(s ? s.coins : 0)]])],
      [() => pill(0, 0, tk, true), x => pill(x, 10, tk)],
      [() => pill(0, 0, [[G.DB.guest ? 'user' : 'crown', G.DB.guest ? T('Invitado') : (G.DB.user || '')]], true),
       (x, w) => {
        pill(x, 10, [[G.DB.guest ? 'user' : 'crown', G.DB.guest ? T('Invitado') : (G.DB.user || '')]]);
        hot(x, 10, w, 26, focus === 'user');   // (ratón)
        // Con cuenta online, el estado de la nube (como el punto .sync de la web): verde guardado, amarillo sin subir, rojo sin conexión.
        if (G.DB.mode === 'cloud' && !G.DB.guest) {
          const st = G.DB.syncState, col = st === 'ok' ? '#5fe08a' : st === 'offline' ? C.red : st === 'syncing' ? '#4fb4ff' : C.gold;
          ctx.beginPath(); ctx.arc(x + w - 4, 13, 5, 0, 6.2832); ctx.fillStyle = C.edgeOut; ctx.fill();
          ctx.beginPath(); ctx.arc(x + w - 4, 13, 3.5, 0, 6.2832); ctx.fillStyle = col; ctx.fill();
        }
        if (focus === 'user') ring(x, 10, w, 26, 13);
      }],
      // Guardar y Novedades: sólo con su icono, como la web por debajo de 1600 px (598bdc94).
      ...(barList().includes('save') ? [[() => 30, x => {
        iconBtn(x, G.DB.syncState === 'ok' ? 'blue' : 'gold', 'save', focus === 'save');   // dorado: hay algo sin subir
      }]] : []),
      [() => 30, x => {
        iconBtn(x, 'ghost', 'book', focus === 'news');
        if (newsUnseen()) { ctx.fillStyle = C.red; ctx.fillRect(x + 22, 12, 6, 6); }
      }],
      [() => 30, x => { btn(x, 10, 30, 26, null, 'ghost', focus === 'sound'); icon(G.Audio.settings.muted ? 'mute' : 'sound', x + 6, 14, 18); if (focus === 'sound') ring(x, 10, 30, 26, 7); }],
      ...(fullOk() ? [[() => 30, x => { btn(x, 10, 30, 26, null, 'ghost', focus === 'full'); icon('full', x + 6, 14, 18); if (focus === 'full') ring(x, 10, 30, 26, 7); }]] : []),
      ...(barList().includes('logout') ? [[() => { font(11, true); return ctx.measureText(T('Salir')).width + 22; }, (x, w) => {
        btn(x, 10, w, 26, T('Salir'), 'ghost', focus === 'logout', 11);
        if (focus === 'logout') ring(x, 10, w, 26, 7);
      }]] : []),
    ];
    // Lo que hace cada uno con un clic, desde cualquier pantalla (ratón): como ✕ en la barra del menú (barGo).
    const ids = [null, null, 'user', ...(barList().includes('save') ? ['save'] : []), 'news', 'sound', ...(fullOk() ? ['full'] : []), ...(barList().includes('logout') ? ['logout'] : [])];
    let x = W + OX - 16;   // pegada a la derecha, como la web (el de «Mostrar rendimiento» va encima, en su capa)
    for (let i = items.length - 1; i >= 0; i--) {
      const w = items[i][0](); x -= w; items[i][1](x, w);
      if (ids[i]) hot(x, 10, w, 26, focus === ids[i], () => barGo(ids[i]));
      x -= 8;
    }
  }
  // Recuadro .stage: fondo oscuro con brillo abajo y borde del color del tipo.
  function stage(x, y, w, h, color, shiny) {
    if (shiny) { rr(x - 6, y - 6, w + 12, h + 12, 16); ctx.fillStyle = 'rgba(154,230,255,0.25)'; ctx.fill(); }
    rr(x - 2, y - 2, w + 4, h + 4, 12); ctx.fillStyle = C.edgeOut; ctx.fill();
    rr(x, y, w, h, 10); ctx.fillStyle = color || C.edgeIn; ctx.fill();
    rr(x + 2.5, y + 2.5, w - 5, h - 5, 8); ctx.fillStyle = vgrad(y, h, 'rgba(20,36,78,1)', 'rgba(8,14,34,1)'); ctx.fill();
    const g = ctx.createRadialGradient(x + w / 2, y + h * 0.88, 0, x + w / 2, y + h * 0.88, w * 0.45);
    g.addColorStop(0, 'rgba(120,170,255,0.22)'); g.addColorStop(1, 'rgba(120,170,255,0)');
    ctx.fillStyle = g; ctx.fill();
  }
  // Pantalla de la web: fondo oscurecido, la caja, el título (h2) y "Volver" arriba a la derecha.
  const BX = 114, BY = 50, BW = 732, BH = 452;
  function modal(title, sub) {
    dim();
    box(BX, BY, BW, BH);
    text(T(title), BX + 18, BY + 16, 20, '#fff', 'left', true);
    if (sub) { font(20, true); text(sub, BX + 26 + ctx.measureText(T(title)).width, BY + 22, 11, C.muted); }
    btn(BX + BW - 72, BY + 14, 56, 22, T('Volver'), 'ghost', false, 10);
    topbar();
  }
  // .chip: píldora de filtro; on = dorada. Devuelve el ancho.
  function chip(x, y, label, on, ico) {
    font(10);
    const w = ctx.measureText(label).width + 16 + (ico ? 14 : 0);
    rr(x, y, w, 20, 10); ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fill();
    ctx.strokeStyle = on ? C.gold : 'rgba(244,248,255,0.25)'; ctx.lineWidth = 1.5; ctx.stroke();
    if (ico) icon(ico, x + 7, y + 5, 10);
    text(label, x + 8 + (ico ? 14 : 0), y + 5, 10, on ? C.gold : '#fff');
    return w;
  }
  // .panel: recuadro oscuro translúcido.
  function panel(x, y, w, h) { rr(x, y, w, h, 8); ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.fill(); ctx.strokeStyle = 'rgba(244,248,255,0.2)'; ctx.lineWidth = 1.5; ctx.stroke(); }
  // .stat: nombre, barra y valor (verde o rojo si la naturaleza lo sube o lo baja).
  function statBar(x, y, w, label, frac, val, mood) {
    const col = mood > 0 ? '#7fe8a0' : mood < 0 ? '#ff9aa5' : '#fff';
    text(T(label), x, y, 10, col);
    rr(x + 68, y + 3, w - 68 - 30, 6, 4); ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fill();
    rr(x + 68, y + 3, Math.max(2, (w - 98) * Math.min(1, frac)), 6, 4); ctx.fillStyle = mood > 0 ? '#5fe08a' : mood < 0 ? '#ff7a86' : C.gold; ctx.fill();
    text(String(val), x + w, y, 10, col, 'right');
  }
  // .type: chips de tipo. Devuelve el ancho total.
  function typeChips(types, x, y, center) {
    font(9, true);
    const ws = types.map(t => ctx.measureText(G.U.TYPE_NAME[t] || t).width + 12), tot = ws.reduce((a, b) => a + b + 4, -4);
    let cx = center ? x - tot / 2 : x;
    types.forEach((t, i) => {
      rr(cx, y, ws[i], 14, 4); ctx.fillStyle = G.U.TYPE_COLOR[t] || '#999'; ctx.fill();
      text(G.U.TYPE_NAME[t] || t, cx + 6, y + 2.5, 9, '#10131a', 'left', true, null);
      cx += ws[i] + 4;
    });
    return tot;
  }
  // Texto centrado con espacio entre letras (letter-spacing de la web).
  // Letra a letra y sin el traductor del canvas (i18n.js traduce cada fillText): una «Y» suelta es la «y» española
  // y en inglés salía «AND» («MANDSTERAND DUNGEON»). t ya llega traducido entero.
  function spaced(t, cx, y, px, gap) {
    const raw = (m, ...a) => (G.I18n && G.I18n.rawCanvas ? G.I18n.rawCanvas(ctx, m, ...a) : ctx[m](...a));
    font(px); ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    const ws = [...t].map(ch => raw('measureText', ch).width);
    let x = cx - (ws.reduce((a, b) => a + b + gap, -gap)) / 2;
    [...t].forEach((ch, i) => {
      ctx.fillStyle = C.navy; raw('fillText', ch, x + 1.5, y + 1.5);
      ctx.fillStyle = '#fff'; raw('fillText', ch, x, y);
      x += ws[i] + gap;
    });
  }
  // Trozos de texto seguidos con su color: [['Runs ', muted], ['3', '#fff', true], ...]
  function spans(parts, x, y, px) {
    for (const [t, col, b] of parts) { text(t, x, y, px, col, 'left', !!b); font(px, !!b); x += ctx.measureText(t).width; }
  }
  // Los botones del DualSense, dibujados: la fuente Pixelify no tiene ✕ ○ △ □ ni flechas.
  // k: 'x' ✕ · 'o' ○ · 't' △ · 's' □ · 'lr' / 'ud' cruceta · 'opt' Options. Centro (cx, cy), radio r. Devuelve el ancho.
  const BTN = { x: '#7aa7ff', o: '#ff6b6b', t: '#43dba6', s: '#f193dc' };
  // Con teclado y ratón (escritorio, psKeys), las teclas de browser.js (KEY_PAD) en vez de los botones.
  // Con otro mando (escritorio, psPadType de browser.js), los suyos: por posición, como los mapea SDL
  // (x = el de abajo, o = derecha, s = izquierda, t = arriba). En Nintendo, x (confirmar) es la A, a la derecha, y o la B,
  // abajo: ps.pad ya los da cambiados (main.c). Steam Deck: A B X Y y L1/R1, MENU/VIEW.
  const KEYS = { x: 'ENTER', o: 'ESC', s: 'Z', t: 'R', opt: 'TAB', l1: 'Q', r1: 'E' };   // (R: como «cambiar cartas» de la web)
  // Las acciones (lo que se escribe en los textos como {confirm}) -> el botón por posición de padIcon. Como los glifos
  // de acción de Steam Input: el texto dice qué hace, y cada mando o el teclado pinta el suyo.
  const ACT = { confirm: 'x', back: 'o', alt: 's', alt2: 't', menu: 'opt', view: 'sel', prev: 'l1', next: 'r1', move: 'ud', side: 'lr' };
  const PILLS = {
    ps: { opt: 'OPTIONS', sel: 'TOUCHPAD', l1: 'L1', r1: 'R1', l2: 'L2', r2: 'R2' },
    xbox: { opt: 'MENU', sel: 'VIEW', l1: 'LB', r1: 'RB', l2: 'LT', r2: 'RT' },
    nintendo: { opt: '+', sel: '−', l1: 'L', r1: 'R', l2: 'ZL', r2: 'ZR' },
    joycon: { opt: 'STICK', sel: '+/−', l1: 'SL', r1: 'SR', l2: 'SL', r2: 'SR' },   // (Joy-Con suelto, de lado: platform/switch.c)
    steamdeck: { opt: 'MENU', sel: 'VIEW', l1: 'L1', r1: 'R1', l2: 'L2', r2: 'R2' } };
  const LETTERS = { xbox: { x: ['A', '#5bbf3a'], o: ['B', '#e3443a'], s: ['X', '#3a8be3'], t: ['Y', '#f2c12e'] },
                    nintendo: { x: ['A', '#e8edf6'], o: ['B', '#e8edf6'], s: ['Y', '#e8edf6'], t: ['X', '#e8edf6'] },
                    steamdeck: { x: ['A', '#e8edf6'], o: ['B', '#e8edf6'], s: ['X', '#e8edf6'], t: ['Y', '#e8edf6'] } };   // (letras blancas, como en la Deck)
  const JOY = { x: [1, 0], o: [0, 1], s: [-1, 0], t: [0, -1] };   // (por posición: x/confirmar la de la derecha, como la A; o abajo)
  // Un clic en un icono de botón (las ayudas de abajo, L1/R1 de las pestañas, los de un texto) = pulsar ese botón.
  const ICON_ACT = { x: 'a', o: 'b', s: 'x', t: 'y', opt: 'start', sel: 'sel' };
  // Android sólo con el dedo (sin mando ni teclado): ni iconos de botones ni ayudas de abajo; se toca lo que se ve.
  const TOUCHY = CAN.touch;
  const touchOnly = () => TOUCHY && !(G.Pad && G.Pad.name) && !globalThis.psKeys;
  function padIcon(k, cx, cy, r = 10) {
    if (touchOnly()) return 0;
    if (cy > -500 && (ICON_ACT[k] || k === 'l1' || k === 'r1')) {
      const hw = k.length > 1 && k !== 'lr' && k !== 'ud' ? 22 : r + 2;
      hot(cx - hw, cy - Math.max(r, 9), hw * 2, Math.max(r, 9) * 2, false, ICON_ACT[k] || (() => { shoulderQ += k === 'l1' ? -1 : 1; }));
    }
    ctx.save();
    const type = PILLS[globalThis.psPadType] ? globalThis.psPadType : 'ps';
    const PILL = globalThis.psKeys && KEYS[k] ? KEYS : PILLS[type];
    if (!globalThis.psKeys && type === 'joycon' && JOY[k]) {   // Joy-Con de lado: sus 4 botones como puntos, el que toca lleno
      const d = r * 0.5, q = r * 0.27;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fillStyle = '#0d1220'; ctx.fill();
      ctx.lineWidth = 1.5; ctx.strokeStyle = '#e8edf6'; ctx.stroke();
      for (const kk in JOY) {
        ctx.beginPath(); ctx.arc(cx + JOY[kk][0] * d, cy + JOY[kk][1] * d, q, 0, Math.PI * 2);
        if (kk === k) { ctx.fillStyle = '#e8edf6'; ctx.fill(); } else { ctx.lineWidth = 1; ctx.stroke(); }
      }
      ctx.restore();
      return r * 2;
    }
    if (!globalThis.psKeys && LETTERS[type] && LETTERS[type][k]) {   // A B X Y: la letra en su círculo
      const [l, col] = LETTERS[type][k];
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fillStyle = '#0d1220'; ctx.fill();
      ctx.lineWidth = 1.5; ctx.strokeStyle = col; ctx.stroke();
      text(l, cx, cy - r * 0.62, r * 1.25, col, 'center', true, null);
      ctx.restore();
      return r * 2;
    }
    if (PILL[k]) {
      font(10, true);
      const w = ctx.measureText(PILL[k]).width + 12;
      rect(cx - w / 2, cy - 8, w, 16, '#0d1220', '#c9d3e3', 1.5);
      text(PILL[k], cx, cy - 5, 10, '#e8edf6', 'center', true);
      ctx.restore();
      return w;
    }
    if (k === 'lr' || k === 'ud') {      // la cruceta: dos triángulos
      ctx.fillStyle = '#e8edf6';
      const tri = (ax, ay, bx, by, cx2, cy2) => { ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.lineTo(cx2, cy2); ctx.closePath(); ctx.fill(); };
      if (k === 'lr') { tri(cx - r - 4, cy, cx - 4, cy - r * 0.8, cx - 4, cy + r * 0.8); tri(cx + r + 4, cy, cx + 4, cy - r * 0.8, cx + 4, cy + r * 0.8); }
      else { tri(cx, cy - r - 3, cx - r * 0.8, cy - 3, cx + r * 0.8, cy - 3); tri(cx, cy + r + 3, cx - r * 0.8, cy + 3, cx + r * 0.8, cy + 3); }
      ctx.restore();
      return r * 2 + 8;
    }
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fillStyle = '#0d1220'; ctx.fill();
    ctx.lineWidth = 1.5; ctx.strokeStyle = '#58647c'; ctx.stroke();
    ctx.strokeStyle = BTN[k]; ctx.lineWidth = 2.2; ctx.lineCap = 'round';
    const q = r * 0.48;
    ctx.beginPath();
    if (k === 'x') { ctx.moveTo(cx - q, cy - q); ctx.lineTo(cx + q, cy + q); ctx.moveTo(cx + q, cy - q); ctx.lineTo(cx - q, cy + q); }
    else if (k === 'o') ctx.arc(cx, cy, q * 1.05, 0, Math.PI * 2);
    else if (k === 't') { ctx.moveTo(cx, cy - q * 1.15); ctx.lineTo(cx + q * 1.1, cy + q * 0.8); ctx.lineTo(cx - q * 1.1, cy + q * 0.8); ctx.closePath(); }
    else if (k === 's') ctx.rect(cx - q * 0.95, cy - q * 0.95, q * 1.9, q * 1.9);
    ctx.stroke();
    ctx.restore();
    return r * 2;
  }

  function hints(list, right = W + OX - 24) {   // [['x', 'Elegir'], ...] abajo a la derecha
    if (touchOnly()) return;
    font(14, false);
    let x = right;
    for (let i = list.length - 1; i >= 0; i--) {
      const [k, label] = list[i], lw = ctx.measureText(T(label)).width;
      text(T(label), x, H + OY - 30, 14, C.muted, 'right');   // (OY: al borde de abajo de verdad)
      x -= lw + 8;
      const w = padIcon(k, 0, -100);   // sólo para medir: se dibuja fuera de la pantalla
      padIcon(k, x - w / 2, H + OY - 23);
      x -= w + 22;
    }
  }

  function icon(name, x, y, size) { try { G.Icons.draw(ctx, name, x, y, size); } catch (e) { /* icono que no existe */ } }

  // ---------------- pantallas ----------------
  let top = null;   // la pantalla abierta: { draw(now), input(ev) }

  // Cargador: abajo a la derecha, encima de todo, fuera de la partida, mientras algo carga más de medio segundo: la red
  // (shim/net.js, psNetPending), imágenes por descomprimir (browser.js) o el terreno del menú (boot.js, los primeros
  // segundos). En pixel art, como el juego: 8 bloques en círculo, el de delante blanco y una estela dorada.
  let netSince = 0;
  const loading = () => (globalThis.psNetPending ? psNetPending() : 0) + (globalThis.psImgsPending ? psImgsPending() : 0) +
                        (globalThis.psPreBusy && psPreBusy() ? 1 : 0);
  // s: tamaño de cada bloque (4 en la esquina, 8 en la pantalla de carga).
  function spin(x, y, now, s) {
    const head = Math.floor(now / 90) % 8, r = s * 2.25;
    screen.save();
    screen.setTransform(K, 0, 0, K, OX * K, OY * K);
    for (let k = 0; k < 8; k++) {
      const a = k * Math.PI / 4, px = Math.round(x + Math.cos(a) * r - s / 2), py = Math.round(y + Math.sin(a) * r - s / 2), age = (head - k + 8) % 8;
      screen.fillStyle = 'rgba(0,0,0,0.5)'; screen.fillRect(px + s / 4, py + s / 4, s, s);   // sombra dura
      screen.fillStyle = age === 0 ? '#fff' : age < 3 ? C.gold : 'rgba(255,210,63,0.3)';
      screen.fillRect(px, py, s, s);
    }
    screen.restore();
  }
  function spinner(now) {
    if (!loading() || G.Game.state === 'playing') { netSince = 0; return; }
    if (!netSince) netSince = now;
    if (now - netSince >= 500) spin(30, H - 58, now, 4);   // abajo a la izquierda: a la derecha se perdía en el menú
  }

  // ---------------- listas que se desplazan sin redibujar ----------------
  // Redibujar una pantalla entera cuesta 30-45 ms en Android (QuickJS + PlutoVG en la CPU): desplazar iba a 20 fps.
  // Una pantalla con scrollNow() pinta su lista entre scrollBegin y scrollEnd: va a un lienzo alto (lo visible y SPAD de
  // más por arriba y por abajo) y cada fotograma psOverlay copia de él la ventana de ahora (en la GPU, un cuadrilátero),
  // y mueve con ella los recuadros de clic (hots con sc). Sólo se redibuja si cambia su key() (que no lleva el scroll) o
  // si la vista se sale de lo pintado. Fuera de psOverlay (focusTo) o sin scrollNow, recorte normal como antes.
  // Recortar por posición dentro de la lista: con vTop/vBot (lo que se pinta), no con los bordes de la caja.
  // ponytail: un redibujo cada SPAD px de desplazamiento; si se nota, pintar más (cuidado con el tamaño de la textura).
  const SPAD = 600;
  let tallCv = null, layer = null, layerNext = null, layerOn = false, hotSc = null, vTop = 0, vBot = H;
  function scrollBegin(x, y, w, h, s) {
    ctx.save();
    if (!layerOn || ctx !== bufCtx) { rr(x, y, w, h, 4); ctx.clip(); vTop = y; vBot = y + h; return; }
    const cw = Math.ceil(w * K), ch = Math.ceil((h + 2 * SPAD) * K);
    if (!tallCv) tallCv = document.createElement('canvas');
    if (tallCv.width !== cw || tallCv.height !== ch) { tallCv.width = cw; tallCv.height = ch; }
    const c = tallCv.getContext('2d');
    c.save();
    c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, cw, ch);
    c.setTransform(K, 0, 0, K, -x * K, (SPAD - y) * K);   // (x, y - SPAD) de la maqueta → (0, 0) del lienzo alto
    hotSc = layerNext = { x, y, w, h, s, prev: ctx };
    ctx = c; vTop = y - SPAD; vBot = y + h + SPAD;
  }
  function scrollEnd() {
    if (hotSc) { ctx.restore(); ctx = hotSc.prev; hotSc = null; }
    ctx.restore(); vTop = 0; vBot = H;
  }

  // @step native/frame
  const GAME_SCR = new Set(['scr-levelup', 'scr-item', 'scr-bond', 'scr-pause', 'scr-over']);
  globalThis.psOverlay = now => {
    // Si el juego cierra la pantalla por su cuenta (p. ej. quita la pausa), se cierra también aquí. (Sólo las que el juego
    // abre y cierra con G.UI.show / hide: las propias de ui.js, como scr-core-cards, no.)
    if (top && GAME_SCR.has(top.id) && !G.UI.isOpen(top.id)) { if (top.id === 'scr-levelup') console.log('[cartas] el juego las cierra'); close(); }
    if (!top) { spinner(now); return; }
    const ev = readInput(now);
    if (!top) { spinner(now); return; }   // (un clic de readInput la cerró)
    try {
      const out = screen;
      const key = (top.key ? top.key(now) : String(now)) + (globalThis.psKeys ? '·k' : '') + (touchOnly() ? '·t' : '') + (liveWant ? '·w' + liveWant : '');   // (teclas, botones o nada: padIcon; typeIn)
      const drift = layer && top.scrollNow ? top.scrollNow() - layer.s : 0;
      if (key !== lastKey || Math.abs(drift) > SPAD) {
        lastKey = key;
        hots = [];
        ctx = bufCtx;
        ctx.setTransform(K, 0, 0, K, OX * K, OY * K);
        ctx.clearRect(-OX, -OY, W + 2 * OX, H + 2 * OY);
        dimDrawing = true; dimUnder = false; layerOn = !!top.scrollNow; layerNext = null;
        try { top.draw(now); } finally { dimDrawing = layerOn = false; if (hotSc) { ctx = bufCtx; hotSc = null; } layer = layerNext; }
        ctx = screen;
      }
      const d = layer && top.scrollNow ? top.scrollNow() - layer.s : 0;
      if (layer) for (const r of hots) if (r.sc) { const y = r.y0 - d; r.y = y + r.h < layer.y || y > layer.y + layer.h ? -1e5 : y; }   // (fuera de la lista: no se pulsa)
      out.save();
      out.setTransform(1, 0, 0, 1, 0, 0);   // (buf ya está a la resolución de verdad)
      out.globalAlpha = 1;
      out.globalCompositeOperation = 'source-over';
      if (dimUnder) out.drawImage(dimCv, 0, 0);
      out.drawImage(buf, 0, 0);
      if (layer) out.drawImage(tallCv, 0, (SPAD + d) * K, layer.w * K, layer.h * K, (layer.x + OX) * K, (layer.y + OY) * K, layer.w * K, layer.h * K);
      out.setTransform(K, 0, 0, K, OX * K, OY * K);
      if (top.live) { ctx = out; top.live(now); ctx = screen; }   // lo que se mueve (sprites), encima, cada fotograma
      out.restore();
      spinner(now);
      top.input(ev, now);
    } catch (e) { ctx = screen; console.error('[ui] ' + e.message + '\n' + e.stack); }
  };
  // Mientras hay una pantalla abierta el juego no ve el mando (browser.js, psPadHeld). Lo que ya estaba
  // pulsado al abrir no cuenta como pulsación nueva.
  const open = s => {
    top = s; lastKey = null; prev = psPadRaw().buttons.slice(); globalThis.psPadHeld = true;
    const m = globalThis.psMouse; if (m) m.click = m.right = m.wheel = 0;   // (lo de antes de abrirla no cuenta)
  };
  const close = () => { top = null; globalThis.psPadHeld = false; globalThis.psPadRelease = true; globalThis.psTextSink = null; };
  globalThis.psUiClose = () => { if (top) close(); };

  const GUARD = 600;   // como en la web: las cartas no se pueden elegir hasta pasados 0,6 s
  const rerollsLeft = () => { const p = G.Game.player; return p ? Math.max(0, 1 + (p.rerollBonus || 0) - (p.rerolls || 0)) : 0; };

  // En solitario (la zona es toda la pantalla: móvil, tele): las cartas una al lado de otra y con letra grande; la lista
  // de antes, a 444 de ancho y letra de 10, se quedaba en el centro y no se leía. También las del cooperativo, en su zona.
  function cardRow(list, sel, x, y, w, h, guard, pick) {
    const GAP = 12, n = list.length, cw = Math.min(280, (w - GAP * (n - 1)) / n), x0 = x + (w - (cw * n + GAP * (n - 1))) / 2;
    list.forEach((c, i) => {
      const on = i === sel, cx = x0 + i * (cw + GAP), cy = y - (on ? 4 : 0), mid = cx + cw / 2;
      hot(cx, y - 4, cw, h + 4, on, pick ? () => pick(i) : undefined);
      ctx.globalAlpha = guard ? 0.55 : 1;
      rr(cx, cy, cw, h, 12);
      ctx.fillStyle = c.evo ? 'rgba(255,210,63,0.12)' : c.bond ? 'rgba(255,138,216,0.12)' : on ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.2)'; ctx.fill();
      ctx.strokeStyle = on ? (c.evo ? C.gold : C.edge) : c.evo ? C.gold : c.bond ? '#ff8ad8' : 'rgba(244,248,255,0.3)'; ctx.lineWidth = on ? 3 : 1.5; ctx.stroke();
      if (on) { rr(cx - 4, cy - 4, cw + 8, h + 8, 14); ctx.strokeStyle = C.gold; ctx.lineWidth = 2.5; ctx.stroke(); }
      rr(mid - 32, cy + 16, 64, 64, 12); ctx.fillStyle = (c.color || '#9fb1c9') + '33'; ctx.fill();
      icon(c.icon, mid - 24, cy + 24, 48);
      let ty = cy + 92;
      wrap(strip(c.title), cw - 24, 17, true).slice(0, 2).forEach(l => { text(l, mid, ty, 17, c.evo ? C.gold : c.bond ? '#ff8ad8' : '#fff', 'center', true); ty += 21; });
      const chips = (c.chips || []).map(([label, bg, fg, border]) => { font(11, true); return [label, bg, fg, border, ctx.measureText(label).width + 12]; });
      let chx = mid - (chips.reduce((a, k) => a + k[4] + 4, 0) - 4) / 2;
      for (const [label, bg, fg, border, chw] of chips) {
        rr(chx, ty + 2, chw, 17, 5); ctx.fillStyle = bg; ctx.fill();
        if (border) { ctx.strokeStyle = border; ctx.lineWidth = 1; ctx.stroke(); }
        text(label, chx + 6, ty + 5, 11, fg || '#10131a', 'left', true, null); chx += chw + 4;
      }
      ty += chips.length ? 28 : 6;
      const lines = Math.max(1, Math.floor((cy + h - (c.key ? 36 : 12) - ty) / 17));
      wrap(c.desc, cw - 28, 13).slice(0, lines).forEach(l => { text(l, cx + 14, ty, 13, C.muted); ty += 17; });
      if (c.key) { rr(mid - 11, cy + h - 30, 22, 22, 5); ctx.strokeStyle = 'rgba(244,248,255,0.3)'; ctx.lineWidth = 1.5; ctx.stroke(); text(c.key, mid, cy + h - 25, 11, C.muted, 'center'); }
      ctx.globalAlpha = 1;
    });
  }
  // Las etiquetas de una carta de nivel, como renderCards de js/ui/run-ui.js.
  function levelChips(c) {
    const cat = c.cat ? [[T(strip(c.cat)), 'rgba(10,20,48,0.55)', '#f4f8ff', 'rgba(170,195,255,0.5)']] : [];
    if (c.type === 'new') return [[T('Nuevo') + ' · ' + strip(c.tag), c.color]].concat(cat);
    if (c.type === 'up' || c.type === 'evo') return [[strip(c.tag), c.color]].concat(cat);
    return [[strip(c.tag), c.color === '#ffd23f' ? '#ffd23f' : '#9fb1c9']];
  }
  // Caja centrada de ancho w (.box.center) con su título; devuelve [x, y] de dentro.
  // Pregunta de sí/no: done(true | false). (Como la de «¿Traer tu partida de la consola?».)
  function ask(title, body, yes, no, done) {
    let sel = 1;
    open({
      key: () => String(sel),
      draw() {
        const [x, y] = centerBox(480, 230, T(title));
        wrap(T(body), 440, 10.5).forEach((l, i) => text(l, x + 20, y + 50 + i * 14, 10.5, '#fff'));
        btn(x + 20, y + 180, 210, 32, T(yes), 'gold', sel === 0, 12, undefined, () => { sel = 0; });
        btn(x + 250, y + 180, 210, 32, T(no), 'blue', sel === 1, 12, undefined, () => { sel = 1; });
        hot(x + 20, y + 180, 210, 32, false, () => { sel = 0; close(); done(true); });
        hot(x + 250, y + 180, 210, 32, false, () => { close(); done(false); });
        hints([['lr', 'Mover'], ['x', 'Elegir'], ['o', 'Volver']]);
      },
      input(ev) {
        if (ev.dx) { sel = 1 - sel; G.Audio.sfx('select'); }
        if (ev.b) { G.Audio.sfx('back'); close(); return done(false); }
        if (!ev.a) return;
        G.Audio.sfx(sel === 0 ? 'confirm' : 'back'); close(); done(sel === 0);
      },
    });
  }

  function centerBox(w, h, title, sub) {
    dim();
    const x = (W - w) / 2, y = (H - h) / 2;
    box(x, y, w, h);
    text(title, W / 2, y + 16, 19.5, '#fff', 'center', true);
    if (sub) text(sub, W / 2, y + 44, 11, C.muted, 'center');
    return [x, y];
  }

  // En grupo (coop): al elegir se queda la carta a la vista con «Esperando a…» (setWaiting, como #lvl-wait de la web)
  // hasta que eligen todos (closeLevelUp). Antes se cerraba y sólo se veía la partida parada.
  let waitText = '';
  function setWaiting(names) {
    const me = G.Social.me ? G.Social.me.name : '', others = names.filter(n => n !== me);
    if (names.join() !== (setWaiting.last || '')) console.log('[cartas] faltan: ' + (names.join(', ') || 'nadie'));   // (diagnóstico)
    setWaiting.last = names.join();
    const list = a => (a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' ' + T('y') + ' ' + a[a.length - 1]);
    waitText = !names.length ? '' : !others.length ? T('Elige tu carta')
      : names.includes(me) ? G.I18n.f('Faltan por elegir: {x}', list([...others, T('tú')])) : G.I18n.f('Esperando a {x}…', list(others));
  }
  // Cooperativo online (el JS de la web, sin núcleo): las mismas cartas que offline (soloCards, en fila a toda la pantalla),
  // no una lista aparte. c: { offer, level?, rerolls?, title?, sub? }; choose(carta); reroll() (△ o su botón), si hay.
  function rowCards(id, c, level, choose, reroll) {
    const since = ps.now();
    Object.assign(c, { sel: 0, top: 0, zone: [0, 0, ps.W, ps.H], onReroll: reroll });
    const go = () => { if (ps.now() - since >= GUARD && c.offer[c.sel]) choose(c.offer[c.sel]); };
    c.onPick = j => { c.sel = c.top + j; go(); };
    open({ wheel: true, id,
      key: now => c.sel + '|' + c.top + '|' + c.offer.map(k => k.title).join() + '|' + (now - since < GUARD) + '|' + (c.rerolls ? c.rerolls() : 0),
      draw(now) {
        dim();
        soloCards(c, now, level, since);
        const hh = [['lr', 'Mover'], ['x', 'Elegir']];
        if (c.rerolls && c.rerolls() > 0) hh.push(['t', T('Cambiar opciones (').replace(/\s*\($/, '')]);
        hints(hh);
      },
      input(ev) {
        if (ev.num && c.offer[ev.num - 1]) { c.sel = ev.num - 1; return go(); }   // (tecla 1-9: esa carta)
        if (ev.wheelRows) c.top = (c.top | 0) + ev.wheelRows;   // (sólo la vista)
        const d = ev.dx || ev.dy;
        if (d) { c.sel = (c.sel + d + c.offer.length) % c.offer.length; G.Audio.sfx('select'); }
        if (ev.y && reroll) reroll();
        if (ev.a) go();
      },
    });
  }
  function showLevelUp(level, list, cb, coop = false) {
    waitText = '';
    console.log('[cartas] nivel ' + level + (coop ? ' (grupo)' : '') + ': ' + list.length + ' cartas');
    G.UI.show('scr-levelup');
    const c = { offer: list, level: true, rerolls: rerollsLeft };
    rowCards('scr-levelup', c, level, k => {
      console.log('[cartas] elegida: ' + k.title);
      close();
      if (coop) waitPicked(level, k);   // antes de cb: si eras el último, cb ya la cierra (closeLevelUp)
      else G.UI.hide('scr-levelup');
      cb(k);
    }, () => {
      if (rerollsLeft() <= 0) return;
      G.Game.player.rerolls = (G.Game.player.rerolls || 0) + 1;
      c.offer = G.LevelUp.offer(G.Game.player);
      c.sel = Math.min(c.sel, c.offer.length - 1);
      G.Audio.sfx('select');
    });
  }
  // Núcleo en C (shim/core.js): una carta de nivel por jugador, a la vez, cada uno en su zona de la pantalla y con el
  // mismo dibujo que las de siempre. La entrada la lleva core.js (el mando de cada uno).
  //   psCoreCards(nivel, sets): sets [{ i, offer, sel, done, zone: [x, y, w, h], color }] (se leen en cada dibujo).
  //   psCoreCards(null): se cierra. Un set con title / sub: otra ventana con cartas (el objeto: quedárselo o cambiarlo).
  // Los cambios de opciones que le quedan al jugador de una carta del núcleo (como rerollsLeft, por jugador).
  const coreRerolls = c => { const p = globalThis.psCore && psCore.player(c.i); return p ? Math.max(0, 1 + (p.rerollBonus || 0) - (p.rerolls || 0)) : 0; };
  globalThis.psCoreCards = (level, sets) => {
    if (!sets) { if (top && top.id === 'scr-core-cards') close(); return; }
    const since = ps.now();
    open({ wheel: true, id: 'scr-core-cards',
      // (c.rr: cuántas veces se cambiaron sus cartas, core.js; si no, el dibujo se quedaba con las de antes)
      key: now => sets.map(c => c.sel + (c.done ? 'd' : '') + 'r' + (c.rr || 0) + 't' + (c.top | 0)).join('|') + (now - since < GUARD),
      draw(now) {
        dim();
        for (const c of sets) {
          if (!c.offer.length) continue;
          if (sets.length === 1 && !c.done) { soloCards(c, now, level, since); continue; }
          // Las mismas cartas en fila que en solitario (soloCards), en su zona: se dibujan en una de al menos 900 de ancho
          // y se escalan a la zona (en un cuarto, ×0,53). Elegida: sólo la suya, con «Esperando a los demás…».
          const [zx, zy, zw, zh] = c.zone.map((v, i) => v / K - (i === 0 ? OX : i === 1 ? OY : 0)), vw = Math.max(zw, 900), s = zw / vw;
          const v = !c.done ? c : { ...c, offer: [c.offer[c.sel]], sel: 0, top: 0, level: false, onPick() {},
                                    sub: T('Tu elección') + ' · ' + T('Esperando a los demás…') };
          hotXf = (hx, hy, hw, hh) => [zx + hx * s, zy + hy * s, hw * s, hh * s];
          ctx.save();
          ctx.translate(zx, zy); ctx.scale(s, s);
          soloCards(v, now, level, c.done ? 0 : since, [0, 0, vw, zh / s], 'J' + (c.i + 1) + ' · ');
          hotXf = null;
          ctx.restore();
        }
        hints([['lr', 'Mover'], ['x', 'Elegir']]);
      },
      // Tecla 1-9: la carta del jugador 1 (el teclado es suyo); la elige core.js (cardsInput), con su espera.
      // Rueda o arrastrar con el dedo: mueve la lista del jugador 1 (sólo la vista; el dibujo la acota).
      input(ev) {
        const c = sets.find(s => s.i === 0 && !s.done);
        if (ev.num && c && c.offer[ev.num - 1]) { c.sel = ev.num - 1; c.pick = true; }
        if (ev.wheelRows && c) c.top = (c.top | 0) + ev.wheelRows;
      },
    });
  };
  // Las cartas del núcleo de un solo jugador: toda la pantalla, en fila (cardRow). Como mucho 4 a la vista (modo dev: todas,
  // la fila se desplaza con el cursor). ←/→ o ↑/↓ las recorren (core.js).
  // z: la zona ya en coordenadas de ui.js (las del cooperativo, escaladas); pre: delante del título («J2 · »).
  function soloCards(c, now, level, since, z, pre = '') {
    const [zx, zy, zw, zh] = z || c.zone.map((v, i) => v / K - (i === 0 ? OX : i === 1 ? OY : 0)), n = c.offer.length, cap = Math.min(4, n);
    const follow = c.sel !== c.seenSel; c.seenSel = c.sel;
    c.top = Math.max(0, Math.min(n - cap, !follow ? c.top | 0 : c.sel < (c.top | 0) ? c.sel : c.sel >= (c.top | 0) + cap ? c.sel - cap + 1 : c.top | 0));
    const rl = c.level ? (c.rerolls ? c.rerolls() : coreRerolls(c)) : 0, x = zx + 16, w = zw - 32, h0 = zh - 50;
    // Cartas al 65 % del alto (tenían mucho hueco) y debajo, a lo ancho de la fila, el botón de cambiar opciones (19-11):
    // grande para el dedo en la tablet. La ventana, centrada en su zona (la pantalla, o la del jugador en el cooperativo).
    // (y no más de 1,45 veces su ancho: en el cooperativo, con media pantalla, eran estrechas y altísimas; cardRow: GAP 12, máx. 280)
    const cwEst = Math.min(280, (w - 32 - 12 * (cap - 1)) / cap);
    const ch = Math.min(Math.round((h0 - 72 - 18) * 0.65), Math.round(cwEst * 1.45)), BH = 56;
    // (arriba, siempre donde iría con el botón: no salta al gastarlo y las del cooperativo quedan alineadas)
    const h = 72 + ch + (rl > 0 ? 16 + BH + 16 : 18), y = zy + 12 + Math.max(0, (h0 - (72 + ch + 16 + BH + 16)) / 2);
    box(x, y, w, h);
    text(pre + (c.title || G.I18n.f('¡Nivel {x}!', level)), zx + zw / 2, y + 14, 24, c.color || '#fff', 'center', true);
    text((c.sub || T('Elige una recompensa ·').replace(/\s*·$/, '')) + (n > cap ? '  ·  ' + (c.sel + 1) + ' / ' + n : ''), zx + zw / 2, y + 46, 12, C.muted, 'center');
    const cy = y + 72;
    cardRow(c.offer.slice(c.top, c.top + cap).map((k, j) => ({ ...k, evo: k.type === 'evo', chips: levelChips(k), key: String(c.top + j + 1) })),
            c.sel - c.top, x + 16, cy, w - 32, ch, now - since < GUARD, j => { if (c.onPick) return c.onPick(j); c.sel = c.top + j; c.pick = true; });
    if (rl > 0) {   // "Cambiar opciones (1) · △", como en la lista
      const label = T('Cambiar opciones (') + rl + ') ·', fs = 18;
      font(fs, true); const tw = ctx.measureText(label).width, cw = tw + 18 + 20;
      const bw = w - 32, bx = x + 16, by = cy + ch + 16;
      btn(bx, by, bw, BH, null, 'ghost', false);
      hot(bx, by, bw, BH, false, () => { if (c.onReroll) c.onReroll(); else c.reroll = true; });
      const tx = bx + (bw - cw) / 2;
      text(label, tx, by + BH / 2 - fs / 2, fs, '#fff', 'left', true);
      padIcon('t', tx + tw + 18, by + BH / 2, 10);
    }
  }
  function waitPicked(level, k) {
    const c = { offer: [k], sel: 0, top: 0, zone: [0, 0, ps.W, ps.H], onPick() {} };
    open({ id: 'scr-levelup',
      key: () => waitText,
      draw(now) { dim(); c.sub = waitText || T('Esperando a los demás…'); soloCards(c, now, level, 0); },
      input() {},
    });
  }

  function showItemChoice(cur, next, cb) {
    const offer = [cur, next].map((id, i) => {
      const it = G.Items.BY[id];
      return { id, icon: id, title: T(i ? 'Cambiar a' : 'Quedarme con') + ' ' + T(it.name), tag: T(it.name), desc: T(it.desc), color: '#ffd23f' };
    });
    G.UI.show('scr-item');
    rowCards('scr-item', { offer, title: T('¡Un objeto!'), sub: T('Sólo puedes llevar uno ·').replace(/\s*·$/, '') }, 0,
             k => { close(); G.UI.hide('scr-item'); cb(k.id); });
  }

  // Como showBond de js/ui/run-ui.js: qué movimientos se fusionan. 'add': uno suelto se une al grupo;
  // 'pair': dos sueltos, en dos pasos (○ vuelve al primero).
  let bondPick = null;   // para pickBond (las teclas 1-9 de game.js)
  function showBond(opt, cb) {
    let first = null, sel = 0, since = ps.now();
    const names = ms => ms.map(m => T(m.name, 'move')).join(' + ');
    const list = () => opt.mode === 'pair' && first ? opt.loose.filter(m => m !== first) : opt.loose;
    const pick = i => {
      const m = list()[i];
      if (!m || ps.now() - since < GUARD) return;
      if (opt.mode === 'pair' && !first) { first = m; sel = 0; since = ps.now(); G.Audio.sfx('select'); return; }
      bondPick = null; close(); G.UI.hide('scr-bond');
      cb(opt.mode === 'add' ? [m] : [first, m]);
    };
    bondPick = pick;
    const c = { title: T('¡Vínculo!'), offer: [], sel: 0, top: 0, zone: [0, 0, ps.W, ps.H], onPick: j => { sel = c.top + j; pick(sel); } };
    G.UI.show('scr-bond');
    open({ wheel: true, id: 'scr-bond',
      key: now => sel + '|' + (first ? first.id : '') + '|' + (now - since < GUARD),
      // Las mismas cartas en fila que el vínculo del núcleo (soloCards), no la lista de antes.
      draw(now) {
        dim();
        const step2 = opt.mode === 'pair' && first, l = list();
        c.sub = opt.mode === 'add' ? G.I18n.f('Elige qué movimiento se une a {x}', names(opt.group))
          : step2 ? G.I18n.f('¿Con cuál unes {x}?', T(first.name, 'move')) : T('Elige el primer movimiento que vas a unir');
        c.sel = sel;
        c.offer = l.map(m => ({
          icon: 'move:' + m.id, title: T(m.name, 'move') + ' · ' + T(G.Stats.label(m)), color: G.U.TYPE_COLOR[m.type], bond: opt.mode === 'add' || step2,
          tag: T('Nv.') + m.lvl,
          desc: opt.mode === 'add' ? G.I18n.f('Se lanzará a la vez que {x}.', names(opt.group))
            : step2 ? G.I18n.f('Se lanzará a la vez que {x}. Queda un hueco libre.', T(first.name, 'move')) : strip(m.desc || ''),
        }));
        soloCards(c, now, 0, since);
        const hh = [['lr', 'Mover'], ['x', 'Elegir']];
        if (step2) hh.push(['o', 'Atrás']);
        hints(hh);
      },
      input(ev) {
        const n = list().length, d = ev.dx || ev.dy;
        if (ev.num && ev.num <= n) { sel = ev.num - 1; return pick(sel); }   // (tecla 1-9: ese movimiento)
        if (ev.wheelRows) c.top = (c.top | 0) + ev.wheelRows;
        if (d && n) { sel = (sel + d + n) % n; G.Audio.sfx('select'); }
        if (ev.a) pick(sel);
        else if (ev.b && first) { first = null; sel = 0; G.Audio.sfx('select'); }
      },
    });
  }
  function pickBond(i) { if (bondPick) bondPick(i); }
  function bondBack() { /* ○ en la pantalla */ }

  // En la web, main.js puede arrancar el juego (Game.init → wirePause) antes de que cargue este archivo: entonces lo tiene la
  // wirePause de run-ui.js, en el onclick de #btn-resume / #btn-quit. Sin esto, «Abandonar run» y «Continuar» no hacían nada.
  // (lo que el juego pidió antes de cargar esto, en la web: G.RunUI.wirePause de js/game/run-ui.js)
  let onResume = (G.RunUI.pause || {}).resume || (() => {}), onQuit = (G.RunUI.pause || {}).quit || (() => {});
  function wirePause(resume, quit) { onResume = resume; onQuit = quit; }

  // Como #scr-pause: Continuar / Abandonar y el resumen de la partida (pauseSummary de la web), desplazable.
  function showPause() {
    const pl = G.Game.player;
    let sel = 0, confirm = false, yes = false, scroll = 0, maxScroll = 0;   // yes: en la confirmación, el cursor en "Sí"
    const opts = [['Continuar', 'gold', () => { close(); onResume(); }], ['Ajustes', 'blue', () => { close(); settingsScreen(showPause); }], ['Abandonar run', 'blue', () => { confirm = true; yes = false; }]];
    G.UI.show('scr-pause');
    const BW2 = 538, X = (W - BW2) / 2, Y = 10, BH2 = H - 50;
    open({ wheel: true, id: 'scr-pause',
      key: () => sel + '|' + confirm + '|' + yes + '|' + scroll,
      draw() {
        dim();
        box(X, Y, BW2, BH2);
        ctx.save(); rr(X + 3, Y + 3, BW2 - 6, BH2 - 6, 6); ctx.clip();
        let y = Y + 14 - scroll;
        text(T('Pausa'), W / 2, y, 19.5, '#fff', 'center', true); y += 30;
        // Botones (.row)
        font(13, true);
        const ws = opts.map(([l]) => ctx.measureText(T(l)).width + 30), tot = ws.reduce((a, b) => a + b + 10, -10);
        let bx = W / 2 - tot / 2;
        opts.forEach(([l, kind], i) => { btn(bx, y, ws[i], 30, T(l), kind, i === sel, 12, undefined, () => { sel = i; }); bx += ws[i] + 10; });
        y += 46;
        if (pl) {
          const t = G.Game.st.time, n = v => Math.round(v).toLocaleString();
          const k2 = v => '×' + v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }), pct = v => Math.round(v * 100) + ' %';
          const L = X + 18, RW2 = BW2 - 36;
          const h3g = t2 => { text(T(t2), L, y, 11, C.gold, 'left', true); y += 18; };
          h3g('Tus ataques');
          text(T('Daño'), L + RW2 - 110, y, 8.5, C.muted, 'right'); text(T('Por segundo'), L + RW2, y, 8.5, C.muted, 'right'); y += 13;
          for (const m of pl.moves) {
            const secs = Math.max(5, t - (m.since || 0));
            icon('move:' + m.id, L, y - 2, 14);
            const nm = T(m.name, 'move'); text(nm, L + 18, y, 10, '#fff'); font(10); text(T('Nv.') + m.lvl, L + 22 + ctx.measureText(nm).width, y + 1, 8.5, C.muted);
            { const lb = T(G.Stats.label(m)); font(8, true); const cw = ctx.measureText(lb).width + 10; rr(L + 210, y - 1, cw, 13, 4); ctx.fillStyle = G.U.TYPE_COLOR[m.type]; ctx.fill(); text(lb, L + 215, y + 1.5, 8, '#10131a', 'left', true, null); }
            text(m.cat ? n(m.dealt || 0) : '—', L + RW2 - 110, y, 10, '#fff', 'right');
            text(m.cat ? n((m.dealt || 0) / secs) + '/s' : '—', L + RW2, y, 10, '#fff', 'right');
            ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fillRect(L, y + 15, RW2, 1);
            y += 19;
          }
          y += 6;
          h3g('Tus estadísticas');
          const mon = pl.mon, fis = 1 - G.Stats.taken(mon, 'physical'), esp = 1 - G.Stats.taken(mon, 'special');
          const guard = v => (v >= 0 ? '−' : '+') + Math.round(Math.abs(v) * 100) + ' %';
          const st = [['Vida', n(pl.hp) + ' / ' + n(pl.maxHp)], ['Ataque', k2(pl.atkFor({ cat: 'physical' }))], ['At. Esp.', k2(pl.atkFor({ cat: 'special' }))],
                      ['Defensa', mon.df + ' ' + guard(fis)], ['Def. Esp.', mon.sd + ' ' + guard(esp)], ['Velocidad', n(pl.spd)],
                      ['Crítico', pct(pl.critChance || 0)], ['Reducción de daño', pct(pl.reduction)], ['Recarga', pl.cdMul < 0.995 ? '−' + pct(1 - pl.cdMul) : '0 %'],
                      ['Regeneración', pl.regen.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' /s']];
          const cw3 = (RW2 - 20) / 3;
          st.forEach(([a, v], i) => {
            const cx = L + (i % 3) * (cw3 + 10), cy = y + Math.floor(i / 3) * 18;
            text(T(a), cx, cy, 9.5, C.muted); text(v, cx + cw3, cy, 9.5, '#fff', 'right', true);
            ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fillRect(cx, cy + 14, cw3, 1);
          });
          y += Math.ceil(st.length / 3) * 18 + 8;
          h3g('Objeto y cartas');
          const it = pl.item && G.Items.BY[pl.item];
          if (it) { icon(pl.item, L, y - 2, 14); wrap(T(it.name) + ': ' + T(it.desc), RW2 - 20, 10).forEach(l => { text(l, L + 18, y, 10, C.muted); y += 13; }); }
          else { text(T('Sin objeto.'), L, y, 10, C.muted); y += 13; }
          y += 4;
          const cardsT = Object.entries(pl.statsTaken || {}).map(([id, c]) => { const s2 = G.LevelUp.STATS.find(x => x.id === id); return s2 ? [s2.icon, T(s2.title) + ' ×' + c] : null; }).filter(Boolean);
          if (cardsT.length) { let cx = L; for (const [ic, l] of cardsT) { font(10); const cw = ctx.measureText(l).width + 30; if (cx + cw > L + RW2) { cx = L; y += 24; } chip(cx, y, l, false, ic); cx += cw + 5; } y += 26; }
          else { text(T('Aún no has cogido cartas de mejora.'), L, y, 10, C.muted); y += 16; }
          y += 4;
          h3g('Tus esferas');
          const orbs = (pl.orbs || []).filter(Boolean);
          if (!orbs.length) { wrap(T('Aún no llevas esferas. Salen de los cofres, de los jefes y, a veces, al derrotar a un Pokémon.'), RW2, 10).forEach(l => { text(l, L, y, 10, C.muted); y += 13; }); }
          for (const o0 of orbs) {
            const o = G.Orbs.BY[o0.id];
            icon('orb:' + o0.id, L, y - 2, 14);
            wrap(T(o.name) + (o0.n > 1 ? ' ×' + o0.n : '') + ': ' + T(o.desc), RW2 - 20, 10).forEach(l => { text(l, L + 18, y, 10, C.muted); y += 13; });
          }
          y += 6;
        }
        ctx.restore();
        maxScroll = Math.max(0, y + scroll - (Y + BH2 - 10));
        if (confirm) {
          dim();
          box(W / 2 - 200, 190, 400, 130);
          text(T('¿Abandonar la run?'), W / 2, 208, 16, '#fff', 'center', true);
          text(T('Se guarda lo que hayas conseguido.'), W / 2, 236, 11, C.muted, 'center');
          btn(W / 2 - 150, 270, 140, 30, T('Sí, abandonar'), 'blue', yes, 12, undefined, () => { yes = true; });
          btn(W / 2 + 10, 270, 140, 30, T('No'), 'gold', !yes, 12, undefined, () => { yes = false; });
          hints([['lr', 'Mover'], ['x', 'Elegir'], ['o', 'No']]);
          return;
        }
        hints([['lr', 'Mover'], ['ud', 'Desplazar'], ['x', 'Elegir'], ['o', 'Continuar']]);
      },
      input(ev) {
        if (confirm) {
          if (ev.dx) { yes = !yes; G.Audio.sfx('select'); }
          if (ev.a && yes) { close(); onQuit(); }
          else if (ev.a || ev.b) { confirm = false; G.Audio.sfx('back'); }
          return;
        }
        if (ev.dx) { do sel = (sel + ev.dx + opts.length) % opts.length; while (!opts[sel][2]); G.Audio.sfx('select'); }
        if (ev.dy || ev.wheelPx) scroll = Math.max(0, Math.min(maxScroll, scroll + scrollStep(ev, 50)));
        if (ev.a && opts[sel][2]) opts[sel][2]();
        else if (ev.b || ev.start) { close(); onResume(); }
      },
    });
  }

  // Como #scr-over: el título y las cifras en tarjetas (.stats), y "Volver al menú".
  let overBack = null;
  function showOver(r, onBack) {
    let since = ps.now();
    overBack = () => {
      overBack = null; close();
      // Lo que hace la web al volver: G.Flow.afterRun -> goMenu, que aquí es el menú para mando.
      G.UI.hideAll();
      try { onBack(); } catch (e) { console.warn('[ui] volver al menú: ' + e.message); mainMenu(); }
    };
    G.UI.show('scr-over');
    const half = [['Tiempo', G.U.mmss(r.time)], ['Nivel', r.level], ['Derrotados', r.kills], ['Jefes', r.bosses]];
    const full = [];
    if (r.judge) {   // (Halloween: el gran Gengar en vez de Arceus)
      full.push([r.judge.gengar ? 'Ante el gran Gengar' : 'Ante Arceus', G.U.mmss(r.judge.time) + ' · ' + r.judge.bosses + ' ' + T(r.judge.bosses === 1 ? 'legendario' : 'legendarios'), C.gold]);
      full.push([r.judge.gengar ? 'Daño a Gengar' : 'Daño a Arceus', (r.judge.dmg || 0).toLocaleString(), C.gold]);
    }
    full.push(['Pokémonedas ganadas', '+' + (+r.coins || 0).toLocaleString(), C.gold, 'coin', strip(r.breakdown || '')]);
    // Tickets y movimientos van con sus iconos, como en la web: listas de [icono, texto].
    if (r.candy) full.push(['Caramelos de Halloween', [['candy', '+' + r.candy]], C.gold]);
    if (r.t1 || r.t10) full.push(['Tickets del gacha', [r.t1 && ['ticket', '+' + r.t1], r.t10 && ['ticket10', '+' + r.t10 + ' ×10']].filter(Boolean), '#fff']);
    const mv = (r.moves || []).map(m => ['move:' + m.id, T(m.name, 'move') + ' ' + T('Nv.') + m.lvl + ' · ' + T(G.Stats.label(m))]);
    full.push(['Movimientos', mv.length ? mv : '—', '#fff', null, null, 11]);
    // Icono + texto, uno tras otro, con salto de línea si no cabe. Devuelve las líneas (draw false: sólo medir).
    const flow = (val, x0, y0, maxW, px, col, draw = true) => {
      const isz = Math.round(px * 1.1);
      let lx = x0, ly = y0, lines = 1;
      val.forEach(([ic, t], i) => {
        const label = t + (i < val.length - 1 && px < 14 ? ' ·' : '');
        font(px, true);
        const w = isz + 4 + ctx.measureText(label).width + (px < 14 ? 6 : 14);
        if (lx > x0 && lx + w > x0 + maxW) { lx = x0; ly += px + 6; lines++; }
        if (draw) { icon(ic, lx, ly + (px - isz) / 2, isz); text(label, lx + isz + 4, ly, px, col, 'left', true); }
        lx += w;
      });
      return lines;
    };
    const cellH = (f, rowH, cw) => f[4] ? rowH + 12 : f[5] ? Math.max(rowH + 10, 28 + (Array.isArray(f[1]) ? flow(f[1], 0, 0, cw - 16, f[5], '', false) : 2) * (f[5] + 6)) : rowH;
    // Derecha (como .over-sum de la web, sumHtml): una pestaña por jugador con sus ataques (daño y por segundo) y su
    // objeto; debajo los shinies conseguidos y, a veces, el aviso de Ko-fi (askSupport: tras un récord o cada 10).
    const nf = v => Math.round(v).toLocaleString();
    const team = (r.team || []).map(p => {
      const sm = p.sum;
      let total = 0;
      const rows = sm.mv.map(([id, lvl, dealt, since0, evo]) => {
        const m = G.Moves.instance(id, lvl);
        if (evo) G.Moves.evolve(m);
        if (m.cat) total += dealt;
        return { id, lvl, cat: T(G.Stats.label(m)), name: T(m.name, 'move'), dmg: m.cat ? nf(dealt) : '—', dps: m.cat ? nf(dealt / Math.max(5, sm.t - since0)) + '/s' : '—' };
      });
      return { tab: p.me ? T('Tú') : p.name, sh: sm.sh, line: G.I18n.f('{x} · Nv. {x} · {x} de daño en total', T((G.DEX_BY[sm.dex] || {}).name || ''), sm.lv, nf(total)),
        rows, item: sm.it && G.Items.BY[sm.it] ? sm.it : null };
    });
    const caught = r.caught || [];
    let tab = 0;
    const BW2 = team.length ? 736 : 360, LW = 340, rowH = 46;
    const leftH = () => 2 * (rowH + 6) + full.reduce((a, f) => a + cellH(f, rowH, LW) + 6, 0);
    const rightH = () => {
      if (!team.length) return 0;
      const t = team[tab];
      return 16 + (team.length > 1 ? 26 : 0) + 18 + 16 + t.rows.length * 20 + 34 + (caught.length ? 104 : 0);
    };
    open({ id: 'scr-over',
      key: now => (now - since > 1000) + '|' + tab,
      geo() {
        const h = 50 + Math.max(leftH(), rightH()) + (r.record ? 22 : 0) + 48;
        return { x: (W - BW2) / 2, y0: Math.max(6, (H - h) / 2), h };
      },
      draw(now) {
        const { x, y0, h } = this.geo();
        dim(); box(x, y0, BW2, h);
        text(T(r.dead ? 'Has caído…' : 'Run terminada'), W / 2, y0 + 16, 19.5, '#fff', 'center', true);
        let y = y0 + 50;
        const cell = (cx, cy, cw, ch, label, val, col = '#fff', ico, sub, px = 16.5) => {
          rr(cx, cy, cw, ch, 7); ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.fill();
          text(T(label).toUpperCase(), cx + 8, cy + 6, 9, C.muted);
          let vx = cx + 8;
          if (Array.isArray(val)) { flow(val, vx, cy + 19, cw - 16, px, col); if (sub) text(sub, cx + 8, cy + ch - 14, 8.5, C.muted); return; }
          if (ico) { icon(ico, vx, cy + 20, 16); vx += 20; }
          const lines = wrap(String(val), cw - 16 - (vx - cx - 8), px, true);
          lines.slice(0, 2).forEach((l, i) => text(l, vx, cy + 19 + i * (px + 2), px, col, 'left', true));
          if (sub) text(sub, cx + 8, cy + ch - 14, 8.5, C.muted);
        };
        const lx = x + 14;
        half.forEach(([l, v], i) => cell(lx + (i % 2) * ((LW - 6) / 2 + 6), y + Math.floor(i / 2) * (rowH + 6), (LW - 6) / 2, rowH, l, v));
        let ly = y + 2 * (rowH + 6);
        for (const [l, v, col, ico, sub, px] of full) {
          const ch = cellH([l, v, col, ico, sub, px], rowH, LW);
          cell(lx, ly, LW, ch, l, v, col, ico, sub, px || 16.5);
          ly += ch + 6;
        }
        let bottom = ly;
        if (team.length) {
          const rx = x + LW + 30, RW = BW2 - LW - 44, t = team[tab];
          let ry = y;
          rr(rx, ry, RW, rightH() - 6, 7); ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.fill();
          text(T('Resumen de la partida').toUpperCase(), rx + 8, ry + 6, 9, C.muted);
          ry += 22;
          if (team.length > 1) {
            let cx = rx + 8;
            team.forEach((p, i) => { const w = chip(cx, ry, p.tab, i === tab); hot(cx, ry, w, 20, false, () => { tab = i; }); cx += w + 4; });   // (ratón)
            padIcon('lr', cx + 12, ry + 10, 7);
            ry += 26;
          }
          let tx = rx + 8;
          if (t.sh) { icon('shiny', tx, ry, 12); tx += 16; }
          text(t.line, tx, ry, 10.5, C.muted);
          ry += 18;
          text(T('Daño'), rx + RW - 90, ry, 8.5, C.muted, 'right'); text(T('Por segundo'), rx + RW - 10, ry, 8.5, C.muted, 'right');
          ry += 14;
          for (const m of t.rows) {
            icon('move:' + m.id, rx + 8, ry - 1, 16);
            text(m.name, rx + 28, ry, 11, '#fff', 'left', true);
            font(11, true); text(T('Nv.') + m.lvl + ' · ' + m.cat, rx + 32 + ctx.measureText(m.name).width, ry + 2, 8.5, C.muted);
            text(m.dmg, rx + RW - 90, ry, 11, '#fff', 'right'); text(m.dps, rx + RW - 10, ry, 11, '#fff', 'right');
            ry += 20;
          }
          if (t.item) { icon(t.item, rx + 8, ry + 2, 14); text(T(G.Items.BY[t.item].name), rx + 26, ry + 3, 10, C.muted); }
          else text(T('Sin objeto.'), rx + 8, ry + 3, 10, C.muted);
          ry += 30;
          if (caught.length) {
            text(T('Shinies conseguidos'), rx + 26, ry + 4, 10, C.gold, 'left', true); icon('shiny', rx + 8, ry + 2, 12);
            this.caughtY = ry + 18; this.caughtX = rx + 8;
            caught.slice(0, 5).forEach((c, i) => {
              const nm = (G.DEX_BY[c.dex] || {}).name || '';
              text(nm + (c.isNew ? ' · ' + T('¡nuevo!') : ''), rx + 8 + i * 68 + 32, ry + 80, 8, C.muted, 'center');
            });
            ry += 104;
          }
          bottom = Math.max(bottom, ry);
        }
        y = bottom;
        if (r.record) { text(T('¡Nuevo récord de tiempo!'), W / 2, y + 2, 11, C.gold, 'center', true); y += 22; }
        const hs = team.length > 1 ? [['lr', 'Jugador']] : [];
        btn(W / 2 - 70, y + 6, 140, 30, T('Volver al menú'), 'gold', now - since > 1000, 12);
        if (now - since > 1000) hs.push(['x', 'Volver al menú']);
        if (hs.length) hints(hs);
      },
      live(now) {
        if (!caught.length || this.caughtY == null) return;
        caught.slice(0, 5).forEach((c, i) => monIn(c.dex, this.caughtX + i * 68, this.caughtY, 64, 60, 2, now, { shiny: true }));
      },
      input(ev, now) {
        const sh = ev.dx;
        if (sh && team.length > 1) { tab = (tab + sh + team.length) % team.length; G.Audio.sfx('select'); }
        if (now - since <= 1000) return;
        if (ev.a || ev.b) overBack();
      },
    });
    preIdle(caught.map(c => c.dex), true);
  }

  // ---------------- en la partida: los botones del mando junto al HUD ----------------
  // El HUD de la web pone las teclas (1-4 ataques, 5-8 esferas). Con mando: L1/R1 cambian de ataque
  // (gamepad.js), □ usa la esfera elegida (la dorada) y △ cambia de esfera. Misma geometría que hud.js.
  function hudHints() {
    const pl = G.Game.player;
    if (!pl || G.Game.state !== 'playing' || !G.Pad.name || globalThis.psKeys) return;   // (con teclado: las teclas de la web, en su HUD)
    if (ps.core_pads && ps.core_pads() > 1) return;   // cooperativo local: cada barra va a su esquina, sin la del J1 en el centro (core.js)
    const LW = psLogical.w, LH = psLogical.h, k = H / LH;   // el HUD dibuja en píxeles lógicos (browser.js), sin centrar
    const S = 54, GAP = 9, n = Math.max(1, pl.slots.length), totalW = n * S + (n - 1) * GAP;
    const sx = (LW - totalW) / 2, sy = LH - S - 18;
    ctx = screen;
    ctx.save(); ctx.setTransform(ps.H / H, 0, 0, ps.H / H, 0, 0);   // (sin OX: el HUD del juego, en píxeles lógicos; ps.H / H aunque K vaya por el ancho)
    // Por fuera del cuadro del objeto (a la izquierda, siempre) y del vínculo guardado (a la derecha, si hay).
    if (n > 1) {
      padIcon('l1', (sx - S - 18 - 22) * k, (sy + S / 2) * k);
      padIcon('r1', (sx + totalW + (pl.bonds > 0 ? 12 + 24 + (pl.bonds > 1 ? 22 : 0) + 22 : 24)) * k, (sy + S / 2) * k);
    }
    if ((pl.orbs || []).some(Boolean)) {
      const OS = 40, OG = 6, ow = G.Orbs.SLOTS * OS + (G.Orbs.SLOTS - 1) * OG, ox = sx + totalW / 2 - ow / 2, oy = sy - 30 - OS;
      const x = (ox + ow + 16) * k, y = (oy + OS / 2) * k;
      padIcon('s', x + 8, y - 9, 8); text(T('usar'), x + 20, y - 15, 11, C.text);
      padIcon('t', x + 8, y + 9, 8); text(T('cambiar'), x + 20, y + 3, 11, C.text);
    }
    ctx.restore();
    ctx = screen;
  }

  // ---------------- menús ----------------
  // Un Pokémon con su animación de reposo, de pie en (x, y) (el ancla de sus pies), a escala k.
  // dir: la fila de la hoja (0 de frente, 1 en diagonal hacia abajo a la derecha…), como Animator.dir.
  // skin (core/skins.js): la hoja con el disfraz pintado, con margen para el sombrero (padded() de sprites.js).
  // Mientras carga, sin él.
  function drawMon(dex, x, y, k, now, shiny = false, dir = 0, skin = '') {
    const m = G.SPRITE_META[dex], anim = m && m.a.Idle ? 'Idle' : 'Walk';
    let a = m && (m.a.Idle || m.a.Walk), sh = G.Sprites.sheet(dex, anim, shiny);
    const ks = skin && a && G.Skins.get(skin, dex) ? G.Sprites.sheet(dex, anim, shiny, skin) : null;
    if (ks && ks.ready) { const X = G.Skins.PAD_X, P = G.Skins.PAD_T; sh = ks; a = Object.assign({}, a, { w: a.w + 2 * X, h: a.h + P, ax: a.ax + X, ay: a.ay + P }); }
    if (!a || !sh || !sh.ready) return;
    let t = (now / 1000 * 60) % a.d.reduce((p, v) => p + v, 0), f = 0;   // d: duración de cada fotograma (1/60 s)
    while (f < a.n - 1 && t >= a.d[f]) { t -= a.d[f]; f++; }
    const am = dir ? G.Sprites.animMeta(dex, anim, shiny) : null, row = am ? Math.min(dir, am.r - 1) : 0;
    const sm = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;   // (pixel art: sin esto la web lo amplía con suavizado y sale borroso)
    ctx.drawImage(sh.img, f * a.w, row * a.h, a.w, a.h, Math.round(x - a.ax * k), Math.round(y - a.ay * k), a.w * k, a.h * k);
    ctx.imageSmoothingEnabled = sm;
  }
  // Como G.UI.spriteCanvas de la web (escala fija, sombra; si no cabe de pie, el cuerpo centrado) en un recuadro
  // que recorta. Las escalas de la web van a 0,75 aquí (×2 en la web = ×1,5).
  function monBox(dex, bx, by, bw, bh, k, now, shiny = false, dir = 0, skin = '') {
    const m = G.SPRITE_META[dex], a = m && (m.a.Idle || m.a.Walk);
    if (!a) return;
    const big = a.ay * k > bh * 0.8, fx = bx + bw / 2, fy = big ? by + bh / 2 + a.ay * k * 0.45 : by + bh * 0.88;
    ctx.save(); ctx.beginPath(); ctx.rect(bx, by, bw, bh); ctx.clip();
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.ellipse(fx, fy, 9 * k, 3.4 * k, 0, 0, 6.2832); ctx.fill();
    drawMon(dex, fx, fy, k, now, shiny, dir, skin);
    ctx.restore();
  }
  // Silueta (filter: brightness(0) en la web): el primer fotograma en negro, guardado por Pokémon.
  const sils = new Map();
  function silhouette(dex) {
    let c = sils.get(dex);
    if (c) return c;
    const m = G.SPRITE_META[dex], a = m && (m.a.Idle || m.a.Walk), sh = G.Sprites.sheet(dex, m && m.a.Idle ? 'Idle' : 'Walk', false);
    if (!a || !sh || !sh.ready) return null;
    if (sils.size > 300) sils.clear();   // ponytail: tope simple; la colección sólo enseña ~15 a la vez
    c = document.createElement('canvas'); c.width = a.w; c.height = a.h;
    const g = c.getContext('2d');
    g.drawImage(sh.img, 0, 0, a.w, a.h, 0, 0, a.w, a.h);
    g.globalCompositeOperation = 'source-in'; g.fillStyle = '#000'; g.fillRect(0, 0, a.w, a.h);
    c._a = a;
    sils.set(dex, c);
    return c;
  }
  // Un Pokémon en un recuadro de w x h, como G.UI.sprite: escala entera que quepa, de pie al 88 %, con sombra.
  function monIn(dex, x, y, w, h, scale, now, { shiny = false, sil = false, skin = '' } = {}) {
    const m = G.SPRITE_META[dex], a = m && (m.a.Idle || m.a.Walk);
    if (!a) return;
    const k = Math.max(1, Math.min(scale, Math.floor(h * 0.8 / a.ay)));
    const big = a.ay * k > h * 0.8, fx = x + w / 2, fy = big ? y + h / 2 + a.ay * k * 0.45 : y + h * 0.88;
    if (sil) {
      const c = silhouette(dex);
      if (!c) return;
      ctx.globalAlpha = 0.55; ctx.imageSmoothingEnabled = false;
      ctx.drawImage(c, Math.round(fx - a.ax * k), Math.round(fy - a.ay * k), a.w * k, a.h * k);
      ctx.globalAlpha = 1; ctx.imageSmoothingEnabled = true;
      return;
    }
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.ellipse(fx, fy, 9 * k * 0.75, 3.4 * k * 0.75, 0, 0, 6.2832); ctx.fill();
    drawMon(dex, fx, fy, k, now, shiny, 0, skin);
  }
  // Los menús sólo pintan la animación de reposo: precargar sólo ésa (G.Sprites.preload carga las 7 de cada uno).
  function preIdle(dexes, shiny = false) {
    for (const d of dexes) if (G.SPRITE_META[d]) G.Sprites.sheet(d, G.SPRITE_META[d].a.Idle ? 'Idle' : 'Walk', shiny);
  }

  // ---------------- miniaturas de todos los Pokémon ----------------
  // La colección enseña cientos: cargar la hoja de cada uno al pasar de región daba tirones. Al entrar por
  // primera vez se cargan todas una vez (pantalla de "Cargando") y se guarda su primer fotograma y su silueta
  // en una sola hoja; las hojas se sueltan. Luego la rejilla sólo copia de ahí.
  const thumbs = { cv: null, tmp: null, pos: new Map(), list: null, next: 0, loaded: 0, inflight: 0, done: false };
  function thumbsLayout() {
    if (thumbs.list) return;
    thumbs.list = G.DEX.filter(p => G.SPRITE_META[p.dex]).map(p => p.dex);
    let x = 0, y = 0, rowH = 0;
    for (const d of thumbs.list) {
      const m = G.SPRITE_META[d], a = m.a.Idle || m.a.Walk;
      if (x + a.w * 2 + 2 > 2048) { x = 0; y += rowH + 1; rowH = 0; }
      thumbs.pos.set(d, { x, y, a, ok: false });
      x += a.w * 2 + 2; rowH = Math.max(rowH, a.h);
    }
    thumbs.cv = document.createElement('canvas'); thumbs.cv.width = 2048; thumbs.cv.height = y + rowH + 1;
    thumbs.tmp = document.createElement('canvas'); thumbs.tmp.width = 512; thumbs.tmp.height = 512;
    // Ya hecho otra vez con esta versión del juego: se lee de una vez (~16 MB) en vez de 966 PNG.
    try {
      const j = JSON.parse(ps.readFile(TH_JSON) || 'null'), buf = j && j.key === thKey() && ps.readFile(TH_BIN, true);
      if (buf && buf.byteLength === 2048 * thumbs.cv.height * 4) {
        thumbs.cv.getContext('2d').putImageData({ width: 2048, height: thumbs.cv.height, data: new Uint8ClampedArray(buf) }, 0, 0);
        for (const d of j.ok) { const t = thumbs.pos.get(d); if (t) t.ok = true; }
        thumbs.next = thumbs.loaded = thumbs.list.length; thumbs.done = true;
        console.log('[ui] miniaturas: del disco');
      }
    } catch (e) { console.warn('[ui] miniaturas guardadas: ' + e.message); }
  }
  // Las miniaturas, guardadas en la carpeta del juego al acabar de hacerlas (los píxeles en crudo + qué salió bien).
  // Valen mientras no cambie la versión del juego (version.json) ni su tamaño.
  const TH_BIN = (ps.DATA || ps.ROOT) + '/thumbs.bin', TH_JSON = (ps.DATA || ps.ROOT) + '/thumbs.json';
  const thKey = () => (ps.readFile(ps.ROOT + '/game/version.json') || '').trim() + '|' + thumbs.list.length + '|' + thumbs.cv.height;
  function thumbsSave() {
    try {
      const img = thumbs.cv.getContext('2d').getImageData(0, 0, 2048, thumbs.cv.height);
      // (~16 MB: en otro hilo si se puede; la PS5 tardaba segundos en escribirlo y el menú se quedaba parado)
      const w = ps.writeFileLater || ps.writeFile;
      if (w(TH_BIN, img.data.buffer))
        w(TH_JSON, JSON.stringify({ key: thKey(), ok: thumbs.list.filter(d => thumbs.pos.get(d).ok) }));
    } catch (e) { console.warn('[ui] guardar miniaturas: ' + e.message); }
  }
  // Pone en marcha unas cuantas cargas a la vez (cada fotograma); el decodificado va en sus temporizadores.
  function thumbsPump(max = 6) {
    thumbsLayout();
    while (thumbs.inflight < max && thumbs.next < thumbs.list.length) {
      const d = thumbs.list[thumbs.next++], t = thumbs.pos.get(d), m = G.SPRITE_META[d], img = new Image();
      thumbs.inflight++;
      img.onload = () => {
        const g = thumbs.cv.getContext('2d'), a = t.a;
        g.drawImage(img, 0, 0, a.w, a.h, t.x, t.y, a.w, a.h);
        if (a.w <= 512 && a.h <= 512) {
          const tg = thumbs.tmp.getContext('2d');
          tg.globalCompositeOperation = 'source-over'; tg.clearRect(0, 0, 512, 512);
          tg.drawImage(img, 0, 0, a.w, a.h, 0, 0, a.w, a.h);
          tg.globalCompositeOperation = 'source-in'; tg.fillStyle = '#000'; tg.fillRect(0, 0, a.w, a.h);
          tg.globalCompositeOperation = 'source-over';
          g.drawImage(thumbs.tmp, 0, 0, a.w, a.h, t.x + a.w + 1, t.y, a.w, a.h);
        }
        t.ok = true; done();
      };
      img.onerror = done;
      img.src = 'assets/pokemon/' + d + '/' + (m.a.Idle ? 'Idle' : 'Walk') + '.png';
    }
    function done() { thumbs.inflight--; thumbs.loaded++; if (thumbs.loaded >= thumbs.list.length && !thumbs.done) { thumbs.done = true; thumbsSave(); } }
  }
  // Su miniatura (o silueta) en un recuadro, como monIn pero quieta y sin cargar nada.
  // Como la web (spriteCanvas: escala fija, recortado en su casilla): antes la escala cambiaba con el tamaño del Pokémon
  // y no se recortaba, así que unos salían enormes y otros diminutos. Las escalas de la web, a 0,75 (como monBox).
  // El recorte, en el rectángulo de origen (más barato que clip en cada miniatura).
  function thumbIn(dex, x, y, w, h, scale, sil) {
    const t = thumbs.pos.get(dex);
    if (!t || !t.ok) return;
    const a = t.a, k = scale * 0.75;
    const big = a.ay * k > h * 0.8, fx = x + w / 2, fy = big ? y + h / 2 + a.ay * k * 0.45 : y + h * 0.88;
    const dx = fx - a.ax * k, dy = fy - a.ay * k;
    const x0 = Math.max(x, dx), y0 = Math.max(y, dy), x1 = Math.min(x + w, dx + a.w * k), y1 = Math.min(y + h, dy + a.h * k);
    if (x1 <= x0 || y1 <= y0) return;
    if (sil) ctx.globalAlpha = 0.55;
    else if (!big) { ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.ellipse(fx, fy, 9 * k, 3.4 * k, 0, 0, 6.2832); ctx.fill(); }
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(thumbs.cv, t.x + (sil ? a.w + 1 : 0) + (x0 - dx) / k, t.y + (y0 - dy) / k, (x1 - x0) / k, (y1 - y0) / k,
                  Math.round(x0), Math.round(y0), Math.round(x1 - x0), Math.round(y1 - y0));
    ctx.globalAlpha = 1;
  }
  // "Cargando" con su barra mientras se hacen las miniaturas; luego sigue con then().
  function thumbsLoading(then) {
    if (thumbs.done) return then();
    thumbsLayout();
    open({
      key: () => String(Math.floor(thumbs.loaded / Math.max(1, thumbs.list.length) * 100)),
      draw() {
        const n = thumbs.list.length;
        const [x, y] = centerBox(380, 110, T('Pokémon'));
        text(T('Cargando…') + ' ' + thumbs.loaded + ' / ' + n, W / 2, y + 50, 11, C.muted, 'center');
        rr(x + 24, y + 76, 332, 8, 4); ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fill();
        rr(x + 24, y + 76, Math.max(8, 332 * thumbs.loaded / n), 8, 4); ctx.fillStyle = C.gold; ctx.fill();
        hints([['o', 'Volver']]);
      },
      input(ev) {
        thumbsPump();
        if (thumbs.done) { close(); then(); }
        else if (ev.b) { G.Audio.sfx('back'); close(); mainMenu(); }   // la carga sigue la próxima vez donde iba
      },
    });
  }
  const nameOf = dex => (G.DEX_BY[dex] || {}).name || '#' + dex;

  // ---------------- la primera vez: test de personalidad (como js/ui/test.js) ----------------
  // 8 preguntas (#scr-test) -> tu personalidad y tu compañero (#scr-result) -> o elegir otro inicial (#scr-starters).
  function personalityTest() {
    const Q = G.PERSONALITY_TEST, scores = {}, picks = [];   // picks: lo elegido en cada pregunta (○ la deshace)
    let idx = 0, sel = 0;
    const BW2 = 465;
    open({
      key: () => idx + '|' + sel,
      draw() {
        const q = Q[idx], qLines = wrap(T(q.q), BW2 - 40, 16.5), h = 92 + qLines.length * 22 + q.a.length * 42;
        const x = (W - BW2) / 2, y = (H - h) / 2;
        dim(); box(x, y, BW2, h);
        rr(x + 18, y + 18, BW2 - 36, 6, 4); ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fill();
        if (idx) { rr(x + 18, y + 18, (BW2 - 36) * idx / Q.length, 6, 4); ctx.fillStyle = C.gold; ctx.fill(); }
        text(G.I18n.f('Pregunta {x} de {x}', idx + 1, Q.length), x + 18, y + 36, 10, C.muted);
        qLines.forEach((l, i) => text(l, x + 18, y + 54 + i * 22, 16.5, '#fff'));
        let ay = y + 66 + qLines.length * 22;
        q.a.forEach((a, i) => {
          const on = i === sel;
          hot(x + 18, ay, BW2 - 36, 34, on, null, () => { sel = i; });   // (ratón: foco directo)
          rr(x + 18, ay, BW2 - 36, 34, 7); ctx.fillStyle = on ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.18)'; ctx.fill();
          ctx.strokeStyle = on ? C.edge : 'rgba(244,248,255,0.25)'; ctx.lineWidth = 1.5; ctx.stroke();
          if (on) icon('cursor', x + 24, ay + 9, 14);
          text(T(a.t), x + 44, ay + 11, 12.5, '#fff');
          ay += 42;
        });
        hints([['ud', 'Mover'], ['x', 'Elegir']]);
      },
      input(ev) {
        const q = Q[idx];
        if (ev.dy) { sel = (sel + ev.dy + q.a.length) % q.a.length; G.Audio.sfx('select'); }
        if (ev.a) {
          G.Audio.sfx('select');
          for (const k in q.a[sel].p) scores[k] = (scores[k] || 0) + q.a[sel].p[k];
          picks.push(sel); idx++; sel = 0;
          if (idx >= Q.length) { close(); testResult(G.personalityResult(scores), scores); }
        } else if (ev.b && picks.length) {   // ○: la pregunta de antes, con su respuesta elegida
          G.Audio.sfx('back');
          sel = picks.pop(); idx--;
          for (const k in Q[idx].a[sel].p) scores[k] -= Q[idx].a[sel].p[k];
        }
      },
    });
  }

  function chooseFirst(dex, result, scores) {
    const save = G.DB.save;
    save.starter = dex; save.partner = dex;
    save.personality = result ? { trait: result.trait, scores } : null;
    G.DB.grant(dex, 'starter');
    G.DB.commit();
    G.UI.toast(G.I18n.f('¡{x} se une a ti!', nameOf(dex)));
    mainMenu();
  }

  function testResult(result, scores) {
    const mon = G.DEX_BY[result.dex], BW2 = 420;
    let sel = 0;
    preIdle([mon.dex]);
    const trait = T(result.trait.charAt(0).toUpperCase() + result.trait.slice(1));
    const lines = () => wrap(T(G.TRAIT_TEXT[result.trait] || ''), BW2 - 40, 11);
    const geo = () => { const h = 150 + lines().length * 15 + 120 + 70; return [(W - BW2) / 2, (H - h) / 2, h]; };
    open({
      key: () => String(sel),
      draw() {
        const [x, y, h] = geo();
        dim(); box(x, y, BW2, h);
        text(T('Tu personalidad es…'), W / 2, y + 18, 11, C.muted, 'center');
        text(trait, W / 2, y + 38, 22.5, C.gold, 'center', true);
        let ty = y + 72;
        lines().forEach(l => { text(l, W / 2, ty, 11, '#fff', 'center'); ty += 15; });
        stage(W / 2 - 75, ty + 6, 150, 112, G.U.TYPE_COLOR[mon.types[0]]);
        ty += 130;
        const lbl = T('Tu compañero:') + ' ';
        font(13.5, true); const tw = ctx.measureText(lbl + mon.name).width;
        text(lbl, W / 2 - tw / 2, ty, 13.5, '#fff', 'left', true);
        text(mon.name, W / 2 - tw / 2 + ctx.measureText(lbl).width, ty, 13.5, C.gold, 'left', true);
        btn(W / 2 - 150, ty + 30, 145, 30, T('¡Vamos juntos!'), 'gold', sel === 0, 12, undefined, () => { sel = 0; });
        btn(W / 2 + 5, ty + 30, 145, 30, T('Elegir otro'), 'blue', sel === 1, 12, undefined, () => { sel = 1; });
        hints([['lr', 'Mover'], ['x', 'Elegir']]);
      },
      live(now) { const [, y] = geo(); monIn(mon.dex, W / 2 - 75, y + 78 + lines().length * 15, 150, 112, 3, now); },
      input(ev) {
        if (ev.dx) { sel = 1 - sel; G.Audio.sfx('select'); }
        if (ev.a) { G.Audio.sfx('confirm'); close(); if (sel === 0) chooseFirst(mon.dex, result, scores); else chooseStarter(result, scores); }
      },
    });
  }

  // #scr-starters: los iniciales de todas las regiones; ○ vuelve al resultado del test.
  function chooseStarter(result, scores) {
    const list = G.STARTERS, COLS = 8, CW = 86, CH = 92, ROWS = 4;
    let sel = Math.max(0, list.findIndex(s => result && s.dex === result.dex)), scroll = 0;
    const GX = BX + (BW - COLS * CW) / 2, GY = BY + 66;
    preIdle(list.slice(0, COLS * ROWS).map(s => s.dex));
    open({ wheel: true,
      key: () => sel + '|' + scroll,
      draw() {
        dim(); box(BX, BY, BW, BH);
        text(T('Elige a tu compañero'), BX + 18, BY + 16, 20, '#fff', 'left', true);
        text(T('Los iniciales de todas las regiones, y dos amigos más.'), BX + 18, BY + 42, 11, C.muted);
        for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
          const i = (scroll + r) * COLS + c;
          if (i >= list.length) continue;
          const x = GX + c * CW, y = GY + r * CH, on = i === sel;
          hot(x + 3, y + 3, CW - 6, CH - 6, on, null, () => { sel = i; });   // (ratón: foco directo)
          rr(x + 3, y + 3, CW - 6, CH - 6, 8);
          ctx.fillStyle = on ? 'rgba(255,210,63,0.14)' : 'rgba(0,0,0,0.2)'; ctx.fill();
          ctx.strokeStyle = on ? C.gold : 'rgba(244,248,255,0.18)'; ctx.lineWidth = 1.5; ctx.stroke();
          let nm = nameOf(list[i].dex); font(9.5, true); while (nm.length > 3 && ctx.measureText(nm).width > CW - 12) nm = nm.slice(0, -2) + '…';
          text(nm, x + CW / 2, y + CH - 20, 9.5, '#fff', 'center', true);
        }
        // Abajo: Volver, lo que es el elegido y Elegir (.row.between)
        const st = list[sel], mon = G.DEX_BY[st.dex], fy = BY + BH - 40;
        btn(BX + 18, fy, 70, 26, T('Volver'), 'ghost', false, 11);
        let ix = BX + 104 + typeChips(mon.types, BX + 104, fy + 6) + 8;
        icon('move:' + st.start, ix, fy + 4, 16); ix += 20;
        text(moveCat(st.start) + ' · ' + st.traits.map(t => T(t)).join(', '), ix, fy + 7, 10, C.muted);
        btn(BX + BW - 98, fy, 80, 26, T('Elegir'), 'gold', true, 12);
        hints([['lr', 'Mover'], ['x', 'Elegir'], ['o', 'Volver']]);
      },
      live(now) {
        for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
          const i = (scroll + r) * COLS + c;
          if (i < list.length) monIn(list[i].dex, GX + c * CW + 3, GY + r * CH + 4, CW - 6, CH - 30, 2, i === sel ? now : 0);
        }
      },
      input(ev) {
        if (ev.dx || ev.dy) {
          sel = Math.max(0, Math.min(list.length - 1, sel + ev.dx + ev.dy * COLS));
          const row = Math.floor(sel / COLS);
          if (row < scroll) scroll = row; else if (row >= scroll + ROWS) scroll = row - ROWS + 1;
          preIdle(list.slice(scroll * COLS, (scroll + ROWS) * COLS).map(s => s.dex));
          G.Audio.sfx('select');
        }
        if (ev.wheelRows) {   // (sólo la vista)
          scroll = clamp(scroll + ev.wheelRows, 0, Math.max(0, Math.ceil(list.length / COLS) - ROWS));
          preIdle(list.slice(scroll * COLS, (scroll + ROWS) * COLS).map(s => s.dex));
        }
        if (ev.a) { G.Audio.sfx('confirm'); close(); chooseFirst(list[sel].dex, result, scores); }
        else if (ev.b && result) { G.Audio.sfx('select'); close(); testResult(result, scores); }
      },
    });
  }

  // Elegir de una lista de movimientos (veto, inicial, atajos): items [{ id, label, icon, on, sub }].
  // onPick(id) devuelve true si hay que cerrar; si no, se redibuja (los que se marcan varios, como el veto).
  // Como el .ban-picker de la web: una caja con el título y los movimientos en chips (rejilla de 2); los
  // marcados (.chip.on) en dorado.
  function movePicker(title, sub, getItems, onPick, back) {
    let follow = true;   // (la vista va a lo elegido con teclas; la rueda la mueve sola)
    let sel = 0, top = 0, ver = 0;
    const BW2 = 600, X = (W - BW2) / 2, Y = 40, BH2 = H - 80, COLS = 2, RH = 34, CWd = (BW2 - 48 - 8) / 2;
    try { console.log('[elegir] ' + title + ': ' + getItems().length + ' opciones'); }   // (diagnóstico: Atajos no salía en Android)
    catch (e) { console.error('[elegir] ' + title + ': ' + e.message + '\n' + e.stack); }
    open({ wheel: true,
      key: () => sel + '|' + ver,
      draw() {
        dim(); box(X, Y, BW2, BH2);
        text(T(title), X + 18, Y + 16, 19.5, '#fff', 'left', true);
        btn(X + BW2 - 72, Y + 14, 56, 22, T('Volver'), 'ghost', false, 10);
        const subL = sub ? wrap(typeof sub === 'function' ? sub() : sub, BW2 - 40, 10.5).slice(0, 3) : [];
        subL.forEach((l, i) => text(l, X + 18, Y + 46 + i * 14, 10.5, C.muted));
        const items = getItems(), gy = Y + 54 + subL.length * 14, vis = Math.floor((Y + BH2 - 14 - gy) / RH);
        const row = Math.floor(sel / COLS);
        if (follow) { if (row < top) top = row; else if (row >= top + vis) top = row - vis + 1; follow = false; }
        top = clamp(top, 0, Math.max(0, Math.ceil(items.length / COLS) - vis));
        panel(X + 14, gy - 6, BW2 - 28, vis * RH + 8);
        for (let i = top * COLS; i < Math.min(items.length, (top + vis) * COLS); i++) {
          const it = items[i], on = i === sel, x = X + 24 + (i % COLS) * (CWd + 8), y = gy + (Math.floor(i / COLS) - top) * RH;
          hot(x, y, CWd, RH - 6, on, null, () => { sel = i; });   // (ratón: foco directo)
          rr(x, y, CWd, RH - 6, 14); ctx.fillStyle = on ? 'rgba(255,255,255,0.12)' : it.on ? 'rgba(255,210,63,0.12)' : 'rgba(0,0,0,0.25)'; ctx.fill();
          ctx.strokeStyle = on ? C.gold : it.on ? C.gold : 'rgba(244,248,255,0.25)'; ctx.lineWidth = on ? 2.5 : 1.5; ctx.stroke();
          let tx = x + 12;
          if (it.icon) { icon(it.icon, x + 8, y + 5, 18); tx = x + 32; }
          font(11, it.on); let lbl = it.label; while (lbl.length > 3 && ctx.measureText(lbl).width > CWd - (tx - x) - (it.sub ? 70 : 12)) lbl = lbl.slice(0, -2) + '…';
          text(lbl, tx, y + 8, 11, it.on ? C.gold : '#fff', 'left', it.on);
          if (it.sub) text(it.sub, x + CWd - 10, y + 9, 9, C.muted, 'right');
        }
        const rows = Math.ceil(items.length / COLS);
        if (rows > vis) {
          const hh = vis * RH - 6, bh = Math.max(16, hh * vis / rows);
          rr(X + BW2 - 12, gy, 4, hh, 2); ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fill();
          rr(X + BW2 - 12, gy + (hh - bh) * top / (rows - vis), 4, bh, 2); ctx.fillStyle = C.muted; ctx.fill();
        }
        hints([['lr', 'Mover'], ['x', 'Elegir'], ['o', 'Volver']]);
      },
      input(ev) {
        const items = getItems(), n = items.length;
        if ((ev.dx || ev.dy) && n) { sel = Math.max(0, Math.min(n - 1, sel + ev.dx + ev.dy * COLS)); follow = true; G.Audio.sfx('select'); }
        if (ev.wheelRows) { top += ev.wheelRows; ver++; }   // (sólo la vista)
        if (ev.a && items[sel]) {
          G.Audio.sfx('select');
          if (onPick(items[sel].id)) { close(); back(); } else ver++;
        } else if (ev.b) { G.Audio.sfx('select'); close(); back(); }
      },
    });
  }

  // ---------------- Mejoras (como js/ui/menu.js openUpgrades / renderUpgrades) ----------------
  let upgDex = null, upgPartner = null;
  const moveName = id => T(G.Moves.BY_ID[id].name, 'move');
  // Nombre con su categoría (Físico / Especial / Buff), para las listas de movimientos.
  const moveCat = id => moveName(id) + ' · ' + T(G.Stats.label(G.Moves.BY_ID[id]));
  const byName = (a, b) => G.Moves.BY_ID[a].name.localeCompare(G.Moves.BY_ID[b].name, 'es');

  function upgradesScreen(back = mainMenu) {
    const again = () => upgradesScreen(back);
    const s = G.DB.save;
    if (!upgDex || !s.owned[upgDex] || s.partner !== upgPartner) upgDex = s.partner;
    upgPartner = s.partner;
    const lvSum = d => Object.values(s.pupg && s.pupg[d] || {}).reduce((a, b) => a + b, 0);
    const mons = Object.keys(s.owned).map(Number).filter(d => G.DEX_BY[d])
      .sort((a, b) => (b === s.partner) - (a === s.partner) || lvSum(b) - lvSum(a) || a - b);
    const rows = G.Upgrades.LIST.map(u => u.id).concat(['bind']);
    let sel = 0, top = 0, ver = 0, follow = true;   // follow: la vista va a lo elegido (teclas); la rueda la mueve sola
    const banList = () => { s.pban = s.pban || {}; return s.pban[upgDex] || (s.pban[upgDex] = []); };

    const pickers = {
      ban(lvl) {
        movePicker('Veto', () => T('Los movimientos que no quieres que te salgan en las cartas') + ' (' + banList().length + '/' + lvl + ')',
          () => {
            const start = G.startMoveOf(upgDex), start2 = G.startMove2Of(upgDex), l = banList();
            return G.Moves.poolFor(G.DEX_BY[upgDex]).filter(id => id !== start && id !== start2).sort(byName)
              .map(id => ({ id, label: moveCat(id), icon: 'move:' + id, on: l.includes(id), sub: l.includes(id) ? T('vetado') : '' }));
          },
          id => {
            const l = banList(), i = l.indexOf(id);
            if (i >= 0) l.splice(i, 1);
            else if (l.length >= lvl) { G.UI.toast(G.I18n.f ? G.I18n.f('Ya tienes {x} vetados: quita uno primero', lvl) : 'Ya tienes ' + lvl + ' vetados'); return false; }
            else l.push(id);
            G.DB.commit();
            return false;
          }, again);
      },
      start() {
        const base = G.baseStartOf(upgDex);
        movePicker('Movimiento inicial', 'Elige con qué ataque empieza. Lo puedes cambiar cuando quieras, gratis.',
          () => G.startChoices(upgDex).sort(byName).map(id => ({ id, label: moveCat(id), icon: 'move:' + id, on: id === G.startMoveOf(upgDex), sub: id === base ? T('de serie') : '' })),
          id => {
            s.pstart = s.pstart || {};
            if (id === base) delete s.pstart[upgDex]; else s.pstart[upgDex] = id;
            if (s.pstart2 && s.pstart2[upgDex] === id) delete s.pstart2[upgDex];
            const l = banList(), i = l.indexOf(id);
            if (i >= 0) l.splice(i, 1);
            G.DB.commit();
            return true;
          }, again);
      },
      start2() {
        movePicker('Segundo movimiento inicial', 'Elige el segundo ataque con el que empieza. Lo puedes cambiar cuando quieras, gratis.',
          () => [{ id: '', label: T('Al azar'), on: !G.startMove2Of(upgDex) }].concat(G.startChoices(upgDex).filter(id => id !== G.startMoveOf(upgDex)).sort(byName)
            .map(id => ({ id, label: moveCat(id), icon: 'move:' + id, on: id === G.startMove2Of(upgDex) }))),
          id => {
            s.pstart2 = s.pstart2 || {};
            if (!id) delete s.pstart2[upgDex]; else s.pstart2[upgDex] = id;
            const l = banList(), i = id ? l.indexOf(id) : -1;
            if (i >= 0) l.splice(i, 1);
            G.DB.commit();
            return true;
          }, again);
      },
      bind() {   // Atajos: qué movimiento va siempre en cada hueco (L1/R1 en la partida los recorren en orden)
        s.pbind = s.pbind || {};
        console.log('[atajos] abrir: dex ' + upgDex + ' · guardado ' + JSON.stringify(s.pbind[upgDex] === undefined ? null : s.pbind[upgDex]));   // (diagnóstico)
        const ids = G.Moves.poolFor(G.DEX_BY[upgDex]).concat([G.startMoveOf(upgDex)]).filter((v, i, a) => a.indexOf(v) === i).sort(byName);
        const slots = () => { const l = (s.pbind[upgDex] || [null, null, null, null]).slice(0, 4); while (l.length < 4) l.push(null); return l; };
        movePicker('Atajos de movimientos', 'Qué movimiento va siempre en cada hueco, para la memoria muscular.',
          () => slots().map((id, i) => ({ id: String(i), label: T('Hueco') + ' ' + (i + 1) + ': ' + (id ? moveCat(id) : T('Libre')), icon: id ? 'move:' + id : null })),
          slot => {
            const i = +slot;
            movePicker(T('Hueco') + ' ' + (i + 1), null,
              () => [{ id: '', label: T('Libre'), on: !slots()[i] }].concat(ids.map(id => ({ id, label: moveCat(id), icon: 'move:' + id, on: slots()[i] === id }))),
              id => {
                const l = slots();
                for (let j = 0; j < 4; j++) if (id && l[j] === id) l[j] = null;
                l[i] = id || null;
                s.pbind[upgDex] = l;
                G.DB.commit();
                return true;
              }, pickers.bind);
            return false;
          }, again);
      },
    };

    function buy(u) {
      const lv = G.DB.upgradesOf(upgDex), now = lv[u.id] || 0;
      if (now >= u.max || (u.needs && !lv[u.needs])) return;
      const price = G.Upgrades.cost(u.id, now);
      if (s.coins < price) { G.Audio.sfx('error'); return; }
      s.coins -= price;
      lv[u.id] = now + 1;
      G.DB.commit(true);
      G.Audio.sfx('buy');
      ver++;
    }

    // Como #scr-upgrades: cabecera con el Pokémon y rejilla de 3 (.upg-item: icono, nombre, unidad, pips y precio).
    const COLS = 3, CW = UW, CH = 66, GX = BX + 18, GY = BY + 132, VIS = 4;   // (con 233 la 3ª columna se salía)
    open({ wheel: true,
      key: () => sel + '|' + upgDex + '|' + ver + '|' + s.coins,
      draw() {
        fixSel();
        modal('Mejoras');
        const mon = G.DEX_BY[upgDex], levels = G.DB.upgradesOf(upgDex);
        const shiny = upgDex === s.partner && !!s.partnerShiny && G.DB.ownsShiny(upgDex);
        stage(BX + 18, BY + 48, 90, 72, shiny ? '#9ae6ff' : G.U.TYPE_COLOR[mon.types[0]], shiny);
        text(T('Cada Pokémon tiene sus propias mejoras: sólo cuentan cuando juegas con él.'), BX + 122, BY + 56, 11, '#fff');
        text(T('Pokémon'), BX + 122, BY + 86, 10, C.muted);
        if (mons.length > 1) padIcon('l1', BX + 186, BY + 92);
        rr(BX + 204, BY + 80, 220, 24, 7); ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fill(); ctx.strokeStyle = 'rgba(244,248,255,0.3)'; ctx.lineWidth = 1.5; ctx.stroke();
        hot(BX + 204, BY + 80, 220, 24, false, 'x');   // (ratón: elegir en la Pokédex, como □)
        text(mon.name + (upgDex === s.partner ? ' (' + T('compañero') + ')' : ''), BX + 214, BY + 86, 11, '#fff', 'left', true);
        if (mons.length > 1) padIcon('r1', BX + 444, BY + 92);
        if (follow) { top = Math.max(0, Math.min(top, Math.floor(sel / COLS)), Math.floor(sel / COLS) - VIS + 1); follow = false; }
        top = clamp(top, 0, Math.max(0, Math.ceil(rows.length / COLS) - VIS));
        for (let i = top * COLS; i < Math.min(rows.length, (top + VIS) * COLS); i++) {
          const id = rows[i], x = GX + (i % COLS) * (CW + 8), y = GY + (Math.floor(i / COLS) - top) * (CH + 8), on = i === sel;
          hot(x, y, CW, CH, on, null, () => { sel = i; });   // (ratón: foco directo)
          panel(x, y, CW, CH);
          if (on) { rr(x, y, CW, CH, 8); ctx.strokeStyle = C.gold; ctx.lineWidth = 2; ctx.stroke(); }
          if (id === 'bind') {
            icon('cards', x + 10, y + CH / 2 - 12, 24);
            text(T('Atajos'), x + 44, y + 14, 12, '#fff', 'left', true);
            wrap(T('Qué movimiento va siempre en cada hueco'), CW - 120, 9).slice(0, 2).forEach((l, k) => text(l, x + 44, y + 31 + k * 12, 9, C.muted));
            btn(x + CW - 70, y + CH / 2 - 11, 60, 22, T('Elegir'), 'blue', false, 10);
            // Como «Elegir» de Movimiento inicial: un toque en la tarjeta la abre directamente (con acción, mouseNav no da
            // pasos de cruceta: en el móvil se veía el foco subir y bajar solo hasta llegar aquí).
            hot(x, y, CW, CH, on, () => { sel = i; close(); pickers.bind(); });
            continue;
          }
          const u = G.Upgrades.BY[id], lvl = levels[u.id] || 0, maxed = lvl >= u.max, locked = !maxed && u.needs && !levels[u.needs];
          const cost = maxed ? 0 : G.Upgrades.cost(u.id, lvl), canBuy = !maxed && !locked && s.coins >= cost;
          const choose = pickers[id] && lvl > 0;   // movimiento inicial, segundo o veto ya comprados: «Elegir», como la web
          icon(u.icon, x + 10, y + CH / 2 - 12, 24);
          const bw = 64, tw = CW - 44 - bw - 16 - (choose ? 58 : 0);
          let ty = y + 10;
          text(T(u.name), x + 44, ty, 11, '#fff', 'left', true);
          wrap(T(u.unit), tw, 9).slice(0, 2).forEach(l => { ty += 13; text(l, x + 44, ty, 9, C.muted); });
          const pw = Math.min(10, (tw - 2) / u.max - 2);
          for (let k = 0; k < u.max; k++) { rr(x + 44 + k * (pw + 2), y + CH - 12, pw, 4, 1); ctx.fillStyle = k < lvl ? C.gold : 'rgba(0,0,0,0.35)'; ctx.fill(); }
          if (maxed) btn(x + CW - bw - 10, y + CH / 2 - 13, bw, 26, T('Máx.'), 'blue', false, 10);
          else if (locked) btn(x + CW - bw - 10, y + CH / 2 - 13, bw, 26, T('Bloqueado'), 'off', false, 9);
          else btn(x + CW - bw - 10, y + CH / 2 - 13, bw, 26, String(cost), canBuy ? 'gold' : 'off', false, 11, 'coin');
          if (choose) {   // (clic: abrir la elección; con el mando, △, o ✕ si ya está al máximo)
            btn(x + CW - bw - 66, y + CH / 2 - 11, 52, 22, T('Elegir'), 'blue', false, 10);
            hot(x + CW - bw - 66, y + CH / 2 - 11, 52, 22, false, () => { sel = i; close(); pickers[id](lvl); });
          }
        }
        const rowsN = Math.ceil(rows.length / COLS);
        if (rowsN > VIS) {
          const hh = VIS * (CH + 8) - 8, bh = hh * VIS / rowsN;
          rr(BX + BW - 12, GY, 4, hh, 2); ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fill();
          rr(BX + BW - 12, GY + (hh - bh) * top / (rowsN - VIS), 4, bh, 2); ctx.fillStyle = C.muted; ctx.fill();
        }
        const cur = rows[sel], lvl = cur !== 'bind' ? (levels[cur] || 0) : 1, full = cur !== 'bind' && lvl >= G.Upgrades.BY[cur].max;
        const pick = pickers[cur] && cur !== 'bind' && lvl > 0;
        const h = [['lr', 'Mover'], ['x', cur === 'bind' ? 'Elegir' : pick && full ? 'Elegir movimientos' : 'Comprar']];
        if (pick && !full) h.push(['t', 'Elegir movimientos']);
        h.push(['s', 'Cambiar Pokémon'], ['o', 'Volver']);
        hints(h);
      },
      live(now) {
        const shiny = upgDex === s.partner && !!s.partnerShiny && G.DB.ownsShiny(upgDex);
        monIn(upgDex, BX + 18, BY + 48, 90, 72, 2, now, { shiny });
      },
      input(ev) {
        fixSel(ev);
        const p = psPadRaw().buttons, b4 = p[4] && !prevL1, b5 = p[5] && !prevR1;
        prevL1 = p[4]; prevR1 = p[5];
        if ((b4 || b5) && mons.length > 1) {
          upgDex = mons[(mons.indexOf(upgDex) + (b5 ? 1 : -1) + mons.length) % mons.length];
          preIdle([upgDex]);
          G.Audio.sfx('select'); ver++;
        }
        if (ev.dx || ev.dy) { sel = Math.max(0, Math.min(rows.length - 1, sel + (ev.dx | 0) + (ev.dy | 0) * COLS)); follow = true; G.Audio.sfx('select'); }
        if (ev.wheelRows) { top += ev.wheelRows | 0; ver++; }   // (sólo la vista: el dibujo la acota)
        const cur = rows[sel], lvl = (G.DB.upgradesOf(upgDex)[cur] || 0);
        const full = cur !== 'bind' && lvl >= G.Upgrades.BY[cur].max;   // (al máximo: ✕ ya no compra, elige)
        if (ev.a) { if (cur === 'bind') { close(); pickers.bind(); } else if (full && pickers[cur]) { close(); pickers[cur](lvl); } else buy(G.Upgrades.BY[cur]); }
        else if (ev.y && lvl > 0 && pickers[cur]) { close(); pickers[cur](lvl); }
        else if (ev.x) { G.Audio.sfx('select'); close(); dexScreen(upgDex, d => { if (d) upgDex = d; again(); }); }   // □: elegir en la Pokédex
        else if (ev.b) { G.Audio.sfx('select'); close(); back(); }
      },
    });
    let prevL1 = true, prevR1 = true;   // lo que estuviera pulsado al abrir no cuenta
    // En Android, sel acabó fuera de la lista (NaN o más allá) y cada fotograma fallaba en G.Upgrades.BY[cur].max: no se
    // podía abrir nada (Atajos). Se corrige y se dice una vez, con el evento, para encontrar de dónde viene.
    function fixSel(ev) {
      if (sel >= 0 && sel < rows.length && Number.isInteger(sel) && Number.isFinite(top)) return;
      if (!fixSel.said) { fixSel.said = 1; console.error('[mejoras] elegida fuera: sel ' + sel + ' · top ' + top + ' · ' + JSON.stringify(ev || {})); }
      sel = 0; top = 0; follow = true; ver++;
    }
    preIdle([upgDex]);
  }

  // ---------------- Gacha (la lógica es G.Gacha, js/systems/gacha.js) ----------------
  let gachaGen = 1;
  function star(cx, cy, r, color) {
    ctx.beginPath();
    for (let k = 0; k < 10; k++) {
      const a = -Math.PI / 2 + k * Math.PI / 5, rr = k % 2 ? r * 0.45 : r;
      k ? ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr) : ctx.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    }
    ctx.closePath(); ctx.fillStyle = color; ctx.fill();
  }
  function stars(n, cx, cy, r, color) { for (let k = 0; k < n; k++) star(cx + (k - (n - 1) / 2) * r * 2.1, cy, r, color); }

  // Resplandor (box-shadow: 0 0 Npx color): anillos que se apagan hacia fuera.
  function glow(x, y, w, h, r, color, size = 10) {
    ctx.strokeStyle = color;
    for (let k = 1; k <= 4; k++) { ctx.globalAlpha = 0.28 / k; ctx.lineWidth = size / 2; rr(x - k * size / 4, y - k * size / 4, w + k * size / 2, h + k * size / 2, r + k * size / 4); ctx.stroke(); }
    ctx.globalAlpha = 1;
  }

  // Como #scr-gacha: pestañas de región, el banner con sus tres destacados, las cuatro tiradas y las probabilidades.
  function gachaScreen() {
    const s = G.DB.save;
    const PULLS = [[10, 't1', 'ticket', 10], [10, 't10', 'ticket10', 1], [100, 't1', 'ticket', 100], [100, 't10', 'ticket10', 10]];
    const sh = shoulders();
    let sel = 0, ver = 0;
    const L = BX + 18, LW = 450, R = BX + 482, RW = BW - 500, BNY = BY + 96, BNH = 210;
    // Halloween: la pestaña del banner Noche Espectral (gen 10) va la primera, y esos días se abre en ella.
    const tabs = () => (G.Gacha.isOpen(G.Gacha.SPOOKY.gen) ? [G.Gacha.SPOOKY] : []).concat(G.Gacha.BANNERS);
    if (G.Gacha.isOpen(G.Gacha.SPOOKY.gen) && !gachaScreen.seen) { gachaScreen.seen = 1; gachaGen = G.Gacha.SPOOKY.gen; }
    if (!G.Gacha.isOpen(gachaGen)) gachaGen = 1;
    preIdle(G.Gacha.featured(gachaGen));
    open({
      key: () => sel + '|' + gachaGen + '|' + ver + '|' + s.tickets.t1 + '|' + s.tickets.t10 + '|' + G.Halloween.on,
      draw() {
        modal('Gacha');
        // Pestañas (.gen-tab): región y "Gen N"
        let tx = L;
        padIcon('l1', tx + 10, BY + 62); tx += 26;
        tabs().forEach((b, bi, all) => {
          const on = b.gen === gachaGen, w = b.event ? 84 : 54;
          tabHot(tx, BY + 46, w, 32, bi - all.findIndex(t => t.gen === gachaGen));   // (ratón)
          rr(tx, BY + 46, w, 32, 7); ctx.fillStyle = on ? 'rgba(255,210,63,0.15)' : b.event ? 'rgba(61,34,102,0.7)' : 'rgba(0,0,0,0.25)'; ctx.fill();
          ctx.strokeStyle = on ? C.gold : b.event ? '#ff8a2a' : 'rgba(244,248,255,0.22)'; ctx.lineWidth = 1.5; ctx.stroke();
          text(T(b.name), tx + w / 2, BY + 51, 10, on ? C.gold : '#fff', 'center', true);
          if (b.event) { font(8); const hw = ctx.measureText(T('Halloween')).width + 12; icon('pumpkin', tx + w / 2 - hw / 2, BY + 63, 9); text(T('Halloween'), tx + w / 2 - hw / 2 + 12, BY + 64, 8, C.muted); }
          else text('Gen ' + b.gen, tx + w / 2, BY + 64, 8, C.muted, 'center');
          tx += w + 4;
        });
        padIcon('r1', tx + 10, BY + 62);
        // El banner (.banner)
        const b = G.Gacha.banner(gachaGen), spooky = !!b.event, all = G.DEX.filter(p => (spooky ? p.types.includes('ghost') : p.gen === gachaGen));
        ctx.save();
        rr(L, BNY, LW, BNH, 9); ctx.clip();
        const g = ctx.createLinearGradient(L, BNY, L + LW, BNY + BNH);
        g.addColorStop(0, b.color[0]); g.addColorStop(0.55, b.color[1]); g.addColorStop(1, b.color[2]);
        ctx.fillStyle = g; ctx.fillRect(L, BNY, LW, BNH);
        for (const [cx, cy, rad, col] of [[0.8, 0.3, 0.45, '255,210,63'], [0.15, 0.8, 0.5, '196,123,255']]) {
          const rg = ctx.createRadialGradient(L + LW * cx, BNY + BNH * cy, 0, L + LW * cx, BNY + BNH * cy, LW * rad);
          rg.addColorStop(0, 'rgba(' + col + ',0.3)'); rg.addColorStop(1, 'rgba(' + col + ',0)');
          ctx.fillStyle = rg; ctx.fillRect(L, BNY, LW, BNH);
        }
        ctx.restore();
        rr(L, BNY, LW, BNH, 9); ctx.strokeStyle = 'rgba(244,248,255,0.4)'; ctx.lineWidth = 1.5; ctx.stroke();
        text(spooky ? T(b.name) : T(b.name) + ' ' + T('Misterioso'), L + 14, BNY + 12, 21, C.gold, 'left', true, '#2a0f55');
        if (spooky) wrap(G.I18n.f('Los {x} Pokémon de tipo Fantasma de todas las regiones, con el doble de shiny. Sólo hasta el 2 de noviembre.', all.length), LW - 28, 10.5).slice(0, 2)
          .forEach((l, i) => text(l, L + 14, BNY + 38 + i * 13, 10.5, '#fff'));
        else text(G.I18n.f('Los {x} Pokémon de la generación {x}. ¡Los legendarios esperan!', all.length, gachaGen), L + 14, BNY + 42, 10.5, '#fff');
        const owned = all.filter(p => s.owned[p.dex]).length, shn = all.filter(p => s.shiny && s.shiny[p.dex]).length;
        let ox = L + 14;
        const py = spooky ? 68 : 60;   // (la descripción del de Halloween ocupa dos líneas)
        const piece = (t, ico) => { if (ico) { icon(ico, ox, BNY + py - 1, 10); ox += 13; } text(t, ox, BNY + py, 10, C.muted); font(10); ox += ctx.measureText(t).width + 4; };
        piece(G.I18n.f('Tienes {x} de {x}', owned, all.length));
        if (shn) { piece('·'); piece(shn + ' shiny', 'shiny'); }
        if (G.Gacha.hasIris(s, gachaGen)) { piece('·'); piece(T('Amuleto Iris'), 'iris'); }
        // Las cuatro tiradas (.btn.gold; sin tickets, apagadas)
        const PY = BNY + BNH + 10, PW = (LW - 24) / 4;
        PULLS.forEach(([n, use, ic, cost], i) => {
          const x = L + i * (PW + 8), ok = !!G.Gacha.costOf(s, n, use);
          btn(x, PY, PW, 40, null, ok ? 'gold' : 'off', i === sel, undefined, undefined, () => { sel = i; });
          hot(x, PY, PW, 40, i === sel, null, () => { sel = i; });   // (ratón: foco directo)
          const col = ok ? '#3a2300' : '#e6e6e6', sc = ok ? 'rgba(255,255,255,0.4)' : C.navy;
          text(T('Tirar') + ' ×' + n + ' ·', x + PW / 2, PY + 7, 10, col, 'center', true, sc);
          font(10, true); const cw = ctx.measureText(String(cost)).width + 16;
          icon(ic, x + PW / 2 - cw / 2, PY + 21, 13);
          text(String(cost), x + PW / 2 - cw / 2 + 16, PY + 23, 10, col, 'left', true, sc);
        });
        const t = s.tickets;
        spans([[T('Tienes') + ' ', C.muted]], L, PY + 54, 9.5);
        font(9.5); let kx = L + ctx.measureText(T('Tienes') + ' ').width;
        icon('ticket', kx, PY + 52, 12); kx += 14;
        spans([[String(t.t1), '#fff', true], [' ' + T('tickets y') + ' ', C.muted]], kx, PY + 54, 9.5);
        font(9.5); kx += ctx.measureText(String(t.t1) + ' ' + T('tickets y') + ' ').width + 2;
        icon('ticket10', kx, PY + 52, 12); kx += 14;
        spans([[String(t.t10), '#fff', true], [' ' + T('tickets ×10'), C.muted]], kx, PY + 54, 9.5);
        const pity = (s.pity && s.pity[gachaGen]) || 0;
        text(G.I18n.f('Tiradas sin legendaria en {x}: {x} / {x}', T(b.name), pity, G.Gacha.PITY_5), L, PY + 72, 9.5, C.muted);
        // Probabilidades (.panel.rates)
        panel(R, BNY, RW, BH - (BNY - BY) - 12);
        text(T('Probabilidades'), R + 12, BNY + 10, 13.5, '#fff', 'left', true);
        let ry = BNY + 34;
        const rateRow = (ico, label, col, right) => {
          icon(ico, R + 12, ry, 10); text(label, R + 26, ry, 10, col); text(right, R + RW - 12, ry, 10, '#fff', 'right');
          ctx.strokeStyle = 'rgba(244,248,255,0.15)'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
          ctx.beginPath(); ctx.moveTo(R + 12, ry + 15); ctx.lineTo(R + RW - 12, ry + 15); ctx.stroke(); ctx.setLineDash([]);
          ry += 19;
        };
        G.Gacha.RATES.slice().reverse().forEach(([r, w]) => rateRow(G.Icons.RARITY_BALL[r], T(G.Gacha.RARITY_NAME[r]), G.Gacha.RARITY_COLOR[r], w + '% · ' + G.Gacha.pool(r, gachaGen).length));
        rateRow('shiny', 'Shiny', '#fff', spooky || G.Gacha.hasIris(s, gachaGen) ? '2%' : '1%');
        ry += 6;
        for (const note of ['· La tirada ×10 garantiza al menos una Épica.', G.I18n.f('· A las {x} tiradas sin Legendaria en un banner, la siguiente lo es.', G.Gacha.PITY_5),
                            '· Los repetidos dan Pokémonedas. Los shiny no se repiten.',
                            '· Los tickets se consiguen jugando: algunos Pokémon los sueltan al caer, y los jefes y los legendarios de las grietas, a veces, tickets ×10.'])
          for (const l of wrap(T(note), RW - 24, 9)) { if (ry < BY + BH - 22) text(l, R + 12, ry, 9, C.muted); ry += 12; }
        hints([['lr', 'Mover'], ['x', 'Tirar'], ['o', 'Volver']]);
      },
      live(now) {
        // #gacha-feat: spriteCanvas(dex, 170, 190, { scale: 2, dir: 1 }) a 0,75, en diagonal como en la web.
        G.Gacha.featured(gachaGen).forEach((dex, i) => monBox(dex, L + 25 + i * 135, BNY + 70, 128, 142, 1.5, now, false, 1));
      },
      input(ev) {
        const gg = sh();
        if (gg) { const tb = tabs(), i = tb.findIndex(b => b.gen === gachaGen); gachaGen = tb[(i + gg + tb.length) % tb.length].gen; preIdle(G.Gacha.featured(gachaGen)); G.Audio.sfx('select'); ver++; }
        if (ev.dx) { sel = (sel + ev.dx + PULLS.length) % PULLS.length; G.Audio.sfx('select'); }
        if (ev.a) {
          const [n, use] = PULLS[sel];
          if (!G.Gacha.isOpen(gachaGen)) { G.UI.toast(T('El banner de Halloween ya ha terminado.')); gachaGen = 1; ver++; return; }
          const res = G.Gacha.pull(s, n, gachaGen, use);
          if (!res) { G.Audio.sfx('error'); G.UI.toast(T('No tienes tickets suficientes: consíguelos jugando')); return; }
          G.Progress.checkAch();
          G.DB.commit(true);
          close();
          pullResults(res, n);
        } else if (ev.b) { G.Audio.sfx('back'); close(); mainMenu(); }
      },
    });
  }

  // La tirada (#pull-fx de la web): la tragaperras PokéSlots (G.Slots, js/ui/slots.js, en su lienzo) y luego
  // las cartas (.pcard) una a una. ✕ / ○ lo acelera todo; en la ×100, de 10 en 10.
  let slotCv = null;
  function pullResults(res, n) {
    const rank = r => (r.shiny ? 100 : 0) + r.rarity * 10 + (r.isNew ? 1 : 0);
    const spins = n === 100 ? Array.from({ length: 10 }, (_, k) => res.slice(k * 10, k * 10 + 10).reduce((a, b) => (rank(b) > rank(a) ? b : a))) : res;
    const cards = n === 100 ? res.slice().sort((a, b) => rank(b) - rank(a)) : res;
    const best = Math.max(...res.map(r => r.rarity)), PER = 10, STEP = n === 100 ? 30 : 150;
    if (!slotCv) { slotCv = document.createElement('canvas'); slotCv.width = 176; slotCv.height = 170; }
    let phase = 'slot', t0 = 0, shown = 0, page = 0, lastShown = 0, bsel = 0;
    preIdle(cards.slice(0, PER).map(r => r.dex));
    G.Slots.play(slotCv, spins, n).then(() => {
      G.Audio.sfx('burst', { rarity: best });
      phase = 'cards'; t0 = ps.now();
    });
    const CW = 108, CH = 168, GAP = 12, X0 = (W - (5 * CW + 4 * GAP)) / 2, Y0 = n === 100 ? 64 : 52;
    const cardAt = i => [X0 + (i % 5) * (CW + GAP), Y0 + Math.floor(i / 5) * (CH + GAP)];
    const pageCards = () => cards.slice(page * PER, page * PER + PER);
    open({
      key: now => {
        if (phase === 'slot') return 'slot';
        shown = Math.min(pageCards().length, Math.floor((now - t0) / STEP) + 1);
        if (shown > lastShown) { const r = pageCards()[shown - 1]; if (r && (n < 100 || r.rarity >= 4 || r.shiny)) G.Audio.sfx('reveal', { rarity: r.rarity }); lastShown = shown; }
        return page + '|' + shown + '|' + bsel;
      },
      draw() {
        const g = ctx.createRadialGradient(W / 2, H * 0.45, 0, W / 2, H * 0.45, W * 0.55);
        g.addColorStop(0, '#1b2d63'); g.addColorStop(1, '#03060f');
        ctx.fillStyle = g; ctx.fillRect(-OX, -OY, W + 2 * OX, H + 2 * OY);
        if (phase === 'slot') { btn(W / 2 - 27, 420, 54, 24, T('Saltar'), 'ghost', false, 10); return; }
        if (n === 100) {
          const news = res.filter(r => r.isNew).length, shn = res.filter(r => r.shiny).length, coins = res.reduce((a, r) => a + r.refund, 0);
          text(G.I18n.f('Nuevos: {x}', news) + ' · ' + G.I18n.f('Shiny: {x}', shn) + ' · +' + coins.toLocaleString(), W / 2, 22, 13, C.gold, 'center', true);
          text((page + 1) + ' / ' + Math.ceil(cards.length / PER), W - 30, 24, 10, C.muted, 'right');
        }
        pageCards().forEach((r, i) => {
          if (i >= shown) return;
          const [x, y] = cardAt(i), col = r.shiny ? '#9ae6ff' : G.Gacha.RARITY_COLOR[r.rarity];
          glow(x, y, CW, CH, 9, col, r.rarity === 5 ? 22 : 14);
          rr(x, y, CW, CH, 9); ctx.fillStyle = vgrad(y, CH, '#2a3352', '#0e1220'); ctx.fill();
          ctx.strokeStyle = col; ctx.lineWidth = 2.5; ctx.stroke();
          icon(G.Icons.RARITY_BALL[r.rarity] || 'ball', x + CW / 2 - 7, y + 9, 14);
          const mon = G.DEX_BY[r.dex];
          text(mon.name, x + CW / 2 + (r.shiny ? 6 : 0), y + 104, 11, '#fff', 'center', true);
          if (r.shiny) { font(11, true); icon('shiny', x + CW / 2 - ctx.measureText(mon.name).width / 2 - 8, y + 104, 10); }
          let ty = y + 120;
          const ab = r.isNew ? G.Mons.abilityOf(r.dex) : null;
          if (ab) {
            const nat = G.Mons.name(G.Mons.natureOf(r.dex).n) + ' · ', an = G.Mons.abilityName(ab.id);
            font(8); const w2 = ctx.measureText(nat + an).width;
            text(nat, x + CW / 2 - w2 / 2, ty, 8, C.muted); text(an, x + CW / 2 - w2 / 2 + ctx.measureText(nat).width, ty, 8, ab.slot === 2 ? C.gold : C.muted);
            ty += 13;
          }
          if (r.isNew) text(r.shiny ? T('¡SHINY NUEVO!') : T('¡NUEVO!'), x + CW / 2, ty, 9, C.gold, 'center', true);
          else {
            const t1 = T('Repetido') + ' · ', t2 = '+' + r.refund;
            font(9); const w2 = ctx.measureText(t1 + t2).width + 13, x2 = x + CW / 2 - w2 / 2;
            text(t1, x2, ty, 9, '#fff'); font(9); const ix = x2 + ctx.measureText(t1).width;
            icon('coin', ix, ty - 1, 11); text(t2, ix + 13, ty, 9, '#fff');
          }
        });
        if (res.iris && page === Math.ceil(cards.length / PER) - 1 && shown >= pageCards().length) {
          const name = T(G.Gacha.BANNERS[res.iris - 1].name);
          rr(X0, 410, 5 * CW + 4 * GAP, 30, 9); ctx.fillStyle = 'rgba(255,210,63,0.12)'; ctx.fill(); ctx.strokeStyle = C.gold; ctx.lineWidth = 1.5; ctx.stroke();
          icon('iris', X0 + 10, 414, 22);
          text(G.I18n.f('¡Amuleto Iris de {x}!', name), X0 + 40, 421, 12, C.gold, 'left', true);
        }
        const done = shown >= pageCards().length, more = (page + 1) * PER < cards.length;
        if (done && more) {   // ×100: «Siguientes» y, al lado, «Saltar» (sale de los resultados)
          btn(W / 2 - 112, H - 58, 104, 28, T('Siguientes'), 'gold', bsel === 0, 11, undefined, () => { bsel = 0; });
          btn(W / 2 + 8, H - 58, 104, 28, T('Saltar'), 'ghost', bsel === 1, 11, undefined, () => { bsel = 1; });
          if (bsel === 1) { rr(W / 2 + 5, H - 61, 110, 34, 10); ctx.strokeStyle = C.gold; ctx.lineWidth = 2; ctx.stroke(); }
          hints([['lr', 'Mover'], ['x', 'Elegir'], ['o', 'Saltar']]);
        } else if (done) btn(W / 2 - 50, H - 58, 100, 28, T('Continuar'), 'gold', true, 11);
        else btn(W / 2 - 27, H - 56, 54, 24, T('Saltar'), 'ghost', false, 10);
      },
      live(now) {
        if (phase === 'slot') {   // 176x170 a 1,7: como #slot en la web (min(528px, 66vh))
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(slotCv, 0, 0, 176, 170, W / 2 - 150, 60, 300, 290);
          return;
        }
        // Como la .pcard de la web (spriteCanvas 132x120 a escala 2, a 0,75; en la de ×100 se ve a 88 px): escala fija
        // para todos, y si no cabe de pie, el cuerpo centrado y recortado en su recuadro.
        const k = n === 100 ? 1 : 1.5;
        pageCards().forEach((r, i) => {
          if (i >= shown) return;
          const [x, y] = cardAt(i);
          monBox(r.dex, x + 4, y + 22, CW - 8, 80, k, r.rarity >= 4 || r.shiny ? now : 0, r.shiny);
        });
      },
      input(ev, now) {
        const more = (page + 1) * PER < cards.length;
        if (ev.dx && phase !== 'slot' && shown >= pageCards().length && more) { bsel = 1 - bsel; G.Audio.sfx('select'); return; }
        if (!(ev.a || ev.b)) return;
        if (phase === 'slot') { G.Slots.skip(); return; }
        if (shown < pageCards().length) { t0 = now - STEP * PER; lastShown = PER; return; }   // saltar
        if (more && ev.a && bsel === 0) { page++; t0 = now; lastShown = 0; preIdle(pageCards().map(r => r.dex)); return; }
        close(); gachaScreen();   // «Continuar» al final, o «Saltar» (✕ en él, u ○): fuera de los resultados
      },
    });
  }

  // L1 / R1 de una pantalla (pulsación, no mantener). Cada pantalla tiene el suyo.
  // shoulderQ: el salto pedido por un clic en una pestaña (o en el icono L1/R1), entero y de una vez: directo a la pestaña,
  // sin pasar por las de en medio (antes, un paso por fotograma: se veían pasar las regiones).
  let shoulderQ = 0;
  const tabHot = (x, y, w, h, delta) => hot(x, y, w, h, false, delta ? () => { shoulderQ = delta; } : null);
  function shoulders() {
    let p4 = true, p5 = true;
    return () => {
      const b = psPadRaw().buttons, l = b[4] && !p4, r = b[5] && !p5; p4 = b[4]; p5 = b[5];
      if (!l && !r && shoulderQ) { const d = shoulderQ; shoulderQ = 0; return d; }
      return l ? -1 : r ? 1 : 0;
    };
  }

  // ---------------- Colección (como js/ui/menu.js openDex / showDetail) ----------------
  const GEN_NAMES = ['Kanto', 'Johto', 'Hoenn', 'Sinnoh', 'Teselia', 'Kalos', 'Alola', 'Galar', 'Paldea'];
  const STAT = { pa: 'Ataque', sa: 'At. Esp.', df: 'Defensa', sd: 'Def. Esp.', spd: 'Velocidad' };
  const natLine = n => n.up ? '+' + T(STAT[n.up]) + ' −' + T(STAT[n.down]) : T('neutra');
  // Región (0: todas) y los filtros de la colección como en la web (menu.js, dexF): tengo / me faltan, shiny,
  // favoritos, rarezas (varias), tipo y orden. Duran mientras no se cierra el juego.
  let dexGen = 0;
  const DEX0 = () => ({ q: '', status: 'all', rar: new Set(), shiny: false, fav: false, type: '', sort: 'num' });
  let dexF = DEX0();
  const DEX_SORTS = [['num', 'Nº'], ['name', 'Nombre'], ['rar', 'Rareza'], ['new', 'Recién conseguidos'], ['used', 'Más usados']];
  const DEX_STATUS = [['all', 'Todos'], ['own', 'Tengo'], ['miss', 'Me faltan']];
  /** La lista con la región, los filtros y el orden de ahora (dexList de la web, sin la búsqueda). */
  function dexList() {
    const s = G.DB.save, f = dexF;
    // La búsqueda (escritorio), como la web: por número, o por nombre sin tildes (de los que tienes); busca en todas las regiones.
    const fold = t => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const q = fold((f.q || '').trim()), num = /^#?\d+$/.test(q) ? +q.replace('#', '') : null;
    const list = G.DEX.filter(p => {
      const own = !!s.owned[p.dex];
      if (!G.SPRITE_META[p.dex]) return false;
      if (q) { if (num != null ? p.dex !== num : !(own && [p.name, G.T(p.name)].some(n => fold(n).includes(q)))) return false; }
      else if (dexGen && p.gen !== dexGen) return false;
      if (f.status === 'own' && !own) return false;
      if (f.status === 'miss' && own) return false;
      if (f.shiny && !G.DB.ownsShiny(p.dex)) return false;
      if (f.fav && !G.DB.isFav(p.dex)) return false;
      if (f.rar.size && !f.rar.has(p.rarity)) return false;
      if (f.type && !(own && p.types.includes(f.type))) return false;
      return true;
    });
    const at = p => (s.owned[p.dex] && s.owned[p.dex].at) || 0, used = p => +(s.pused || {})[p.dex] || 0;
    const by = { num: (a, b) => a.dex - b.dex, name: (a, b) => G.T(a.name).localeCompare(G.T(b.name), G.I18n.locale),
                 rar: (a, b) => b.rarity - a.rarity || a.dex - b.dex, new: (a, b) => at(b) - at(a) || a.dex - b.dex,
                 used: (a, b) => used(b) - used(a) || a.dex - b.dex }[f.sort];
    // Los que no tienes no tienen nombre a la vista: al ordenar por nombre van al final.
    if (f.sort === 'name') list.sort((a, b) => (!s.owned[a.dex]) - (!s.owned[b.dex]) || by(a, b)); else list.sort(by);
    return list.map(p => p.dex);
  }
  /** □ en la colección: los filtros y el orden por secciones, en chips (#dex-filters y #dex-sort de la web), y Limpiar.
   *  ↑↓ entre filas, ←→ dentro de una fila, ✕ marca, △ limpia, ○ vuelve. */
  function dexFilters(back) {
    const R = G.Gacha.RARITY_NAME, LX0 = BX + 120, LW0 = BW - 138, CHH = 26;
    const sections = () => [
      ['Mostrar', DEX_STATUS.map(([k, l]) => ({ id: 'st:' + k, label: T(l), on: dexF.status === k }))],
      ['Sólo', [{ id: 'shiny', label: 'Shiny', ico: 'shiny', on: dexF.shiny }, { id: 'fav', label: T('Favoritos'), ico: 'star', on: dexF.fav }]],
      ['Rareza', [5, 4, 3, 2, 1].map(r => ({ id: 'rar:' + r, label: T(R[r]), ico: G.Icons.RARITY_BALL[r] || 'ball', on: dexF.rar.has(r) }))],
      ['Orden', DEX_SORTS.map(([k, l]) => ({ id: 'sort:' + k, label: T(l), on: dexF.sort === k }))],
      ['Tipo', [{ id: 'type:', label: T('Todos'), on: !dexF.type }]
        .concat(Object.keys(G.U.TYPE_NAME).map(t => ({ id: 'type:' + t, label: G.U.TYPE_NAME[t], ico: 'type:' + t, on: dexF.type === t })))],
    ];
    // Filas de chips con su x (una sección larga ocupa varias filas) y, al final, el botón Limpiar.
    const layout = () => {
      font(11);
      const lines = [];
      for (const [label, chips] of sections()) {
        let line = { label, chips: [] }, x = LX0;
        for (const c of chips) {
          const w = ctx.measureText(c.label).width + 22 + (c.ico ? 16 : 0);
          if (x + w > LX0 + LW0 && line.chips.length) { lines.push(line); line = { label: '', chips: [] }; x = LX0; }
          line.chips.push(Object.assign(c, { x, w })); x += w + 8;
        }
        lines.push(line);
      }
      lines.push({ label: '', chips: [{ id: 'clear', label: T('Limpiar filtros'), x: LX0, w: 150, btn: true }] });
      return lines;
    };
    let r = 0, c = 0, ver = 0;
    const apply = id => {
      const [k, v] = id.split(':');
      if (k === 'st') dexF.status = v;
      else if (k === 'shiny' || k === 'fav') dexF[k] = !dexF[k];
      else if (k === 'rar') dexF.rar.has(+v) ? dexF.rar.delete(+v) : dexF.rar.add(+v);
      else if (k === 'sort') dexF.sort = v;
      else if (k === 'type') dexF.type = v;
      else if (k === 'clear') dexF = DEX0();
      ver++;
    };
    open({
      key: () => r + '|' + c + '|' + ver,
      draw() {
        modal('Filtros', T('Se combinan entre sí. Orden y tipo: elige uno.'));
        const lines = layout();
        lines.forEach((ln, i) => {
          const y = BY + 62 + i * (CHH + 8) + (i === lines.length - 1 ? 8 : 0);
          if (ln.label) text(T(ln.label), BX + 20, y + 7, 11, C.muted, 'left', true);
          for (const [j, ch] of ln.chips.entries()) {
            const f = i === r && j === c;
            hot(ch.x, y, ch.w, CHH, f, () => { r = i; c = j; apply(ch.id); }, () => { r = i; c = j; });   // (ratón)
            if (ch.btn) { btn(ch.x, y, ch.w, CHH, ch.label, 'ghost', f, 11); if (f) ring(ch.x, y, ch.w, CHH, 7); continue; }
            rr(ch.x, y, ch.w, CHH, 13); ctx.fillStyle = ch.on ? 'rgba(255,211,74,0.18)' : 'rgba(0,0,0,0.25)'; ctx.fill();
            ctx.strokeStyle = ch.on ? C.gold : 'rgba(244,248,255,0.25)'; ctx.lineWidth = 1.5; ctx.stroke();
            if (ch.ico) icon(ch.ico, ch.x + 9, y + 6, 14);
            text(ch.label, ch.x + 11 + (ch.ico ? 16 : 0), y + 7, 11, ch.on ? C.gold : '#fff', 'left', ch.on);
            if (f) ring(ch.x, y, ch.w, CHH, 13);
          }
          if (i === lines.length - 1) text(dexList().length + ' Pokémon', LX0 + 166, y + 7, 11, C.muted);
        });
        hints([['ud', 'Mover'], ['x', 'Elegir'], ['t', 'Limpiar'], ['o', 'Volver']]);
      },
      input(ev) {
        const lines = layout();
        if (ev.dy) { r = (r + ev.dy + lines.length) % lines.length; c = Math.min(c, lines[r].chips.length - 1); G.Audio.sfx('select'); }
        if (ev.dx) { c = (c + ev.dx + lines[r].chips.length) % lines[r].chips.length; G.Audio.sfx('select'); }
        if (ev.a) { apply(lines[r].chips[c].id); G.Audio.sfx('select'); }
        else if (ev.y) { apply('clear'); G.Audio.sfx('select'); }
        else if (ev.b) { G.Audio.sfx('back'); close(); back(); }
      },
    });
  }

  // Como #scr-dex: pestañas de región (y Todas), filtros, rejilla de 5 y la ficha del que tiene el cursor a la derecha.
  function dexScreen(startDex, onPick) {   // onPick: modo elegir (Mejoras → Cambiar Pokémon): ✕ lo devuelve, ○ devuelve null
    if (!thumbs.done) return thumbsLoading(() => dexScreen(startDex, onPick));
    // En escritorio, como la web: buscador, tipo, filtros y orden a la vista (y la rejilla más abajo, de 2 filas a la vez).
    const WEB = CAN.keyboard || CAN.touch;   // la Pokédex de la web (con ratón o dedo; el buscador, con teclado o el del sistema)
    const s = G.DB.save, COLS = 5, CW = 88, CH = 96, GX = BX + 18, GY = WEB ? BY + 196 : BY + 128, ROWS = WEB ? 2 : 3, DX = BX + 482, DW = BW - 500;
    let typing = false;
    const typeKeys = [''].concat(Object.keys(G.U.TYPE_NAME));
    const sh = shoulders();
    let list = [], sel = 0, scroll = 0, ver = 0;
    const build = () => {
      list = dexList();
      sel = Math.max(0, Math.min(sel, list.length - 1)); scroll = 0;
    };
    const fix = () => { const row = Math.floor(sel / COLS); if (row < scroll) scroll = row; else if (row >= scroll + ROWS) scroll = row - ROWS + 1; };
    if (startDex && G.DEX_BY[startDex]) { if (dexGen) dexGen = G.DEX_BY[startDex].gen; build(); sel = Math.max(0, list.indexOf(startDex)); fix(); }
    else build();
    const load = () => { if (list[sel] && s.owned[list[sel]]) preIdle([list[sel]]); };   // los demás, de las miniaturas
    load();
    const refilter = () => { sel = 0; build(); load(); ver++; };
    // Escritorio: las filas de la web (#dex-search, #dex-type, #dex-filters, #dex-sort), todo con clic.
    function webFilters() {
      // Buscador: clic y a escribir (psTextSink de browser.js); Enter, Esc o un clic fuera lo dejan.
      const sx = GX, sw = 250, sy = BY + 88;
      rr(sx, sy, sw, 22, 6); ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fill();
      ctx.strokeStyle = typing ? C.gold : 'rgba(244,248,255,0.3)'; ctx.lineWidth = 1.5; ctx.stroke();
      const q = dexF.q || '';
      font(10); const qw = ctx.measureText(q).width;
      if (q || typing) text(q, sx + 8, sy + 6, 10, '#fff');
      else text(T('Buscar por nombre o número'), sx + 8, sy + 6, 10, C.muted);
      if (typing && Math.floor(ps.now() / 500) % 2 === 0) { ctx.fillStyle = '#fff'; ctx.fillRect(sx + 9 + qw, sy + 5, 1.5, 12); }
      const focus = () => {
        if (noKb()) {   // (tablet sin teclado: el de la pantalla, y vuelta a la Pokédex)
          const me = top; close();
          return keyboard('Buscar por nombre o número', dexF.q || '', { max: 24 }, v => { if (v != null) { dexF.q = v; refilter(); } open(me); });
        }
        typing = true;
        globalThis.psTextSink = ch => {
          if (ch === '\n') { typing = false; globalThis.psTextSink = null; }
          else if (ch === '\b') dexF.q = (dexF.q || '').slice(0, -1);
          else if ((dexF.q || '').length < 24) dexF.q = (dexF.q || '') + ch;
          refilter();
        };
      };
      focus.text = true;   // (un clic aquí no le quita el foco: mouseNav)
      hot(sx, sy, sw, 22, false, focus);
      // Tipo: clic, el siguiente (como el desplegable de la web, uno a uno).
      const tn = dexF.type ? G.U.TYPE_NAME[dexF.type] : T('Todos los tipos');
      font(10); const tw = ctx.measureText(tn).width + 40, tx0 = sx + sw + 8;
      rr(tx0, sy, tw, 22, 6); ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fill(); ctx.strokeStyle = 'rgba(244,248,255,0.3)'; ctx.lineWidth = 1.5; ctx.stroke();
      if (dexF.type) icon('type:' + dexF.type, tx0 + 7, sy + 5, 12);
      text(tn, tx0 + (dexF.type ? 23 : 9), sy + 6, 10, '#fff');
      ctx.beginPath(); ctx.moveTo(tx0 + tw - 15, sy + 9); ctx.lineTo(tx0 + tw - 7, sy + 9); ctx.lineTo(tx0 + tw - 11, sy + 14); ctx.closePath(); ctx.fillStyle = C.muted; ctx.fill();
      hot(tx0, sy, tw, 22, false, (mx, my, ev) => { const i = typeKeys.indexOf(dexF.type); dexF.type = typeKeys[(i + 1) % typeKeys.length]; refilter(); });
      text(list.length + ' Pokémon', DX - 14, sy + 6, 10, C.muted, 'right');
      // Filtros: mostrar (uno), shiny, favoritos y rarezas (los que quieras).
      const R = G.Gacha.RARITY_NAME, chips = [
        ...DEX_STATUS.map(([k, l]) => [T(l), null, dexF.status === k, () => { dexF.status = k; }]),
        ['Shiny', 'shiny', dexF.shiny, () => { dexF.shiny = !dexF.shiny; }],
        [T('Favoritos'), 'star', dexF.fav, () => { dexF.fav = !dexF.fav; }],
        ...[5, 4, 3, 2, 1].map(r => [T(R[r]), G.Icons.RARITY_BALL[r] || 'ball', dexF.rar.has(r), () => { dexF.rar.has(r) ? dexF.rar.delete(r) : dexF.rar.add(r); }])];
      let cx = GX, cy = BY + 117;
      for (const [l, ico, on, fn] of chips) {
        font(10); const w = ctx.measureText(l).width + 16 + (ico ? 14 : 0);
        if (cx + w > DX - 14) { cx = GX; cy += 24; }
        chip(cx, cy, l, on, ico); hot(cx, cy, w, 20, false, () => { fn(); refilter(); }); cx += w + 5;
      }
      // Orden
      cy += 26; cx = GX;
      text(T('Orden'), cx, cy + 5, 10, C.muted); font(10); cx += ctx.measureText(T('Orden')).width + 8;
      for (const [k, l] of DEX_SORTS) {
        font(10); const w = ctx.measureText(T(l)).width + 16;
        chip(cx, cy, T(l), dexF.sort === k); hot(cx, cy, w, 20, false, () => { dexF.sort = k; refilter(); }); cx += w + 5;
      }
    }
    open({ wheel: true,
      key: () => sel + '|' + scroll + '|' + dexGen + '|' + ver + '|' + typing + '|' + (typing && Math.floor(ps.now() / 500) % 2),   // (el cursor del buscador parpadea)
      draw() {
        const owned = Object.keys(s.owned).filter(d => G.DEX_BY[d]).length;
        modal('Pokémon', owned + ' / ' + G.DEX.length);
        // Pestañas: Todas + 9 regiones, con cuántos tienes de cada una.
        let tx = BX + 18;
        padIcon('l1', tx + 10, BY + 62); tx += 26;
        ['Todas'].concat(GEN_NAMES).forEach((g, i) => {
          const all = G.DEX.filter(p => !i || p.gen === i), have = all.filter(p => s.owned[p.dex]).length, on = i === dexGen && !dexF.q;   // (buscando: ninguna, como la web)
          tabHot(tx, BY + 48, 58, 30, i - dexGen);   // (ratón)
          rr(tx, BY + 48, 58, 30, 6); ctx.fillStyle = on ? vgrad(BY + 48, 30, '#ffe37a', '#f0a31e') : 'rgba(0,0,0,0.25)'; ctx.fill();
          ctx.strokeStyle = on ? '#fff7d6' : 'rgba(244,248,255,0.25)'; ctx.lineWidth = 1.5; ctx.stroke();
          text(T(g), tx + 29, BY + 52, 10, on ? '#3a2300' : '#fff', 'center', true, on ? null : C.navy);
          text(have + '/' + all.length, tx + 29, BY + 65, 8, on ? '#5a3a00' : C.muted, 'center', false, null);
          tx += 62;
        });
        padIcon('r1', tx + 10, BY + 62);
        if (WEB) webFilters(); else {
        // Filtros (□ cambia) y cuántos salen.
        let cx = GX;
        padIcon('s', cx + 8, BY + 99, 8); cx += 20;
        // Lo que está puesto (como los chips encendidos de la web); si no cabe, "…".
        const on = [[T('Filtros'), null, true]];
        if (dexF.status !== 'all') on.push([T(DEX_STATUS.find(e => e[0] === dexF.status)[1]), null]);
        if (dexF.shiny) on.push(['Shiny', 'shiny']);
        if (dexF.fav) on.push([T('Favoritos'), 'star']);
        for (const r of [5, 4, 3, 2, 1]) if (dexF.rar.has(r)) on.push(['', G.Icons.RARITY_BALL[r] || 'ball']);
        if (dexF.type) on.push([G.U.TYPE_NAME[dexF.type], 'type:' + dexF.type]);
        if (dexF.sort !== 'num') on.push([T('Orden') + ': ' + T(DEX_SORTS.find(e => e[0] === dexF.sort)[1]), null]);
        for (const [l, ico, first] of on) {
          font(10); if (cx + ctx.measureText(l).width + 30 > DX - 90) { text('…', cx, BY + 94, 10, C.muted); break; }
          const cw = chip(cx, BY + 89, l, !first, ico); hot(cx, BY + 89, cw, 20, false, 'x'); cx += cw + 5;   // (ratón: abre los filtros, como □)
        }
        text(list.length + ' Pokémon', DX - 14, BY + 94, 10, C.muted, 'right');
        }
        // Rejilla
        for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
          const i = (scroll + r) * COLS + c;
          if (i >= list.length) continue;
          const d = list[i], x = GX + c * CW, y = GY + r * CH, on = i === sel, own = s.owned[d], p = G.DEX_BY[d];
          // (ratón; en escritorio: clic elige, otro clic abre la ficha; con el dedo, un toque la abre: el segundo no se adivinaba)
          hot(x, y, CW - 6, CH - 6, on, WEB ? (mx, my, ev) => { console.log('[dex] toque en ' + d + ' (sel ' + list[sel] + ')'); if (sel === i || CAN.touch) { sel = i; ev.a = true; } else { sel = i; load(); } } : null, () => { sel = i; load(); });
          rr(x, y, CW - 6, CH - 6, 8);
          ctx.fillStyle = on ? 'rgba(255,210,63,0.12)' : 'rgba(0,0,0,0.2)'; ctx.fill();
          ctx.strokeStyle = on ? C.gold : 'rgba(244,248,255,0.2)'; ctx.lineWidth = on ? 2 : 1.5; ctx.stroke();
          text(String(d).padStart(3, '0'), x + 6, y + 5, 8, C.muted, 'left', false, null);
          if (d === s.partner) icon('crown', x + CW - 22, y + 4, 11);
          else if (G.DB.isFav(d)) icon('star', x + CW - 22, y + 4, 10);
          if (G.DB.ownsShiny(d)) icon('shiny', x + CW - 22, y + 16, 9);
          let nm = own ? p.name : '???';
          font(9, true); while (nm.length > 3 && ctx.measureText(nm).width > CW - 12) nm = nm.slice(0, -2) + '…';
          text(nm, x + (CW - 6) / 2, y + CH - 32, 9, own ? '#fff' : C.muted, 'center', true);
          icon(G.Icons.RARITY_BALL[p.rarity] || 'ball', x + (CW - 6) / 2 - 5, y + CH - 20, 10);
        }
        if (!list.length) text(T('Ningún Pokémon con estos filtros'), GX + 220, GY + 100, 13, C.muted, 'center');
        if (list.length > ROWS * COLS) {   // barra de desplazamiento
          const rows = Math.ceil(list.length / COLS), hh = ROWS * CH - 6, bh = Math.max(16, hh * ROWS / rows);
          rr(DX - 12, GY, 4, hh, 2); ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fill();
          rr(DX - 12, GY + (hh - bh) * scroll / Math.max(1, rows - ROWS), 4, bh, 2); ctx.fillStyle = C.muted; ctx.fill();
        }
        // La ficha del que tiene el cursor (#dex-detail)
        panel(DX, BY + 89, DW, BH - 102);
        const d = list[sel];
        if (d) {
          const p = G.DEX_BY[d], own = !!s.owned[d], mx = DX + DW / 2;
          stage(mx - 76, BY + 99, 152, 124, own ? G.U.TYPE_COLOR[p.types[0]] : C.edgeIn);
          text('Nº ' + String(d).padStart(3, '0') + ' · ' + GEN_NAMES[p.gen - 1], mx, BY + 230, 9, C.muted, 'center');
          text(own ? p.name : '???', mx, BY + 243, 14, '#fff', 'center', true);
          // Escritorio: «Marcar como favorito» bajo el nombre, como la web (#dex-fav); lo de debajo baja 20.
          const fy = WEB && own ? 20 : 0;
          if (fy) {
            const fav = G.DB.isFav(d), fl = T(fav ? 'Favorito' : 'Marcar como favorito'); font(10); const fw = ctx.measureText(fl).width + 30;
            // «Ficha» (compañero, shiny, mejorar): con el dedo no se adivinaba que había que tocar la casilla otra vez
            const bw = 64, x0 = mx - (bw + 6 + fw) / 2;
            btn(x0, BY + 260, bw, 20, T(onPick ? 'Elegir' : 'Ficha'), 'gold', false, 10);
            hot(x0, BY + 260, bw, 20, false, (mx2, my2, ev) => { ev.a = true; });
            chip(x0 + bw + 6, BY + 260, fl, fav, fav ? 'star' : 'starDim');
            hot(x0 + bw + 6, BY + 260, fw, 20, false, () => { G.DB.setFav(d, !G.DB.isFav(d)); ver++; });
          }
          font(9.5); const rw = ctx.measureText(T(G.Gacha.RARITY_NAME[p.rarity])).width + 16;
          icon(G.Icons.RARITY_BALL[p.rarity] || 'ball', mx - rw / 2, BY + 262 + fy, 12);
          text(T(G.Gacha.RARITY_NAME[p.rarity]), mx - rw / 2 + 16, BY + 263 + fy, 9.5, G.Gacha.RARITY_COLOR[p.rarity]);
          if (own) {
            typeChips(p.types, mx, BY + 279 + fy, true);
            const n = G.Mons.natureOf(d), q = G.Mons.monFor(d), mood = k => n.up === k ? 1 : n.down === k ? -1 : 0;
            [['Vida', q.hp / 183, q.hp, ''], ['Ataque', q.pa / 1.55, '×' + q.pa.toFixed(2), 'pa'], ['At. Esp.', q.sa / 1.55, '×' + q.sa.toFixed(2), 'sa'],
             ['Defensa', q.df / 160, Math.round(q.df), 'df'], ['Def. Esp.', q.sd / 160, Math.round(q.sd), 'sd'], ['Velocidad', q.spd / 137, Math.round(q.spd), 'spd']]
              .forEach(([l, f, v, k], i) => statBar(DX + 12, BY + 300 + fy + i * 15, DW - 24, l, f, v, mood(k)));
            text(T('Empieza con') + ' ' + moveName(G.startMoveOf(d)), mx, BY + 395 + fy, 9.5, C.gold, 'center');
          } else {
            wrap(G.I18n.f('Aún no lo tienes. Consíguelo en el banner de {x} o derrotándolo cuando salga shiny.', T(GEN_NAMES[p.gen - 1])), DW - 24, 10)
              .slice(0, 5).forEach((l, i) => text(l, mx, BY + 285 + i * 14, 10, C.muted, 'center'));
          }
        }
        hints([['lr', 'Mover'], ['x', onPick ? 'Elegir' : 'Ficha'], ['s', 'Filtros'], ['o', 'Volver']]);
      },
      live(now) {
        for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
          const i = (scroll + r) * COLS + c;
          if (i >= list.length) continue;
          const d = list[i], own = !!s.owned[d], x = GX + c * CW, y = GY + r * CH + 12;
          if (i === sel && own && G.Sprites.sheet(d, G.SPRITE_META[d].a.Idle ? 'Idle' : 'Walk').ready) monIn(d, x, y, CW - 6, CH - 46, 2, now);
          else thumbIn(d, x, y, CW - 6, CH - 46, 2, !own);
        }
        const d = list[sel];
        if (d && s.owned[d] && G.Sprites.sheet(d, G.SPRITE_META[d].a.Idle ? 'Idle' : 'Walk').ready) monIn(d, DX + DW / 2 - 76, BY + 99, 152, 124, 3, now, { skin: G.Skins.worn(s, d) });
        else if (d) thumbIn(d, DX + DW / 2 - 76, BY + 99, 152, 124, 3, !s.owned[d]);
      },
      input(ev) {
        const g = sh();
        if (g) { dexGen = (dexGen + g + 10) % 10; sel = 0; build(); load(); G.Audio.sfx('select'); }
        if (ev.x) { G.Audio.sfx('select'); const d = list[sel]; close(); dexFilters(() => dexScreen(d, onPick)); return; }
        if ((ev.dx || ev.dy) && list.length) {
          sel = Math.max(0, Math.min(list.length - 1, sel + ev.dx + ev.dy * COLS));
          fix(); load(); G.Audio.sfx('select');
        }
        if (ev.wheelRows) { scroll = clamp(scroll + ev.wheelRows, 0, Math.max(0, Math.ceil(list.length / COLS) - ROWS)); load(); }   // (sólo la vista)
        if (ev.a && list[sel] && onPick && !s.owned[list[sel]]) G.Audio.sfx('error');
        else if (ev.a && list[sel]) { console.log('[dex] ficha de ' + list[sel]); G.Audio.sfx('select'); const d = list[sel]; close(); onPick ? onPick(d) : monCard(d); }
        else if (ev.b) { G.Audio.sfx('back'); close(); onPick ? onPick(null) : mainMenu(); }
      },
    });
  }

  // La ficha de un Pokémon (#dex-detail con .mon-extra de la web): a la izquierda quién es y "Elegir de compañero";
  // a la derecha estadísticas, naturaleza, habilidad y MT, con sus botones (Menta, Cápsulas, Enseñar MT).
  function monCard(dex) {
    const s = G.DB.save, p = G.DEX_BY[dex], own = !!s.owned[dex], hasSh = G.DB.ownsShiny(dex);
    let viewShiny = hasSh && dex === s.partner && !!s.partnerShiny, sel = 0, ver = 0;
    const back = () => monCard(dex);
    const setView = v => { if (v === viewShiny) return; viewShiny = v; preIdle([dex], v); ver++; };
    // Lo que se puede pulsar, en el orden del cursor: { id, label, ico, fn } (fn null: apagado).
    const actions = () => {
      if (!own) return [];
      const a = [];
      const usingThis = dex === s.partner && (!hasSh || !!s.partnerShiny === viewShiny);
      a.push({ id: 'pick', label: usingThis ? T('Es tu compañero') : T('Elegir de compañero') + (viewShiny ? ' (shiny)' : ''), fn: usingThis ? null : () => {
        s.partner = dex; s.partnerShiny = hasSh && viewShiny; G.DB.commit(); G.Audio.sfx('confirm'); ver++;
      } });
      a.push({ id: 'upg', ico: 'up', label: T('Mejorar Pokémon'), fn: () => { G.Audio.sfx('select'); close(); upgDex = dex; upgPartner = s.partner; upgradesScreen(back); } });
      a.push({ id: 'fav', label: G.DB.isFav(dex) ? T('Favorito') : T('Marcar como favorito'), fn: () => { G.DB.setFav(dex, !G.DB.isFav(dex)); G.Audio.sfx('select'); ver++; } });
      // Skins (Halloween 2026, skinRow de la web): las compradas de este Pokémon, para ponerlas o quitarlas.
      for (const id of G.Skins.LIST.filter(k => G.Skins.SKINS[k].dex === +dex && G.Skins.owns(s, k))) {
        const on = G.Skins.worn(s, dex) === id;
        a.push({ id: 'skin:' + id, ico: 'witch', label: T(on ? 'Quitársela' : 'Ponérsela'), fn: () => {
          G.Skins.wear(s, dex, on ? '' : id); G.DB.commit(); G.Audio.sfx(on ? 'select' : 'buy'); ver++;
        } });
      }
      if (G.Shop.count('mint')) a.push({ id: 'nat', ico: 'mint', label: T('Menta') + ' ×' + G.Shop.count('mint'), fn: () => { close(); movePicker('Menta', T('Elige su nueva naturaleza'),
        () => G.NATURES.map(n => ({ id: n.id, label: G.Mons.name(n.n), sub: natLine(n), on: n.id === G.Mons.natureOf(dex).id })),
        id => { if (id === G.Mons.natureOf(dex).id || !G.Shop.take('mint')) return true; G.Mons.setNature(dex, id); G.DB.commit(); G.Audio.sfx('buy'); return true; }, back); } });
      for (const [key, hidden, label, ico] of [['cap', false, 'Cápsula', 'capsule'], ['caph', true, 'Cápsula Oculta', 'capsuleh']]) {
        const choices = G.Mons.abilityChoices(dex, hidden);
        if (G.Shop.count(key) && choices.length) a.push({ id: key, ico, label: T(label) + ' ×' + G.Shop.count(key), fn: () => { close(); movePicker(label, T('Elige su nueva habilidad'),
          () => choices.map(slot => ({ id: String(slot), label: G.Mons.abilityName(G.Mons.slots(dex)[slot]), sub: slot === 2 ? T('oculta') : '' })),
          slot => { if (!G.Shop.take(key)) return true; G.Mons.setAbility(dex, +slot); G.DB.commit(); G.Audio.sfx('buy'); return true; }, back); } });
      }
      const tms = G.Mons.learnable(dex).filter(id => G.Shop.tmCount(id) > 0);
      if (tms.length) a.push({ id: 'tm', ico: 'tm', label: T('Enseñar MT') + ' ×' + tms.length, fn: () => { close(); movePicker('Enseñar MT', T('Se gasta al enseñarla y la aprende para siempre'),
        () => tms.map(id => ({ id, label: moveCat(id), icon: 'move:' + id, sub: '×' + G.Shop.tmCount(id) })),
        id => { if (G.Mons.teach(dex, id)) { G.DB.commit(); G.Audio.sfx('buy'); } return true; }, back); } });
      return a;
    };
    const L = BX + 18, LW = 250, mx = L + LW / 2, R = BX + 290, RW = BW - 308;
    open({
      key: () => sel + '|' + viewShiny + '|' + ver,
      draw() {
        modal('Pokémon', 'Nº ' + String(dex).padStart(3, '0') + ' · ' + GEN_NAMES[p.gen - 1]);
        const acts = actions(), focus = acts[sel] && acts[sel].id;
        const actBtn = (id, x, y, w, h, kind, px = 10) => {
          const a = acts.find(q => q.id === id);
          if (a) btn(x, y, w, h, a.label, a.fn ? kind : 'off', focus === id, px, a.ico, () => { sel = acts.findIndex(q => q.id === id); });
          return !!a;
        };
        // Izquierda: el Pokémon (los dos botones abajo, con aire entre ellos y hasta el borde de la caja)
        stage(L + 25, BY + 48, 200, 130, !own ? C.edgeIn : viewShiny ? '#9ae6ff' : G.U.TYPE_COLOR[p.types[0]], own && viewShiny);
        if (hasSh) {
          btn(mx - 62, BY + 184, 60, 20, T('Normal'), 'ghost', !viewShiny, 10); btn(mx + 2, BY + 184, 60, 20, 'Shiny', 'ghost', viewShiny, 10, 'shiny');
          // (clic o toque: directo; sin act, focusTo daba pasos de cruceta y acababa pulsando «Elegir de compañero»)
          hot(mx - 62, BY + 184, 60, 20, false, () => setView(false)); hot(mx + 2, BY + 184, 60, 20, false, () => setView(true));
        }
        text(own ? p.name : '???', mx, BY + 210, 16, '#fff', 'center', true);
        if (own) {
          const fav = G.DB.isFav(dex);
          const fl = acts.find(q => q.id === 'fav').label; font(10); const fw = ctx.measureText(fl).width + 30;
          chip(mx - fw / 2, BY + 232, fl, fav, fav ? 'star' : 'starDim');
          hot(mx - fw / 2, BY + 232, fw, 20, focus === 'fav', null, () => { sel = acts.findIndex(q => q.id === 'fav'); });   // (ratón)
          if (focus === 'fav') { rr(mx - fw / 2 - 3, BY + 229, fw + 6, 26, 12); ctx.strokeStyle = C.gold; ctx.lineWidth = 2; ctx.stroke(); }
        }
        font(10); const rw = ctx.measureText(T(G.Gacha.RARITY_NAME[p.rarity])).width + 18;
        icon(G.Icons.RARITY_BALL[p.rarity] || 'ball', mx - rw / 2, BY + 260, 14);
        text(T(G.Gacha.RARITY_NAME[p.rarity]), mx - rw / 2 + 18, BY + 262, 10, G.Gacha.RARITY_COLOR[p.rarity]);
        if (!own) {
          wrap(G.I18n.f('Aún no lo tienes. Consíguelo en el banner de {x} o derrotándolo cuando salga shiny.', T(GEN_NAMES[p.gen - 1])), RW, 13)
            .forEach((l, i) => text(l, R, BY + 60 + i * 20, 13, C.muted));
          hints([['o', 'Volver']]);
          return;
        }
        typeChips(p.types, mx, BY + 280, true);
        text(T('Empieza con') + ' ' + moveName(G.startMoveOf(dex)), mx, BY + 304, 10, C.gold, 'center', true);
        const pool = G.Moves.poolFor(p);
        pool.slice(0, 26).forEach((id, i) => icon('move:' + id, mx - Math.min(13, pool.length) * 9 + (i % 13) * 18, BY + 324 + Math.floor(i / 13) * 18, 16));
        actBtn('pick', L, BY + BH - 82, LW, 30, 'gold', 12);
        actBtn('upg', L, BY + BH - 44, LW, 30, 'blue', 12);
        // Derecha: estadísticas
        const n = G.Mons.natureOf(dex), q = G.Mons.monFor(dex), mood = k => n.up === k ? 1 : n.down === k ? -1 : 0;
        [['Vida', q.hp / 183, q.hp, ''], ['Ataque', q.pa / 1.55, '×' + q.pa.toFixed(2), 'pa'], ['At. Esp.', q.sa / 1.55, '×' + q.sa.toFixed(2), 'sa'],
         ['Defensa', q.df / 160, Math.round(q.df), 'df'], ['Def. Esp.', q.sd / 160, Math.round(q.sd), 'sd'], ['Velocidad', q.spd / 137, Math.round(q.spd), 'spd']]
          .forEach(([l, f, v, k], i) => statBar(R, BY + 52 + i * 18, RW, l, f, v, mood(k)));
        spans([[T('Pega mejor con ataques') + ' ', C.muted], [G.Stats.sideOf(q) === 'special' ? T('especiales') : T('físicos'), C.gold, true]], R, BY + 162, 10);
        // .mon-extra: naturaleza, habilidad (con lo que hace debajo), MT, skin y monotipo, cada fila con su botón a la
        // derecha; el panel mide lo que ocupa.
        const ab = G.Mons.abilityOf(dex), fx = G.AbilityFX.of(ab.id, p), taught = G.Mons.taught(dex), skins = acts.filter(q => q.id.startsWith('skin:'));
        const abLines = wrap(strip(fx.d) + (fx.d2 ? ' ' + strip(fx.d2) : ''), RW - 20, 9.5).slice(0, 3);
        const mono = p.types.length === 1 ? wrap(G.I18n.f('Monotipo: +20 % de daño con sus ataques de tipo {x}', G.U.TYPE_NAME[p.types[0]]), RW - 20, 9.5).slice(0, 2) : [];
        const PY = BY + 182, RH = 30, yNat = PY + 8, yAb = yNat + RH, yTm = yAb + RH + abLines.length * 13 + 4, ySk = yTm + RH;
        const yMono = (skins.length ? ySk + RH : ySk) + 2;
        panel(R, PY, RW, yMono + mono.length * 13 + 8 - PY);
        const row = (y, label) => text(T(label), R + 10, y + 6, 10, C.muted);
        const line = y => { ctx.fillStyle = 'rgba(244,248,255,0.1)'; ctx.fillRect(R + 10, y - 3, RW - 20, 1); };
        row(yNat, 'Naturaleza');
        text(G.Mons.name(n.n), R + 90, yNat + 5, 11, '#fff', 'left', true);
        font(11, true); text(natLine(n), R + 96 + ctx.measureText(G.Mons.name(n.n)).width, yNat + 7, 9, C.muted);
        actBtn('nat', R + RW - 110, yNat + 1, 100, 22, 'blue');
        line(yAb);
        row(yAb, 'Habilidad');
        text(G.Mons.abilityName(ab.id), R + 90, yAb + 5, 11, '#fff', 'left', true);
        if (ab.slot === 2) { font(11, true); text(T('oculta'), R + 96 + ctx.measureText(G.Mons.abilityName(ab.id)).width, yAb + 7, 9, C.gold); }
        let bx = R + RW - 10;
        for (const id of ['caph', 'cap']) { const a = acts.find(q => q.id === id); if (a) { font(10, true); const w = ctx.measureText(a.label).width + 34; bx -= w; actBtn(id, bx, yAb + 1, w, 22, 'blue'); bx -= 8; } }
        abLines.forEach((l, i) => text(l, R + 10, yAb + 28 + i * 13, 9.5, C.muted));
        line(yTm);
        row(yTm, 'MT');
        if (taught.length) taught.forEach((id, i) => icon('move:' + id, R + 90 + i * 20, yTm + 4, 16));
        else text(T('Aún no ha aprendido ninguna'), R + 90, yTm + 7, 9.5, C.muted);
        actBtn('tm', R + RW - 120, yTm + 1, 110, 22, 'blue');
        if (skins.length) {
          const on = G.Skins.worn(s, dex);
          line(ySk);
          row(ySk, 'Skin');
          text(on ? T(G.Skins.SKINS[on].name) : T('Sin skin'), R + 90, ySk + 5, 11, '#fff', 'left', true);
          let sx = R + RW - 10;
          for (const q of skins) { font(10, true); const w = ctx.measureText(q.label).width + 34; sx -= w; actBtn(q.id, sx, ySk + 1, w, 22, G.Skins.worn(s, dex) === q.id.slice(5) ? 'blue' : 'gold'); sx -= 8; }
        }
        if (mono.length) line(yMono);
        mono.forEach((l, i) => text(l, R + 10, yMono + 4 + i * 13, 9.5, C.muted));
        const h = [['ud', 'Mover'], ['x', 'Elegir']];
        if (hasSh) h.push(['lr', 'Normal / shiny']);
        h.push(['o', 'Volver']);
        hints(h);
      },
      live(now) { monIn(dex, L + 25, BY + 48, 200, 130, 3, now, { shiny: own && viewShiny, sil: !own, skin: own ? G.Skins.worn(s, dex) : '' }); },
      input(ev) {
        const a = actions();
        // ↑↓ las acciones; ←→ (o △) los botones Normal / Shiny de debajo del Pokémon.
        if (ev.dy && a.length) { sel = (sel + ev.dy + a.length) % a.length; G.Audio.sfx('select'); }
        else if (ev.dx && !hasSh && a.length) { sel = (sel + ev.dx + a.length) % a.length; G.Audio.sfx('select'); }
        if (hasSh && (ev.y || (ev.dx && viewShiny !== ev.dx > 0))) { setView(ev.y ? !viewShiny : ev.dx > 0); G.Audio.sfx('select'); }
        if (ev.a && a[sel] && a[sel].fn) a[sel].fn();
        else if (ev.b) { G.Audio.sfx('back'); close(); dexScreen(dex); }
      },
    });
    preIdle([dex], viewShiny);
  }

  // ---------------- Tienda Kecleon y Mochila (#scr-shop / #scr-bag; la lógica es G.Shop) ----------------
  // Una tarjeta .upg-item: icono, título (con extra dorado), descripción y, a la derecha, el botón o el número.
  const UG = 8, UW = Math.floor((BW - 36 - 2 * UG) / 3);   // 3 columnas dentro de la caja (con 233 la 3ª se salía)
  function upgCard(x, y, h, { ico, dimIco, title, extra, chips, desc, descCol, price, right, rightDim, on, focus }) {
    if (focus) hot(x, y, UW, h, on, null, focus);   // (la tarjeta entera: el ratón encima la elige al instante)
    panel(x, y, UW, h);
    if (on) { rr(x, y, UW, h, 8); ctx.strokeStyle = C.gold; ctx.lineWidth = 2; ctx.stroke(); }
    if (dimIco) ctx.globalAlpha = 0.35;
    icon(ico, x + 10, y + h / 2 - 12, 24);
    ctx.globalAlpha = 1;
    const tw = UW - 44 - (price != null ? 74 : 54);
    let ty = y + 9, tx = x + 44;
    text(title, tx, ty, 11, '#fff', 'left', true);
    font(11, true); tx += ctx.measureText(title).width + 4;
    for (const [label, bg, fg] of chips || []) {
      font(8, true); const cw = ctx.measureText(label).width + 8;
      if (tx + cw > x + 44 + tw) { tx = x + 44; ty += 14; }
      rr(tx, ty + 1, cw, 11, 3); ctx.fillStyle = bg; ctx.fill(); text(label, tx + 4, ty + 3, 8, fg || '#10131a', 'left', true, null); tx += cw + 3;
    }
    if (extra) { if (tx + 40 > x + 44 + tw) { tx = x + 44; ty += 14; } text(extra, tx, ty + 2, 9, C.gold); }
    wrap(desc, tw, 9).slice(0, Math.floor((y + h - ty - 22) / 12) + 1).forEach(l => { ty += 13; text(l, x + 44, ty, 9, descCol || C.muted); });
    if (price != null) btn(x + UW - 72, y + h / 2 - 12, 62, 24, price.toLocaleString(), G.DB.save.coins >= price ? 'gold' : 'off', on, 10, 'coin');
    else if (right) text(right, x + UW - 10, y + h / 2 - 6, 11, rightDim ? C.muted : C.gold, 'right', true);
  }
  function h3(t, x, y) { text(T(t), x, y, 13.5, '#fff', 'left', true); }

  let shopCv = null;
  function shopScreen() {
    const s = G.DB.save, SH = 220;
    // El puesto animado es el de la web (Scene de js/ui/shop-ui.js): se le da un lienzo del tamaño que tiene allí
    // (976x294 a 1280x720) y se copia aquí a 0,75.
    if (!shopCv) {
      shopCv = document.createElement('canvas');
      shopCv.setAttribute('id', 'shop-scene');
      shopCv.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 976, bottom: 294, width: 976, height: 294 });
    }
    try { G.ShopUI.open(); } catch (e) { console.error('[ui] tienda: ' + e.message); }
    const bubble = document.getElementById('shop-bubble'), sign = document.getElementById('shop-sign');
    let sel = 0, scroll = 0, follow = true, shopMax = 0;   // (la vista va a lo elegido con teclas; la rueda la mueve sola)
    // Grupos de tarjetas, de 3 en fila: (Halloween: skins de bruja por caramelos), objetos y MT de hoy.
    const SKIN_SUB = 'Sólo hasta el 2 de noviembre. Los caramelos salen en las partidas (sobre todo de los Fantasma y las calabazas) y ante el gran Gengar. La skin es para siempre; se pone y se quita en la ficha del Pokémon.';
    const TM_SUB = 'Cada día hay otras 8. Una MT enseña su ataque a un Pokémon que lo aprenda en los juegos, para siempre (se gasta al usarla).';
    const groups = () => [
      G.Halloween.on && { title: 'Halloween: skins de bruja', ico: 'witch', sub: SKIN_SUB, keys: G.Skins.LIST.map(id => 'skin:' + id) },
      { title: 'Objetos', keys: G.Shop.ORDER.slice() },
      { title: 'MT de hoy', sub: TM_SUB, keys: G.Shop.dailyTms().map(id => 'tm:' + id) },
    ].filter(g => g && g.keys.length);
    const keys = () => groups().flatMap(g => g.keys);
    // Dónde va cada cosa (y dentro de la caja, desplazable): sin desplazar, desde arriba del contenido.
    const IH = 82;
    const layout = () => {
      const pos = [];
      let y = 44;
      const subH = wrap(T('¡Bienvenido! Mentas, Cápsulas y MT. Lo que compres va a tu Mochila (en el menú principal); úsalo desde la ficha de cada Pokémon en la colección.'), BW - 40, 10).length * 13;
      y += subH + 8;
      pos.heads = [];
      groups().forEach((g, gi) => {
        const head = { g, y, subL: g.sub ? wrap(T(g.sub), BW - 40, 9) : [] };
        pos.heads.push(head);
        y += 20 + (head.subL.length ? head.subL.length * 12 + 6 : 0) + (g.ico === 'witch' ? 14 : 0);
        g.keys.forEach((key, j) => pos.push({ x: BX + 18 + (j % 3) * (UW + UG), y: y + Math.floor(j / 3) * (IH + UG), g: gi, j }));
        y += Math.ceil(g.keys.length / 3) * (IH + UG) + 6;
      });
      pos.subH = subH;
      pos.end = y + 6;
      return pos;
    };
    const skinReady = () => G.Skins.LIST.every(id => { const d = G.Skins.SKINS[id].dex, sh = G.Sprites.sheet(d, G.SPRITE_META[d] && G.SPRITE_META[d].a.Idle ? 'Idle' : 'Walk', false, id); return !sh || sh.ready; });
    open({ wheel: true,
      id: 'scr-shop',
      scrollNow: () => scroll,   // (desplazar no redibuja: scrollBegin)
      key: () => sel + '|' + s.coins + '|' + sum(s.bag) + '|' + sum(s.tms) + '|' + G.Halloween.on + '|' + Object.keys(s.skins || {}).length + '|' + (G.Halloween.on && skinReady()),
      draw() {
        dim();
        box(BX, BY, BW, BH);
        const pos = layout(), k = keys(), top = BY + SH + 4;
        const cy = pos[sel].y - scroll;
        if (follow) {
          if (cy + SH + 4 < SH + 4 + 30) scroll = Math.max(0, pos[sel].y - 60);
          if (cy + IH > BH - 10 - SH) scroll = pos[sel].y + IH - (BH - 10 - SH);
          follow = false;
        }
        shopMax = Math.max(0, pos.end - (BH - SH - 6));
        scroll = Math.max(0, Math.min(scroll, shopMax));
        // El contenido, recortado a la caja (debajo del puesto)
        scrollBegin(BX + 3, top, BW - 6, BH - SH - 7, scroll);
        const Y = y => top + y - scroll;
        text(T('Tienda Kecleon'), BX + 18, Y(10), 20, '#fff', 'left', true);
        btn(BX + BW - 72, Y(10), 56, 22, T('Volver'), 'ghost', false, 10);
        wrap(T('¡Bienvenido! Mentas, Cápsulas y MT. Lo que compres va a tu Mochila (en el menú principal); úsalo desde la ficha de cada Pokémon en la colección.'), BW - 40, 10)
          .forEach((l, i) => text(l, BX + 18, Y(40 + i * 13), 10, C.muted));
        for (const { g, y, subL } of pos.heads) {
          let hx = BX + 18;
          if (g.ico) { icon(g.ico, hx, Y(y) - 1, 18); hx += 22; }
          h3(g.title, hx, Y(y));
          subL.forEach((l, i) => text(l, BX + 18, Y(y + 20 + i * 12), 9, C.muted));
          if (g.ico === 'witch') {
            const have = (s.bag && s.bag.candy) || 0, ty = Y(y + 20 + subL.length * 12 + 2);
            icon('candy', BX + 18, ty - 2, 12); text(G.I18n.f('Tienes {x} caramelos', have.toLocaleString()), BX + 34, ty, 9.5, C.gold, 'left', true);
          }
        }
        const partner = s.partner;
        k.forEach((key, i) => {
          const { x, y } = pos[i], on = i === sel;
          if (Y(y) > vBot || Y(y) + IH < vTop) return;
          if (key.startsWith('skin:')) {
            const id = key.slice(5), sk = G.Skins.SKINS[id], got = G.Skins.owns(s, id), name = nameOf(sk.dex), P = G.Halloween.SKIN_PRICE;
            const have = (s.bag && s.bag.candy) || 0;
            const desc = !got ? G.I18n.f(sk.dex === 94 ? 'Sombrero y capa de bruja para {x}.' : 'Sombrero de bruja para {x}.', name)
              : G.DB.owns(sk.dex) ? T('Comprada. Póntela o quítatela en la ficha del Pokémon.') : G.I18n.f('Comprada. Se pone cuando tengas a {x}.', name);
            upgCard(x, Y(y), IH, { ico: 'witch', title: T(sk.name), on, desc, right: got ? T('Comprada') : null, focus: () => { sel = i; } });
            // El Pokémon con su disfraz (canvas data-skin-pv de la web), encima del icono.
            rr(x + 4, Y(y) + 4, 36, IH - 8, 6); ctx.fillStyle = '#141b33'; ctx.fill();
            monBox(sk.dex, x + 4, Y(y) + 4, 36, IH - 8, 1, 0, false, 0, id);
            if (!got) btn(x + UW - 72, Y(y) + IH / 2 - 12, 62, 24, String(P), have >= P ? 'gold' : 'off', on, 10, 'candy');
          } else if (key.startsWith('tm:')) {
            const id = key.slice(3), m = G.Moves.BY_ID[id], fits = partner && G.Mons.canLearn(partner, id);
            const cat = G.Stats.label(m);
            const chips = [[G.U.TYPE_NAME[m.type], G.U.TYPE_COLOR[m.type]]];
            if (cat) chips.push([T(cat), 'rgba(0,0,0,0.35)', '#fff']);
            upgCard(x, Y(y), IH, { ico: 'move:' + id, title: T('MT') + ' ' + moveName(id), chips, on, focus: () => { sel = i; },
              extra: G.Shop.tmCount(id) ? '· ' + G.I18n.f('tienes {x}', G.Shop.tmCount(id)) : '',
              desc: fits ? G.I18n.f('{x} la puede aprender', nameOf(partner)) : partner && G.Mons.taught(partner).includes(id) ? G.I18n.f('{x} ya la sabe', nameOf(partner)) : T(m.desc),
              descCol: fits ? C.gold : null, price: G.Shop.tmPrice(id) });
          } else {
            const it = G.Shop.ITEMS[key];
            upgCard(x, Y(y), IH, { ico: it.icon, title: T(it.name), on, focus: () => { sel = i; }, extra: G.Shop.count(key) ? '· ' + G.I18n.f('tienes {x}', G.Shop.count(key)) : '',
              desc: T(it.desc), price: it.price });
          }
        });
        scrollEnd();
        topbar();
        hints([['lr', 'Mover'], ['x', 'Comprar'], ['s', 'Mochila'], ['o', 'Volver']]);
      },
      // El puesto se mueve: se pinta cada fotograma, encima (recortado a la caja por arriba).
      live() {
        const scv = document.getElementById('shop-scene');
        ctx.save();
        rr(BX + 2, BY + 2, BW - 4, SH, 7); ctx.clip();
        ctx.imageSmoothingEnabled = false;
        ctx.fillStyle = '#6fb8f0'; ctx.fillRect(BX + 2, BY + 2, BW - 4, SH);
        ctx.drawImage(scv, 0, 0, scv.width, scv.height, BX + 2, BY + 2, BW - 4, SH);
        if (sign.classList.contains('shown') || sign.classList.contains('show')) {
          font(13.5); const sw = ctx.measureText(T('Tienda Kecleon')).width + 24, sx = BX + BW / 2 - sw / 2, sy = BY + 2 + (parseFloat(sign.style.top) || 6) * SH / scv.height;
          rr(sx, sy + 2, sw, 24, 3); ctx.fillStyle = '#5a3412'; ctx.fill();
          rr(sx, sy, sw, 24, 3); ctx.fill(); rr(sx + 2, sy + 2, sw - 4, 20, 2); ctx.fillStyle = '#e2b26a'; ctx.fill();
          text(T('Tienda Kecleon'), sx + sw / 2, sy + 6, 13.5, '#3a1f08', 'center', false, null);
        }
        if (!bubble.classList.contains('hide') && bubble.textContent) {
          font(10); const bw = ctx.measureText(bubble.textContent).width + 16;
          const bx = Math.max(BX + 6, Math.min(BX + BW - bw - 6, BX + 2 + (parseFloat(bubble.style.left) || 0) * (BW - 4) / scv.width - bw + 16)), by = BY + 2 + (parseFloat(bubble.style.top) || 0) * SH / scv.height;
          rr(bx, by, bw, 22, 8); ctx.fillStyle = '#1b1528'; ctx.fill(); rr(bx + 2, by + 2, bw - 4, 18, 6); ctx.fillStyle = '#f4f8ff'; ctx.fill();
          ctx.beginPath(); ctx.moveTo(bx + bw - 1, by + 6); ctx.lineTo(bx + bw + 7, by + 11); ctx.lineTo(bx + bw - 1, by + 15); ctx.fillStyle = '#1b1528'; ctx.fill();
          text(bubble.textContent, bx + 8, by + 6, 10, '#1b1528', 'left', false, null);
        }
        ctx.restore();
      },
      input(ev) {
        const k = keys();
        if (ev.dx || ev.dy) {
          // Rejilla de 3 por grupo: ↑↓ a la misma columna de la fila de arriba o abajo (o del grupo de al lado).
          const pos = layout();
          let i = sel + ev.dx;
          if (ev.dy) {
            const me = pos[sel], rows = [...new Set(pos.map(p => p.y))].sort((a, b) => a - b), r = rows.indexOf(me.y) + ev.dy;
            if (r >= 0 && r < rows.length) {
              const row = pos.map((p, n) => [p, n]).filter(([p]) => p.y === rows[r]);
              i = (row.find(([p]) => p.j % 3 === me.j % 3) || row[row.length - 1])[1];
            } else i = sel;
          }
          sel = Math.max(0, Math.min(k.length - 1, i)); follow = true; G.Audio.sfx('select');
        }
        if (ev.wheelPx) scroll = clamp(scroll + ev.wheelPx, 0, shopMax);   // (sólo la vista)
        if (ev.a && k[sel].startsWith('skin:')) {
          const r = G.Shop.buySkin(k[sel].slice(5));
          if (!r.ok) { G.Audio.sfx('error'); if (r.error) G.UI.toast(T(r.error)); }
          else { G.Audio.sfx('buy'); G.UI.toast(T('¡Feliz Halloween! Póntela en la ficha del Pokémon.')); }
        } else if (ev.a) {
          const res = G.Shop.buy(k[sel]);
          if (!res.ok) { G.Audio.sfx('error'); if (res.error) G.UI.toast(T(res.error)); }
          else { G.Audio.sfx('buy'); }
        } else if (ev.x) { G.UI.hide('scr-shop'); close(); bagScreen(shopScreen); }
        else if (ev.b) { G.Audio.sfx('back'); G.UI.hide('scr-shop'); close(); mainMenu(); }
      },
    });
  }

  function bagScreen(back = mainMenu) {
    const s = G.DB.save;
    let scroll = 0;
    const IH = 66;
    const items = () => G.Shop.ORDER.filter(id => G.Shop.count(id) > 0).concat(G.Shop.count('candy') > 0 ? ['candy'] : []);   // (Halloween)
    const tms = () => Object.keys(s.tms || {}).filter(id => G.Moves.BY_ID[id] && s.tms[id] > 0).sort((a, b) => moveName(a).localeCompare(moveName(b)));
    const empty = () => !items().length && !tms().length;
    let maxScroll = 0;
    // Las tarjetas, una vez al abrir (no cambian con la Mochila abierta): contar quién puede aprender cada MT recorría la
    // colección entera por MT en cada dibujo (80 MT × ~1000 Pokémon: medio segundo en Node, más en QuickJS) y el
    // desplazamiento iba a tirones. Cada Pokémon se mira una vez y se apuntan todas sus MT.
    const cards = [];
    if (!empty()) {
      const tl = tms(), canN = Object.fromEntries(tl.map(id => [id, 0]));
      // (canLearn rehace la lista de MT del Pokémon en cada llamada: la lista, una vez por Pokémon)
      for (const d of Object.keys(s.owned)) if (G.DEX_BY[d]) for (const id of G.Mons.learnable(+d)) if (id in canN) canN[id]++;
      for (const id of items()) { const it = G.Shop.ITEMS[id]; cards.push({ ico: it.icon, title: T(it.name), desc: T(it.desc), right: '×' + G.Shop.count(id) }); }
      for (const id of tl) {
        const n = canN[id];
        cards.push({ ico: 'move:' + id, title: T('MT') + ' ' + moveCat(id), desc: n ? G.I18n.f('La pueden aprender {x} de tus Pokémon', n) : T('Ninguno de tus Pokémon la puede aprender'), right: '×' + s.tms[id] });
      }
    }
    const iris = G.Gacha.BANNERS.map(b => {
      const d = G.Gacha.dexOf(s, b.gen), on = d.have >= d.total, name = T(b.name);
      return { ico: 'iris', dimIco: !on, title: G.I18n.f('Amuleto Iris de {x}', name),
        desc: on ? G.I18n.f('Shiny al 2 % en el banner de {x}', name) : G.I18n.f('Completa la Pokédex de {x}', name), right: on ? '2 %' : d.have + ' / ' + d.total, rightDim: !on };
    });
    const isEmpty = !cards.length;
    open({ wheel: true,
      key: () => '',
      scrollNow: () => scroll,   // (desplazar no redibuja: scrollBegin)
      draw() {
        modal('Mochila');
        const top = BY + 44;
        scrollBegin(BX + 3, top, BW - 6, BH - 47, scroll);
        let y = top + 6 - scroll;
        // (sólo las tarjetas que se pintan: las de fuera, no)
        const card = (x, yy, c) => { if (yy + IH >= vTop && yy <= vBot) upgCard(x, yy, IH, c); };
        if (isEmpty) {
          text(T('Tu Mochila está vacía.'), BX + BW / 2, y + 12, 11, C.muted, 'center');
          btn(BX + BW / 2 - 100, y + 36, 200, 28, T('Ir a la Tienda Kecleon'), 'gold', true, 11, 'shop');
          y += 82;
        } else {
          const l = wrap(T('Para usarlo, abre la colección, elige un Pokémon y pulsa Menta, Cápsula o Enseñar MT en su ficha.'), BW - 210, 10);
          l.forEach((t, i) => text(t, BX + 18, y + i * 13, 10, C.muted));
          btn(BX + BW - 178, y, 160, 24, T('Ir a la colección'), 'blue', true, 10, 'book');
          y += Math.max(l.length * 13, 28) + 8;
          cards.forEach((c, i) => card(BX + 18 + (i % 3) * (UW + UG), y + Math.floor(i / 3) * (IH + UG), c));
          y += Math.ceil(cards.length / 3) * (IH + UG) + 6;
        }
        h3('Amuletos Iris', BX + 18, y);
        y += 20;
        const sub = wrap(T('Completa la Pokédex de una región (legendarios incluidos) y te dan su Amuleto Iris: en su banner, los shiny salen el doble (del 1 % al 2 %).'), BW - 40, 9);
        sub.forEach((t, i) => text(t, BX + 18, y + i * 12, 9, C.muted));
        y += sub.length * 12 + 6;
        iris.forEach((c, i) => card(BX + 18 + (i % 3) * (UW + UG), y + Math.floor(i / 3) * (IH + UG), c));
        y += 3 * (IH + UG);
        scrollEnd();
        maxScroll = Math.max(0, y + scroll - (BY + BH - 6));
        hints([['ud', 'Desplazar'], ['x', isEmpty ? 'Ir a la Tienda Kecleon' : 'Ir a la colección'], ['o', 'Volver']]);
      },
      input(ev) {
        if (ev.dy || ev.wheelPx) scroll = Math.max(0, Math.min(maxScroll, scroll + scrollStep(ev, 60)));
        if (ev.a) { G.Audio.sfx('select'); close(); if (isEmpty) shopScreen(); else dexScreen(s.partner); }
        else if (ev.b) { G.Audio.sfx('back'); close(); back(); }
      },
    });
  }

  // El menú de la web (#scr-menu): mismo orden, iconos y subtítulos.
  const sum = o => Object.values(o || {}).reduce((a, b) => a + (+b || 0), 0);
  const MENU = [
    ['Jugar', 'ball', () => (G.Social.room ? 'Ir a la sala' : 'Entra en la mazmorra'), () => {
      if (G.Social.room) return lobbyScreen();
      G.UI.hideAll(); G.Game.startRun();
    }],
    ['Endless', 'star', () => 'Sin Arceus: aguanta todo lo que puedas', () => {
      if (G.Social.room) return lobbyScreen();   // (en grupo, sólo el modo normal)
      G.UI.hideAll(); G.Game.startRun(null, { endless: true });
    }],
    ['Pokémon', 'book', () => {
      const s = G.DB.save, owned = Object.keys(s.owned).filter(d => G.DEX_BY[d]).length, sh = Object.keys(s.shiny || {}).length;
      return owned + ' / ' + G.DEX.length + (sh ? ' · ' + sh + ' shiny' : '');
    }, () => dexScreen(G.DB.save.partner)],
    ['Mejoras', 'up', () => 'Haz más fuerte cada run', upgradesScreen],
    ['Multijugador', 'friends', () => {
      const req = G.DB.online && G.Social.started ? G.Social.friends.filter(f => f.status === 'in').length : 0;
      return req ? G.I18n.f('{x} solicitudes de amistad', req) : 'Juega en grupo, hasta 4';
    }, () => (!G.DB.online && ps.core_pads ? localCoopScreen() : friendsScreen())],   // (sin nube: el cooperativo local sigue)
    ['Tienda Kecleon', 'shop', () => 'Mentas, Cápsulas y MT', shopScreen],
    ['Mochila', 'bag', () => {
      const s = G.DB.save, candy = (s.bag && s.bag.candy) || 0, items = sum(s.bag) - candy, tms = sum(s.tms), iris = G.Gacha.BANNERS.filter(b => G.Gacha.hasIris(s, b.gen)).length, parts = [];
      if (items || tms) parts.push(G.I18n.f('Objetos: {x} · MT: {x}', items, tms));
      if (candy) parts.push(G.I18n.f('Caramelos: {x}', candy));
      if (iris) parts.push(G.I18n.f('Amuletos Iris: {x}', iris));
      return parts.join(' · ') || T('Vacía');
    }, () => bagScreen()],
    ['Gacha', 'ball4', () => '9 regiones · Pokémon y shinies', gachaScreen],
    ['Misiones', 'medal3', () => {
      let n = 0; try { G.Progress.ensure(G.DB.save); n = G.Progress.pending(); } catch (e) { /* nada */ }
      return n ? n + ' ' + T(n === 1 ? 'premio por recoger' : 'premios por recoger') : 'Misiones, logros y perfil';
    }, () => goalsScreen()],
    ['Ranking', 'trophy', () => 'Quién aguanta más', () => rankScreen()],
    ['Ajustes', 'gear', () => 'Sonido, gráficos, controles y cuenta', () => settingsScreen()],
  ];

  // ---------------- Novedades (#scr-news; los datos, js/data/changelog.js) ----------------
  function newsScreen() {
    const lang = G.I18n.lang;
    // Como news-ui.js: en español la frase original; en inglés (o si no hay traducción completa) la inglesa.
    const tx = pair => lang === 'es' ? pair[0] : lang === 'en' || !G.I18n.has(pair[0]) ? pair[1] : T(pair[0]);
    const MONTHS = { es: ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'],
                     en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] };
    const fmt = d => {
      const [y, m, day] = d.split('-').map(Number);
      try { return new Date(y, m - 1, day).toLocaleDateString(G.I18n.locale, { day: 'numeric', month: 'long', year: 'numeric' }); }
      catch (e) { return lang === 'es' ? day + ' de ' + MONTHS.es[m - 1] + ' de ' + y : MONTHS.en[m - 1] + ' ' + day + ', ' + y; }
    };
    const PARTS = [['new', ['Nuevo', 'New'], '#5fe08a'], ['chg', ['Cambios', 'Changes'], '#4fb4ff'], ['fix', ['Arreglos', 'Fixes'], '#ffb347']];
    const BW2 = 480, X = (W - BW2) / 2, Y = 48, BH2 = H - Y - 40, TW = BW2 - 60;
    // El texto partido en líneas, [y, tipo, texto, color], fecha a fecha según se va bajando: partir todo
    // el historial de golpe tardaba más de un segundo.
    const ops = [];
    let y = 0, done = 0;
    const build = upTo => { while (done < NEWS.length && y < upTo) addDay(NEWS[done++]); };
    const addDay = v => {
      y += 12;
      if (v.title) for (const l of wrap(tx(v.title), TW, 13.5, true)) { ops.push([y, 'h', l]); y += 17; }
      ops.push([y, 'd', fmt(v.d) + (v.v ? '  ·  v' + v.v : '')]); y += 16;
      for (const [k, lbl, col] of PARTS) {
        if (!v[k] || !v[k].length) continue;
        ops.push([y, 'tag', tx(lbl), col]); y += 18;
        for (const t of v[k]) {
          wrap(tx(t), TW - 14, 11).forEach((l, i) => { ops.push([y, i ? 'li' : 'li0', l]); y += 14.5; });
          y += 3;
        }
      }
      ops.push([y + 2, 'hr']); y += 8;
    };
    let scroll = 0;
    try { localStorage.setItem('ps.news.seen', NEWS[0].d || ''); } catch (e) { /* nada */ }
    const total = () => done < NEWS.length ? y * NEWS.length / done : y;   // aproximado mientras falte
    open({ wheel: true,
      key: () => '',
      scrollNow: () => scroll,   // (desplazar no redibuja: scrollBegin)
      draw() {
        build(scroll + BH2 + 200 + SPAD);
        dim(); box(X, Y, BW2, BH2);
        text(T('Novedades'), X + 18, Y + 16, 19.5, '#fff', 'left', true);
        btn(X + BW2 - 72, Y + 14, 56, 22, T('Cerrar'), 'ghost', false, 10);
        const top = Y + 46, vh = BH2 - 52;
        scrollBegin(X + 3, top, BW2 - 6, vh, scroll);
        for (const [oy, kind, t, col] of ops) {
          const yy = top + oy - scroll;
          if (yy < vTop - 20 || yy > vBot) continue;
          if (kind === 'h') text(t, X + 18, yy, 13.5, C.gold, 'left', true);
          else if (kind === 'd') text(t, X + 18, yy, 9.75, C.muted);
          else if (kind === 'tag') { font(9, true); const w = ctx.measureText(t).width + 12; rr(X + 18, yy, w, 14, 3); ctx.fillStyle = col; ctx.fill(); text(t, X + 24, yy + 2.5, 9, '#0b1020', 'left', true, null); }
          else if (kind === 'hr') { ctx.fillStyle = 'rgba(255,255,255,0.1)'; ctx.fillRect(X + 18, yy, TW + 24, 1); }
          else { if (kind === 'li0') { ctx.fillStyle = '#fff'; ctx.fillRect(X + 22, yy + 5, 3, 3); } text(t, X + 32, yy, 11, '#fff'); }
        }
        scrollEnd();
        topbar('news');
        hints([['ud', 'Desplazar'], ['o', 'Cerrar']]);
      },
      // La barra se mueve con el scroll, que ya no redibuja: cada fotograma, encima.
      live() {
        const top = Y + 46, vh = BH2 - 52, all = total();
        if (all <= vh) return;
        const bh = Math.max(20, vh * vh / all);
        rr(X + BW2 - 10, top, 4, vh, 2); ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fill();
        rr(X + BW2 - 10, top + (vh - bh) * Math.min(1, scroll / (all - vh)), 4, bh, 2); ctx.fillStyle = C.muted; ctx.fill();
      },
      input(ev) {
        const vh = BH2 - 52;
        build(scroll + vh + 260);
        const max = Math.max(0, y - vh);
        if (ev.dy || ev.wheelPx) scroll = Math.max(0, Math.min(max, scroll + scrollStep(ev, 60)));
        if (ev.b || ev.a) { G.Audio.sfx('back'); close(); mainMenu(); }
      },
    });
  }

  // ---------------- Misiones, logros y perfil (#scr-goals, js/ui/goals-ui.js) ----------------
  // El premio (rewardText de progress.js) con sus iconos; alineado a la derecha en rx. Devuelve el ancho.
  function rewardAt(r, rx, y, px = 10) {
    const parts = [];
    if (r.t10) parts.push(['ticket10', r.t10 + ' ×10']);
    if (r.t1) parts.push(['ticket', String(r.t1)]);
    if (r.coins) parts.push(['coin', r.coins.toLocaleString()]);
    font(px, true);
    const w = parts.reduce((a, [, t]) => a + ctx.measureText(t).width + px + 10, 0);
    let x = rx - w;
    for (const [ic, t] of parts) { icon(ic, x, y - 1, px + 2); text(t, x + px + 4, y, px, '#fff', 'left', true); font(px, true); x += ctx.measureText(t).width + px + 10; }
    return w;
  }
  let goalsTab = 0, achCat = 0;
  function goalsScreen(tab0) {
    if (tab0 != null) goalsTab = tab0;
    const s = G.DB.save, sh = shoulders();
    G.Progress.ensure(s); G.Progress.checkAch();
    s.profile = s.profile || { favs: [], title: '' };
    for (const f of s.profile.favs || []) if (f && G.DEX_BY[f.dex]) preIdle([f.dex], !!f.shiny);   // (monIn sólo pinta lo cargado)
    let sel = 0, scroll = 0, ver = 0, maxScroll = 0;
    const TABS = ['Misiones', 'Logros', 'Perfil'];
    const L = BX + 18, RW = BW - 36;
    const untilText = weekly => {
      const now = new Date(), end = new Date(now);
      end.setHours(24, 0, 0, 0);
      if (weekly) end.setDate(end.getDate() + (8 - (now.getDay() || 7)) % 7);
      const mins = Math.max(1, Math.round((end - now) / 60000));
      return mins >= 1440 ? Math.floor(mins / 1440) + ' d ' + Math.floor(mins % 1440 / 60) + ' h' : Math.floor(mins / 60) + ' h ' + (mins % 60) + ' min';
    };
    // Lo que se puede elegir en cada pestaña.
    const missionRows = () => s.missions.daily.map((m, i) => ({ m, i, weekly: false })).concat(s.missions.weekly.map((m, i) => ({ m, i, weekly: true })));
    // ✕ (o clic en su botón) sobre una misión: recogerla si está hecha; si no, cambiarla (una diaria, una vez).
    const missionAct = r => {
      if (!r) return;
      if (!r.m.claimed && G.Progress.done(r.m)) { if (G.Progress.claim(r.m, r.weekly)) { G.Audio.sfx('buy'); G.UI.toast(T('¡Premio recogido!')); ver++; } }
      else if (!r.weekly && !s.missions.rerolled && !r.m.claimed) { if (G.Progress.reroll(r.i)) { G.Audio.sfx('select'); ver++; } }
    };
    const claimable = () => missionRows().filter(r => !r.m.claimed && G.Progress.done(r.m));
    const claimAll = () => {   // «Recoger todo» (□ o su botón)
      const n = claimable().filter(r => G.Progress.claim(r.m, r.weekly)).length;
      if (n) { G.Audio.sfx('buy'); G.UI.toast(G.I18n.f('¡{x} premios recogidos!', n)); ver++; }
    };
    const profileRows = () => [0, 1, 2].map(i => ({ fav: i })).concat([{ title: true }, { preview: true }]);
    const rowsN = () => goalsTab === 0 ? missionRows().length : goalsTab === 2 ? profileRows().length : 0;
    const nextTitle = d => {
      const P = s.profile, titles = [''].concat(G.Progress.titles()), i = titles.indexOf(P.title || '');
      P.title = titles[(i + d + titles.length) % titles.length]; G.DB.commit(); G.Audio.sfx('select'); ver++;
    };
    if (goalsTab === 1) thumbsPump();
    open({ wheel: true,
      key: () => goalsTab + '|' + sel + '|' + scroll + '|' + achCat + '|' + ver + '|' + (goalsTab === 1 && !thumbs.done ? thumbs.loaded : ''),
      draw() {
        modal('Misiones');
        // Pestañas (.tabs)
        const tw = (RW - 60) / 3;
        padIcon('l1', L + 12, BY + 58);
        TABS.forEach((t, i) => {
          const x = L + 28 + i * (tw + 4), on = i === goalsTab;
          tabHot(x, BY + 46, tw, 24, i - goalsTab);   // (ratón)
          rr(x, BY + 46, tw, 24, 6); ctx.fillStyle = on ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.2)'; ctx.fill();
          ctx.strokeStyle = on ? C.edge : 'transparent'; ctx.lineWidth = 1.5; ctx.stroke();
          text(T(t), x + tw / 2, BY + 52, 11, '#fff', 'center', true);
        });
        padIcon('r1', L + 28 + 3 * (tw + 4) + 10, BY + 58);
        const top = BY + 80, vh = BH - 86;
        ctx.save(); rr(BX + 3, top, BW - 6, vh, 4); ctx.clip();
        let y = top + 4 - scroll;
        const hh = [['ud', 'Mover']];
        if (goalsTab === 0) {
          // Misiones: diarias y semanales, con barra, premio y Recoger / Cambiar.
          let k = 0;
          const nc = claimable().length;
          if (nc) {
            font(10, true); const lab = T('Recoger todo') + ' (' + nc + ')', bw2 = ctx.measureText(lab).width + 44;
            // (con la cruceta también: es la fila -1, encima de la primera misión; antes sólo □ o el clic)
            btn(L + RW - bw2, y - 4, bw2, 22, lab, 'gold', sel === -1, 10);
            hot(L + RW - bw2, y - 4, bw2, 22, sel === -1, claimAll, () => { sel = -1; });
            if (sel === -1) ring(L + RW - bw2, y - 4, bw2, 22, 9);
            y += 26;
          }
          for (const [title, list, weekly] of [['Diarias', s.missions.daily, false], ['Semanales', s.missions.weekly, true]]) {
            text(T(title), L, y, 13.5, '#fff', 'left', true);
            text(G.I18n.f('Se renuevan en {x}', untilText(weekly)), L + RW, y + 3, 9.5, C.muted, 'right');
            y += 22;
            list.forEach((m, i) => {
              const d = G.MissionDefs.BY[m.id], done = G.Progress.done(m), on = k === sel, h = 50;
              const kk = k; hot(L, y, RW, h, on, null, () => { sel = kk; });   // (ratón: foco directo)
              ctx.globalAlpha = m.claimed ? 0.55 : 1;
              rr(L, y, RW, h, 7); ctx.fillStyle = done && !m.claimed ? 'rgba(255,210,63,0.1)' : 'rgba(0,0,0,0.22)'; ctx.fill();
              ctx.strokeStyle = on ? C.gold : done && !m.claimed ? C.gold : 'rgba(244,248,255,0.14)'; ctx.lineWidth = on ? 2.5 : 1.5; ctx.stroke();
              text(T(strip(G.Progress.text(m))), L + 10, y + 7, 11, '#fff', 'left', true);
              rr(L + 10, y + 25, RW - 280, 5, 3); ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fill();
              rr(L + 10, y + 25, Math.max(3, (RW - 280) * Math.min(1, m.prog / m.goal)), 5, 3); ctx.fillStyle = C.gold; ctx.fill();
              text(Math.min(m.prog, m.goal).toLocaleString() + ' / ' + m.goal.toLocaleString(), L + 10, y + 34, 9, C.muted);
              rewardAt(d.reward, L + RW - 100, y + 19);
              const [lbl, kind] = m.claimed ? ['Recogido', 'off'] : done ? ['Recoger', 'gold'] : !weekly && !s.missions.rerolled ? ['Cambiar', 'ghost'] : ['En curso', 'off'];
              btn(L + RW - 88, y + 13, 78, 24, T(lbl), kind, on && kind !== 'off' && kind !== 'ghost', 10);
              if (kind !== 'off') { const kk = k; hot(L + RW - 88, y + 13, 78, 24, false, () => { sel = kk; missionAct(missionRows()[kk]); }); }
              if (on && kind === 'ghost') { rr(L + RW - 91, y + 10, 84, 30, 9); ctx.strokeStyle = C.gold; ctx.lineWidth = 2; ctx.stroke(); }
              ctx.globalAlpha = 1;
              y += h + 6; k++;
            });
            y += 8;
          }
          if (sel === -1 && !nc) sel = 0;   // (ya no queda nada que recoger)
          const r = missionRows()[sel];
          if (sel === -1) hh.push(['x', 'Recoger todo']);
          else if (r && !r.m.claimed && G.Progress.done(r.m)) hh.push(['x', 'Recoger']);
          else if (r && !r.weekly && !s.missions.rerolled && !r.m.claimed) hh.push(['x', 'Cambiar']);
          if (nc) hh.push(['s', 'Recoger todo']);
        } else if (goalsTab === 1) {
          // Logros: por categoría (□), en dos columnas; los legendarios, uno a uno con su sprite.
          const all = G.AchDefs.LIST, got = all.filter(a => s.ach && s.ach[a.id]).length;
          text(G.I18n.f('{x} de {x} logros', got, all.length) + ' · ' + T('títulos') + ': ' + G.Progress.titles().length, L, y, 10, C.muted);
          y += 18;
          let cx = L;
          padIcon('s', cx + 8, y + 10, 8); cx += 20;
          G.AchDefs.CATS.forEach(([k, label], i) => {
            const list = all.filter(a => a.cat === k), n = list.filter(a => s.ach && s.ach[a.id]).length, t = T(label) + ' ' + n + '/' + list.length;
            font(10); const w = ctx.measureText(t).width + 16;
            if (cx + w > L + RW) { cx = L + 20; y += 24; }
            const cw = chip(cx, y, t, i === achCat); hot(cx, y, cw, 20, false, () => { achCat = i; scroll = 0; }); cx += cw + 5;   // (ratón)
          });
          y += 30;
          const cat = G.AchDefs.CATS[achCat][0], list = all.filter(a => a.cat === cat && !a.dex), CW2 = (RW - 8) / 2;
          list.forEach((a, i) => {
            const ok = !!(s.ach && s.ach[a.id]), v = Math.min(a.goal, a.value(s)), x = L + (i % 2) * (CW2 + 8), yy = y + Math.floor(i / 2) * 66;
            rr(x, yy, CW2, 60, 7); ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.fill(); ctx.strokeStyle = ok ? 'rgba(255,210,63,0.6)' : 'rgba(244,248,255,0.1)'; ctx.lineWidth = 1.5; ctx.stroke();
            icon(ok ? 'medal' + a.tier : 'medalOff', x + 8, yy + 14, 28);
            text(T(a.name), x + 44, yy + 6, 11, '#fff', 'left', true);
            wrap(T(a.desc), CW2 - 54, 9).slice(0, 1).forEach(l => text(l, x + 44, yy + 21, 9, C.muted));
            if (!ok) { rr(x + 44, yy + 35, CW2 - 54, 4, 2); ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fill(); rr(x + 44, yy + 35, Math.max(2, (CW2 - 54) * v / a.goal), 4, 2); ctx.fillStyle = C.gold; ctx.fill(); }
            const st = ok ? T('¡Conseguido!') : v.toLocaleString() + ' / ' + a.goal.toLocaleString();
            text(st, x + 44, yy + 44, 9, ok ? C.gold : '#fff');
            font(9); rewardAt(a.reward, x + CW2 - 8, yy + 44, 9);
          });
          y += Math.ceil(list.length / 2) * 66 + 6;
          if (cat === 'legendarios') {
            const legs = all.filter(a => a.dex), beaten = legs.filter(a => s.legends && s.legends[a.dex]).length;
            text(T('Legendarios vencidos') + ' ' + beaten + ' / ' + legs.length, L, y, 13.5, '#fff', 'left', true);
            y += 22;
            const cols = 9, cw = RW / cols;
            legs.forEach((a, i) => {
              const ok = !!(s.legends && s.legends[a.dex]), x = L + (i % cols) * cw, yy = y + Math.floor(i / cols) * 66;
              rr(x + 2, yy, cw - 4, 60, 7); ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fill(); if (ok) { ctx.strokeStyle = 'rgba(255,210,63,0.5)'; ctx.lineWidth = 1.5; ctx.stroke(); }
              thumbIn(a.dex, x + 2, yy + 2, cw - 4, 44, 1, !ok);
              text(ok ? G.DEX_BY[a.dex].name : '???', x + cw / 2, yy + 47, 8, C.muted, 'center');
            });
            y += Math.ceil(legs.length / cols) * 66;
          }
          hh[0] = ['ud', 'Desplazar']; hh.push(['s', 'Categoría']);
        } else {
          // Perfil: 3 favoritos, título y la vista del perfil público.
          const P = s.profile;
          text(T('Tu perfil se publica cuando juegas con una cuenta online.'), L, y, 10, C.muted); y += 20;
          text(T('Tus 3 Pokémon favoritos'), L, y, 13.5, '#fff', 'left', true); y += 22;
          for (let i = 0; i < 3; i++) {
            const f = P.favs[i], x = L + i * 132, on = sel === i;
            hot(x, y, 120, 100, on, () => { sel = i; close(); favPicker(i); }, () => { sel = i; });   // (clic: elegir ese favorito)
            rr(x, y, 120, 100, 9); ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.fill();
            ctx.setLineDash(f ? [] : [5, 4]); ctx.strokeStyle = on ? C.gold : 'rgba(244,248,255,0.3)'; ctx.lineWidth = on ? 2.5 : 1.5; ctx.stroke(); ctx.setLineDash([]);
            if (f && G.DEX_BY[f.dex]) text((f.shiny ? '★ ' : '') + G.DEX_BY[f.dex].name, x + 60, y + 84, 10, '#fff', 'center', true);
            else text(T('Elegir'), x + 60, y + 44, 11, C.muted, 'center');
          }
          y += 112;
          text(T('Título'), L, y, 13.5, '#fff', 'left', true); y += 22;
          const titles = [''].concat(G.Progress.titles()), tcur = P.title || '';
          font(11, true); const tlab = tcur || T('(sin título)'), w = Math.max(220, ctx.measureText(tlab).width + 50);
          rr(L, y, w, 26, 13); ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fill(); ctx.strokeStyle = sel === 3 ? C.gold : 'rgba(244,248,255,0.25)'; ctx.lineWidth = 1.5; ctx.stroke();
          text('‹', L + 10, y + 6, 12, sel === 3 ? C.gold : C.muted, 'left', true); text('›', L + w - 10, y + 6, 12, sel === 3 ? C.gold : C.muted, 'right', true);
          text(tlab, L + w / 2, y + 7, 11, sel === 3 ? C.gold : '#fff', 'center', true);
          // (clic: ‹ el anterior, el resto el siguiente)
          hot(L, y, w, 26, sel === 3, null, () => { sel = 3; });   // (foco directo: la cruceta y el ratón la eligen)
          hot(L, y, 30, 26, false, () => { sel = 3; nextTitle(-1); });
          hot(L + 30, y, w - 30, 26, false, () => { sel = 3; nextTitle(1); });
          if (titles.length < 2) text(T('Consigue logros para desbloquear títulos.'), L + w + 12, y + 8, 9.5, C.muted);
          y += 40;
          btn(L, y, 200, 30, T('Ver mi perfil público'), 'gold', sel === 4, 11, undefined, () => { sel = 4; });
          hot(L, y, 200, 30, false, () => { sel = 4; close(); publicProfile(G.Social.profileData(), () => goalsScreen(2)); });
          y += 40;
          hh.push(sel < 3 ? ['x', 'Elegir'] : sel === 3 ? ['lr', 'Cambiar'] : ['x', 'Ver mi perfil público']);
        }
        ctx.restore();
        maxScroll = Math.max(0, y + scroll - (top + vh) + 8);
        hh.push(['o', 'Volver']);
        hints(hh);
      },
      live(now) {
        if (goalsTab === 1 && !thumbs.done) thumbsPump();
        if (goalsTab !== 2) return;
        const top = BY + 80, y = top + 4 - scroll + 42;
        ctx.save(); rr(BX + 3, top, BW - 6, BH - 86, 4); ctx.clip();
        s.profile.favs.slice(0, 3).forEach((f, i) => { if (f && G.DEX_BY[f.dex]) monIn(f.dex, L + i * 132, y, 120, 80, 2, now, { shiny: !!f.shiny }); });
        ctx.restore();
      },
      input(ev) {
        const g = sh();
        if (g) { goalsTab = (goalsTab + g + 3) % 3; sel = 0; scroll = 0; if (goalsTab === 1) thumbsPump(); G.Audio.sfx('select'); }
        if (ev.b) { G.Audio.sfx('back'); close(); mainMenu(); return; }
        if (ev.wheelPx && goalsTab !== 1) scroll = clamp(scroll + ev.wheelPx, 0, maxScroll);   // (Misiones y Perfil: sólo la vista)
        if (goalsTab === 1) {
          if (ev.dy || ev.wheelPx) scroll = Math.max(0, Math.min(maxScroll, scroll + scrollStep(ev, 60)));
          if (ev.x) { achCat = (achCat + 1) % G.AchDefs.CATS.length; scroll = 0; G.Audio.sfx('select'); }
          return;
        }
        const n = rowsN(), lo = goalsTab === 0 && claimable().length ? -1 : 0, cnt = n - lo;   // (-1: «Recoger todo»)
        if (ev.dy && n) {
          sel = ((sel - lo + ev.dy) % cnt + cnt) % cnt + lo; G.Audio.sfx('select');
          // que se vea lo elegido (las misiones: 56 por fila más los títulos)
          if (goalsTab === 0) { const yy = sel < 0 ? 0 : sel * 56 + (sel >= s.missions.daily.length ? 52 : 22) + (lo ? 26 : 0); if (yy < scroll) scroll = yy; else if (yy + 60 > scroll + BH - 90) scroll = yy + 60 - (BH - 90); }
        }
        if (goalsTab === 0) {
          if (ev.a && sel === -1) claimAll();
          else if (ev.a) missionAct(missionRows()[sel]);
          else if (ev.x) claimAll();
        } else {
          if (sel === 3 && ev.dx) nextTitle(ev.dx);
          if (ev.a && sel < 3) { G.Audio.sfx('select'); close(); favPicker(sel); }
          else if (ev.a && sel === 4) { G.Audio.sfx('select'); close(); publicProfile(G.Social.profileData(), () => goalsScreen(2)); }
        }
      },
    });
  }

  // Elegir un favorito del perfil: en la Pokédex (buscador, filtros), como Mejoras → Cambiar Pokémon. Si tienes su shiny,
  // luego se pregunta cuál.
  function favPicker(slot) {
    const s = G.DB.save, P = s.profile, back = () => goalsScreen(2), cur = (P.favs || [])[slot];
    const put = (dex, shiny) => {
      P.favs = (P.favs || []).slice(); P.favs[slot] = { dex, shiny };
      P.favs = P.favs.filter(Boolean).slice(0, 3);
      G.DB.commit(); G.Audio.sfx('confirm'); back();
    };
    dexScreen(cur ? cur.dex : s.partner, d => {
      if (!d) return back();
      if (!G.DB.ownsShiny(d)) return put(d, false);
      shinyPick(d, sh => (sh == null ? back() : put(d, sh)));
    });
  }
  // Normal o shiny: los dos, animados, cada uno sobre su panel y con su botón (clic, ←→, 1/2). done(true | false | null).
  function shinyPick(dex, done) {
    const BW3 = 480, BH3 = 270, X3 = (W - BW3) / 2, Y3 = (H - BH3) / 2, OPT = [['Normal', false], ['Shiny', true]];
    let sel = 0;
    preIdle([dex], false); preIdle([dex], true);   // (monIn sólo pinta las hojas ya cargadas)
    const pick = i => { G.Audio.sfx('confirm'); close(); done(OPT[i][1]); };
    open({
      key: () => String(sel),
      draw() {
        centerBox(BW3, BH3, T('¿Normal o shiny?'), G.DEX_BY[dex].name);
        OPT.forEach(([l, sh], i) => {
          const px = X3 + 20 + i * 230;
          stage(px, Y3 + 66, 210, 140, sh ? '#9ae6ff' : C.edgeIn, sh);
          hot(px, Y3 + 66, 210, 140, sel === i, () => pick(i), () => { sel = i; });   // (el panel: clic elige)
          btn(px, Y3 + 218, 210, 32, T(l), sel === i ? 'gold' : 'blue', sel === i, 12, sh ? 'shiny' : undefined, () => { sel = i; });
        });
        hints([['lr', 'Mover'], ['x', 'Elegir'], ['o', 'Volver']]);
      },
      live(now) { OPT.forEach(([, sh], i) => monIn(dex, X3 + 20 + i * 230, Y3 + 66, 210, 140, 2, now, { shiny: sh })); },
      input(ev) {
        if (ev.dx) { sel = 1 - sel; G.Audio.sfx('select'); }
        if (ev.num && ev.num <= 2) return pick(ev.num - 1);
        if (ev.a) return pick(sel);
        if (ev.b) { G.Audio.sfx('back'); close(); done(null); }
      },
    });
  }

  // El perfil público (el #scr-profile de la web vieja): nombre, título, favoritos, marcas y medallas.
  function publicProfile(d, back) {
    const b = d.best || {}, fmtT = t => (t >= 3600 ? Math.floor(t / 3600) + ':' + G.U.mmss(t % 3600).padStart(5, '0') : G.U.mmss(t));
    const BW2 = 520, X = (W - BW2) / 2, Y = 40, BH2 = H - 80;
    const favs = (d.favs || []).filter(f => G.DEX_BY[f.dex]).slice(0, 3);
    preIdle(favs.filter(f => !f.shiny).map(f => f.dex)); favs.filter(f => f.shiny).forEach(f => preIdle([f.dex], true));
    open({
      key: () => 'p',
      draw() {
        dim(); box(X, Y, BW2, BH2);
        btn(X + BW2 - 72, Y + 14, 56, 22, T('Cerrar'), 'ghost', false, 10);
        text(d.name || '???', X + 18, Y + 16, 19.5, '#fff', 'left', true);
        if (d.title) { font(19.5, true); text(d.title, X + 26 + ctx.measureText(d.name || '???').width, Y + 22, 11, C.gold, 'left', true); }
        if (!favs.length) text(T('Sin favoritos todavía.'), X + 18, Y + 60, 10, C.muted);
        favs.forEach((f, i) => { const x = X + 18 + i * 132; rr(x, Y + 48, 120, 100, 9); ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.fill(); ctx.strokeStyle = 'rgba(255,210,63,0.55)'; ctx.lineWidth = 1.5; ctx.stroke();
          text((f.shiny ? '★ ' : '') + G.DEX_BY[f.dex].name, x + 60, Y + 132, 10, '#fff', 'center', true); });
        const marks = [['Mejor tiempo', fmtT(b.solo || 0)], ['En grupo', fmtT(b.group || 0)], ['Nivel máximo', b.level || 0],
                       ['Jefes', (b.bosses || 0).toLocaleString()], ['Legendarios', b.legends || 0], ['Derrotados', (b.kills || 0).toLocaleString()]];
        const cw = (BW2 - 36 - 12) / 3;
        marks.forEach(([k, v], i) => {
          const x = X + 18 + (i % 3) * (cw + 6), y = Y + 160 + Math.floor(i / 3) * 50;
          rr(x, y, cw, 44, 7); ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.fill();
          text(T(k).toUpperCase(), x + 8, y + 6, 8.5, C.muted); text(String(v), x + 8, y + 20, 15, '#fff', 'left', true);
        });
        let y = Y + 268;
        text(T('Medallas'), X + 18, y, 13.5, '#fff', 'left', true); font(13.5, true); text(String(b.medals || 0), X + 26 + ctx.measureText(T('Medallas')).width, y + 3, 10, C.muted);
        y += 24;
        const meds = (d.medals || []).map(id => G.AchDefs.BY[id]).filter(Boolean);
        if (!meds.length) text(T('Aún sin medallas.'), X + 18, y, 10, C.muted);
        meds.forEach((a, i) => {
          const x = X + 18 + (i % 4) * 120, yy = y + Math.floor(i / 4) * 52;
          if (!a.dex) icon('medal' + a.tier, x + 42, yy, 28);
          wrap(T(a.name), 112, 8.5).slice(0, 2).forEach((l, k) => text(l, x + 56, yy + 32 + k * 10, 8.5, C.muted, 'center'));
        });
        hints([['o', 'Cerrar']]);
      },
      live(now) {
        favs.forEach((f, i) => monIn(f.dex, X + 18 + i * 132, Y + 52, 120, 76, 2, now, { shiny: !!f.shiny }));
        const meds = (d.medals || []).map(id => G.AchDefs.BY[id]).filter(Boolean);
        meds.forEach((a, i) => { if (a.dex) thumbIn(a.dex, X + 18 + (i % 4) * 120 + 30, Y + 292 + Math.floor(i / 4) * 52, 52, 32, 1, false); });
      },
      input(ev) { if (ev.b || ev.a) { G.Audio.sfx('back'); close(); back(); } },
    });
  }

  // ---------------- Aviso legal (#scr-legal de dev.html) ----------------
  // El texto sale del propio dev.html (en la PS5 se lee el archivo; en el navegador, el DOM) y se traduce trozo
  // a trozo entre etiquetas, con las mismas claves que usa la web (i18n.js, doText). Sin copias que se desfasen.
  function legalBlocks() {
    let h = '';
    try {
      if (ps.readFile) { const f = ps.readFile(ps.ROOT + '/game/index.html') || ps.readFile(ps.ROOT + '/game/dev.html') || ''; const a = f.indexOf('id="scr-legal"'); h = a < 0 ? '' : f.slice(a, f.indexOf('</section>', a)); }
      if (!h) h = (document.getElementById('scr-legal') || {}).innerHTML || '';
    } catch (e) { h = ''; }
    const out = [];
    for (const m of h.matchAll(/<(h3|p)[^>]*>([\s\S]*?)<\/\1>/g)) {
      const parts = m[2].split(/<[^>]+>/).map(t => t.replace(/\s+/g, ' ')).filter(t => t.trim());
      const txt = parts.map(t => { const tt = t.trim(), r = T(tt); return t.replace(tt, r); }).join('').replace(/\s+/g, ' ').trim();
      if (txt) out.push([m[1], txt]);
    }
    return out;
  }
  function legalScreen(back = mainMenu) {
    const blocks = legalBlocks(), BW2 = 520, X = (W - BW2) / 2, Y = 40, BH2 = H - 80, TW = BW2 - 40;
    const lines = [];
    let y = 0;
    for (const [tag, t] of blocks) {
      if (tag === 'h3') { y += 6; lines.push([y, 'h', t]); y += 22; }
      else { for (const l of wrap(t, TW, 10.5)) { lines.push([y, 'p', l]); y += 14; } y += 8; }
    }
    const total = y;
    let scroll = 0;
    open({ wheel: true,
      key: () => String(scroll),
      draw() {
        dim(); box(X, Y, BW2, BH2);
        text(T('Aviso legal'), X + 18, Y + 16, 19.5, '#fff', 'left', true);
        btn(X + BW2 - 72, Y + 14, 56, 22, T('Cerrar'), 'ghost', false, 10);
        const top = Y + 48, vh = BH2 - 54;
        ctx.save(); rr(X + 3, top, BW2 - 6, vh, 4); ctx.clip();
        for (const [oy, k, t] of lines) {
          const yy = top + oy - scroll;
          if (yy < top - 20 || yy > top + vh) continue;
          text(t, X + 20, yy, k === 'h' ? 13.5 : 10.5, k === 'h' ? C.gold : '#fff', 'left', k === 'h');
        }
        ctx.restore();
        if (total > vh) {
          const bh = Math.max(20, vh * vh / total);
          rr(X + BW2 - 10, top, 4, vh, 2); ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fill();
          rr(X + BW2 - 10, top + (vh - bh) * scroll / (total - vh), 4, bh, 2); ctx.fillStyle = C.muted; ctx.fill();
        }
        hints([['ud', 'Desplazar'], ['o', 'Cerrar']]);
      },
      input(ev) {
        const max = Math.max(0, total - (BH2 - 54));
        if (ev.dy || ev.wheelPx) scroll = Math.max(0, Math.min(max, scroll + scrollStep(ev, 50)));
        if (ev.b || ev.a) { G.Audio.sfx('back'); close(); back(); }
      },
    });
  }

  // ---------------- teclado en pantalla ----------------
  // Para nombre y contraseña con el mando. ✕ escribe, □ borra, △ mayúsculas/minúsculas, OPTIONS acepta,
  // ○ cancela. done(texto) o done(null) si se cancela.
  // Con un teclado de verdad (psKeys: escritorio, tablet con teclado), el campo con el foco se escribe directamente, como
  // en la web: sin esto había que pulsar Enter para abrir el teclado y WASD movía entre filas en vez de escribir.
  // liveField(id, get, set, max) en draw(), con id = el campo con el foco (o null si la fila no es de texto).
  // Enter/Tab/Esc lo sueltan (y ya no se vuelve a coger hasta cambiar de fila); ↑/↓ lo sueltan y mueven (browser.js).
  // En Android, con psTextSink puesto, browser.js enciende el texto de SDL (ps.text_mode): las teclas llegan como texto.
  // Sin teclado de verdad, el campo se escribe igual al elegirlo (typeIn: ✕ o un toque) si hay teclado del sistema: el de la
  // pantalla de Android o el de Steam en la Steam Deck (browser.js lo saca con ps.text_mode). PS5 y Switch: keyboard().
  // Escritorio sin teclado físico (tablet Windows o Linux: ps.has_keyboard) y sin haber pulsado ninguna tecla: los campos
  // abren el teclado de la pantalla (keyboard()), aunque se elijan con el dedo o el ratón. (Steam Deck: el de Steam.)
  let kbAt = -1e9, kbHas = true;
  const noKb = () => {
    if (!CAN.keyboard || !ps.has_keyboard || globalThis.psKbSeen || globalThis.psPadType === 'steamdeck') return false;
    if (ps.now() - kbAt > 3000) { kbAt = ps.now(); kbHas = ps.has_keyboard(); }   // (ponytail: Linux lee /proc; cada 3 s basta)
    return !kbHas;
  };
  let liveOn = null, liveDone = null, liveWant = null;
  function typeIn(id) {
    if (noKb()) return false;
    if (!globalThis.psKeys && !CAN.sysKeyboard && globalThis.psPadType !== 'steamdeck') return false;
    liveWant = id; liveDone = null;
    // (ya escribiendo: el teclado de la pantalla otra vez, por si se escondió con «atrás»)
    if (globalThis.psTextSink && globalThis.psTextSink.live && ps.text_mode) ps.text_mode(true, !globalThis.psKeys);
    return true;
  }
  function liveField(id, get, set, max = 64) {
    const sink = globalThis.psTextSink;
    if (id !== liveDone) liveDone = null;
    if (id !== liveWant) liveWant = null;
    if (!id || !((globalThis.psKeys && !noKb()) || id === liveWant) || id === liveDone) {
      if (sink && sink.live) globalThis.psTextSink = null;
      liveOn = null;
      return false;
    }
    if (liveOn === id && sink && sink.live) return true;
    liveOn = id;
    const s = ch => {
      if (ch === '\n') { globalThis.psTextSink = null; liveOn = liveWant = null; liveDone = id; return; }
      const v = String(get() || '');
      set(ch === '\b' ? v.slice(0, -1) : (v + ch).slice(0, max));
    };
    s.live = true;
    globalThis.psTextSink = s;
    return true;
  }

  let showPass = false;   // panel táctil (scePad no da Create): ver u ocultar la contraseña, en el teclado y al entrar
  const KB_ROWS = ['1234567890', 'qwertyuiop', 'asdfghjklñ', 'zxcvbnm_.-', '!@#$%&*?+='];
  function keyboard(title, value, { mask = false, max = 64, back } = {}, done) {
    // El teclado del sistema, si lo hay (Switch: swkbd; ps.text_input da undefined si no): lo escrito o null (cancelado).
    const sys = ps.text_input ? ps.text_input(T(title), String(value || ''), max, mask) : undefined;
    if (sys !== undefined) { setTimeout(() => done(sys), 0); return; }
    let row = 1, col = 0, upper = false, txt = String(value || '');
    const keys = () => KB_ROWS.map(r => [...r].map(c => (upper ? c.toUpperCase() : c))).concat([['⇧', '⌫', 'OK']]);
    // Escritorio: también se escribe con el teclado del ordenador (psTextSink de browser.js). Enter acepta, Esc también
    // (browser.js no los distingue); los clics van a las teclas de la pantalla (keep).
    const sink = ch => {
      if (ch === '\n') { close(); done(txt); }
      else if (ch === '\b') txt = txt.slice(0, -1);
      else txt = (txt + ch).slice(0, max);
    };
    sink.keep = true;
    globalThis.psTextSink = sink;   // (close() lo quita)
    open({
      key: () => row + '|' + col + '|' + upper + '|' + txt + '|' + showPass,
      draw() {
        const BW2 = 520, X = (W - BW2) / 2, Y = 70;
        dim(); box(X, Y, BW2, 380);
        text(T(title), X + 18, Y + 16, 19.5, '#fff', 'left', true);
        rr(X + 18, Y + 50, BW2 - 36, 34, 7); ctx.fillStyle = '#0f1f4a'; ctx.fill(); ctx.strokeStyle = C.edgeIn; ctx.lineWidth = 2; ctx.stroke();
        const shown = mask && !showPass ? '*'.repeat(txt.length) : txt;
        asIs(() => text(shown + '_', X + 30, Y + 59, 15, '#fff'));
        text(txt.length + ' / ' + max, X + BW2 - 28, Y + 61, 10, C.muted, 'right');
        const ks = keys();
        ks.forEach((r, ri) => {
          const kw = ri === ks.length - 1 ? 150 : 44, gap = 4, rowW = r.length * (kw + gap) - gap, x0 = X + (BW2 - rowW) / 2;
          r.forEach((k, ci) => {
            const x = x0 + ci * (kw + gap), y = Y + 100 + ri * 42, on = ri === row && ci === col;
            const kind = k === 'OK' ? 'gold' : on ? 'blue' : 'ghost';
            const lab = k === '⇧' ? T(upper ? 'minúsculas' : 'MAYÚSCULAS') : k === '⌫' ? T('Borrar') : k === 'OK' ? T('Aceptar') : null;
            const press = () => { row = ri; col = ci; };
            if (lab) btn(x, y, kw, 34, lab, kind, on, 11, undefined, press);
            else asIs(() => btn(x, y, kw, 34, k, kind, on, 14, undefined, press));   // (la letra, sin traducir)
          });
        });
        hints([['x', 'Escribir'], ['s', 'Borrar'], ['t', 'Mayúsculas'], ...(mask ? [['sel', showPass ? 'Ocultar' : 'Mostrar']] : []), ['opt', 'Aceptar'], ['o', 'Cancelar']]);
      },
      input(ev) {
        const ks = keys();
        if (ev.dy) { row = (row + ev.dy + ks.length) % ks.length; col = Math.min(col, ks[row].length - 1); G.Audio.sfx('select'); }
        if (ev.dx) { col = (col + ev.dx + ks[row].length) % ks[row].length; G.Audio.sfx('select'); }
        const finish = v => { close(); done(v); };
        if (ev.a) {
          const k = ks[row][col];
          if (k === '⇧') upper = !upper;
          else if (k === '⌫') txt = txt.slice(0, -1);
          else if (k === 'OK') return finish(txt);
          else if (txt.length < max) txt += k;
          G.Audio.sfx('select');
        } else if (ev.x) { txt = txt.slice(0, -1); G.Audio.sfx('select'); }
        else if (ev.y) { upper = !upper; G.Audio.sfx('select'); }
        else if (ev.sel && mask) { showPass = !showPass; G.Audio.sfx('select'); }
        else if (ev.start) finish(txt);
        else if (ev.b) { G.Audio.sfx('back'); finish(null); }
      },
    });
  }

  // ---------------- cuenta online (la misma que en la web) ----------------
  // La consola empieza con su cuenta local ("Entrenador"). Con ps5.cloud = 1 (Ajustes → Cuenta) el juego se
  // recarga como la web del servidor (net.js) y db.js usa Firebase: misma cuenta, misma partida.
  // @step server/store data "Guardar y recargar"
  // Escribe ps.server y ps5.cloud=1 y recarga; boot.js aplica el perfil.
  // @next boot "recarga"
  const Cloud = {
    on: () => !!globalThis.psCloudOn,   // (net.js lo decide al arrancar: ps5.cloud, o la primera vez en escritorio/Android)
    set(v) {
      // La web siempre es la del servidor: «sin conexión» es jugar como invitado (sin guardar), como el botón de la web.
      if (CAN.page && !v) { if (top) close(); G.DB.playAsGuest(); return G.Flow.afterLogin(); }
      try { localStorage.setItem('ps5.cloud', v ? '1' : '0'); } catch (e) { /* nada */ } location.reload();
    },
    // La partida de la cuenta de la consola, para juntarla con la online (una vez por cuenta).
    localSave() { try { return JSON.parse(localStorage.getItem('ps.save.entrenador') || 'null'); } catch (e) { return null; } },
    imported: uid => { try { return localStorage.getItem('ps5.imported.' + uid) === '1'; } catch (e) { return true; } },
    markImported(uid) { try { localStorage.setItem('ps5.imported.' + uid, '1'); } catch (e) { /* nada */ } },
  };

  // ---------------- servidor (CLAUDE.md de la raíz, «Perfil de servidor») ----------------
  // Por defecto, el del build (PS_ENV_DEFAULT: js/env.js, de .env). El jugador puede cambiarlo por el de otra web que
  // publique <web>/pokesurvivor-server.json: se guarda en ps.server y boot.js lo mezcla con PS_ENV al arrancar.
  // ponytail: sin exportar/importar la partida entre servidores (G.Server de la web, cuando exista).
  // @step settings/server decision "Perfil de servidor"
  // Sólo existe en el port nativo (Ajustes → Cuenta de native/shim/ui.js), no en la web.
  // @sub server
  const Server = {
    custom: () => { try { return JSON.parse(localStorage.getItem('ps.server') || 'null'); } catch (e) { return null; } },
    name: () => { const p = Server.custom(); return p ? p.name : (((globalThis.PS_ENV_DEFAULT || {}).firebase || {}).projectId || '—'); },
    // Lo que llega de otro servidor se limpia: textos cortos, direcciones https. '' si va bien (y se recarga).
    // @step server/load net "Cargar servidor"
    // URL https → <web>/pokesurvivor-server.json; limpia campos (firebase, server, liveBase, nameDomain,
    // hosts, google*).
    // @next confirm "perfil válido"
    // @next acc "error (toast)"
    // @step server/confirm decision "¿Cambiar servidor?"
    // Diálogo con el foco por defecto en Cancelar.
    // @next store "sí"
    // @next acc "no"
    async load(input) {
      let url = String(input || '').trim().replace(/\/pokesurvivor-server\.json$/i, '').replace(/\/+$/, '');
      if (!url) return 'Escribe la dirección del servidor.';
      if (!/^[a-z]+:\/\//i.test(url)) url = 'https://' + url;
      const m = /^https:\/\/([a-z0-9.-]+\.[a-z]{2,})(:\d+)?(\/[^\s]*)?$/i.exec(url);
      if (!m) return 'La dirección tiene que ser https://…';
      let p;
      try {
        const r = await fetch(url + '/pokesurvivor-server.json', { cache: 'no-store' });
        if (!r.ok) return T('No se encontró el servidor') + ' (' + r.status + ')';
        p = await r.json();
      } catch (e) { return 'No se encontró el servidor'; }
      const str = v => (typeof v === 'string' && v.length <= 300 && !/[\s<>"'`]/.test(v) ? v : '');
      const https = v => (/^https:\/\/[a-z0-9.-]+(:\d+)?(\/\S*)?$/i.test(str(v)) ? str(v).replace(/\/+$/, '') : '');
      const f = (p && p.firebase) || {};
      const fb = {
        apiKey: str(f.apiKey), authDomain: str(f.authDomain), projectId: str(f.projectId), storageBucket: str(f.storageBucket),
        messagingSenderId: str(f.messagingSenderId), appId: str(f.appId), databaseURL: https(f.databaseURL),
      };
      if (!fb.apiKey || !/^[a-z0-9-]{4,40}$/.test(fb.projectId)) return 'Ese servidor no tiene una configuración válida.';
      const prof = {
        name: (typeof p.name === 'string' && p.name.trim().slice(0, 40)) || m[1],
        firebase: Object.fromEntries(Object.entries(fb).filter(([, v]) => v)),
        server: https(p.server), liveBase: https(p.liveBase),
        nameDomain: /^[a-z0-9.-]{3,80}$/i.test(str(p.nameDomain)) ? p.nameDomain : 'jugadores.invalid',
        hosts: [m[1].toLowerCase()],   // su web: el origen de las peticiones (net.js) y el permiso de db.js
        googleDesktop: p.googleDesktop && /^[\w-]+\.apps\.googleusercontent\.com$/.test(str(p.googleDesktop.clientId))
          ? { clientId: p.googleDesktop.clientId, clientSecret: str(p.googleDesktop.clientSecret) } : null,
        googleTV: p.googleTV && /^[\w-]+\.apps\.googleusercontent\.com$/.test(str(p.googleTV.clientId))
          ? { clientId: p.googleTV.clientId, clientSecret: str(p.googleTV.clientSecret) } : null,
      };
      // Lo que no se deshace solo, confirmado (CLAUDE.md, «Controles»): el foco empieza en «Cancelar» (ask). null: cancelado.
      const yes = await new Promise(done => ask('¿Cambiar de servidor?', G.I18n.f('Pasarás a «{x}» ({x}): otra cuenta online, otro ranking y otros amigos. Tu partida de aquí no se toca y puedes volver al servidor por defecto cuando quieras.', prof.name, m[1]), 'Cambiar', 'Cancelar', done));
      if (!yes) return null;
      try { localStorage.setItem('ps.server', JSON.stringify(prof)); localStorage.setItem('ps5.cloud', '1'); } catch (e) { return 'No se pudo guardar.'; }
      location.reload();
      return '';
    },
    reset() { try { localStorage.removeItem('ps.server'); } catch (e) { /* nada */ } location.reload(); },
  };

  // ---------------- la partida de la web (escritorio) ----------------
  // Abre la web original en el navegador por defecto (ps.open_url) con #ps-export=<puerto>-<código>; la web pregunta y
  // manda su partida por POST a 127.0.0.1:<puerto>/<código> (net.c, ps.net_inbox: sólo acepta el Origin de la web).
  // La partida que llega SUSTITUYE a la de aquí y, con la cuenta online, a la de la nube (se sube al momento).
  // La parte de la web (js de main-classic) está en native/CLAUDE.md, «La partida de la web».
  const WEB = 'https://pokesurvivor.com';
  const fromWebOk = () => CAN.extension && !!(ps.open_url && ps.net_inbox);
  function importFromWeb(back) {
    if (Dev.on()) { G.UI.toast(T('Con trucos no se guarda nada.')); G.Audio.sfx('error'); return back(); }
    // ponytail: Math.random (crypto del shim): el código sólo separa un pedido de otro; quien protege es el Origin.
    const code = Array.from({ length: 32 }, () => '0123456789abcdef'[Math.random() * 16 | 0]).join('');
    const port = ps.net_inbox(code, WEB);
    if (!port || !ps.open_url(WEB + '/#ps-export=' + port + '-' + code)) { G.UI.toast(T('No se pudo abrir el navegador.')); G.Audio.sfx('error'); return back(); }
    const until = Date.now() + 10 * 60e3;
    const stop = () => { clearInterval(poll); close(); };
    const poll = setInterval(() => {
      const body = ps.net_inbox_take();
      if (!body && Date.now() < until) return;
      stop();
      if (!body) return back();
      useSave(body, back);
    }, 300);
    open({
      key: () => 'web',
      draw() {
        const [x, y] = centerBox(460, 150, T('Esperando a la web…'));
        wrap(T('Se ha abierto pokesurvivor.com en tu navegador. Allí, acepta enviar tu partida al juego.'), 420, 10.5)
          .forEach((l, i) => text(l, x + 20, y + 54 + i * 14, 10.5, '#fff'));
        hints([['o', 'Cancelar']]);
      },
      input(ev) { if (ev.b) { G.Audio.sfx('back'); stop(); back(); } },
    });
  }
  // El .json que baja el botón de la extensión (chrome-export/): se arrastra a la ventana (ps.drop_take, main.c).
  const fromFileOk = () => !!ps.drop_take;
  function importFromFile(back) {
    if (Dev.on()) { G.UI.toast(T('Con trucos no se guarda nada.')); G.Audio.sfx('error'); return back(); }
    ps.drop_take();   // (lo que se arrastrara antes no vale)
    if (CAN.filePicker && !(ps.pick_file && ps.pick_file())) { G.UI.toast(T('No se pudo leer el archivo.')); G.Audio.sfx('error'); return back(); }   // (lo elegido llega por drop_take)
    const poll = setInterval(() => {
      const path = ps.drop_take();
      if (path == null) return;
      clearInterval(poll); close();
      if (path === '') { G.Audio.sfx('back'); return back(); }   // (Android: se salió del selector sin elegir)
      const body = ps.readFile(path);
      if (body == null) { G.UI.toast(T('No se pudo leer el archivo.')); G.Audio.sfx('error'); return back(); }
      useSave(body, back);
    }, 200);
    open({
      key: () => 'file',
      draw() {
        const [x, y] = centerBox(460, 150, T('Esperando el archivo…'));
        wrap(T(CAN.filePicker ? 'Elige el archivo .json de tu partida (el que baja la extensión de PokéSurvivor en pokesurvivor.com).'
                       : 'Arrastra a esta ventana el archivo .json de tu partida (el que baja la extensión de PokéSurvivor en pokesurvivor.com).'), 420, 10.5)
          .forEach((l, i) => text(l, x + 20, y + 54 + i * 14, 10.5, '#fff'));
        btn(x + 160, y + 112, 140, 26, T('Volver'), 'ghost', true, 11);   // (con el dedo no hay ○: un toque aquí vuelve)
        hints([['o', 'Cancelar']]);
      },
      input(ev) { if (ev.b) { G.Audio.sfx('back'); clearInterval(poll); close(); back(); } },
    });
  }
  // {ps:'save', save} (de la web o de un archivo): se comprueba, se pregunta y SUSTITUYE a la partida de aquí y de la nube.
  function useSave(body, back) {
    let imp = null;
    try { const m = JSON.parse(body); imp = m && m.ps === 'save' ? m.save : null; } catch (e) { /* abajo */ }
    if (!imp || typeof imp !== 'object' || Array.isArray(imp) || !imp.owned || typeof imp.owned !== 'object') {
      console.error('[web] partida no válida (' + body.length + ' bytes)');
      G.UI.toast(T('Esa partida no es válida.')); G.Audio.sfx('error'); return back();
    }
    const n = o => Object.keys((o && o.owned) || {}).length;
    ask('¿Cambiar tu partida por la de la web?', G.I18n.f('Tu partida de aquí y la de la nube se sustituyen por la de la web ({x} Pokémon; ahora tienes {x}). No se puede deshacer.', n(imp), n(G.DB.save)),
      'Sustituir', 'Cancelar', ok => {
        if (ok) {
          try {
            // Tal cual la de la web, salvo el nombre (el de esta cuenta) y la fecha (más nueva que todo lo que haya).
            const s = G.DB.save, name = s.name;
            for (const k of Object.keys(s)) delete s[k];
            Object.assign(s, JSON.parse(JSON.stringify(imp)), { name: name || imp.name, updated: Date.now() });
            G.DB.commit(true);
            console.log('[web] partida de la web: ' + n(s) + ' Pokémon');
            if (G.DB.mode === 'cloud' && !G.DB.guest) cloudSave(); else G.UI.toast(T('Partida traída de la web.'), 4000);
          } catch (e) { console.error('[web] ' + e.message); G.UI.toast(T('No se pudo guardar.')); G.Audio.sfx('error'); }
        }
        back();
      });
  }

  // ---------------- Entrar con Google (escritorio) ----------------
  // Como las apps de escritorio (RFC 8252): el navegador del sistema → Google → vuelve a http://127.0.0.1:<puerto>
  // (net.c, ps.net_inbox con origen '') con ?code; se cambia por los tokens y Firebase entra con ellos. Para no tocar
  // db.js de la web, aquí signInWithPopup hace eso: G.DB.loginWithGoogle sigue igual (openCloud incluido).
  // Cliente OAuth «App de escritorio»: PS_ENV.googleDesktop (de .env, tools/apply-env.mjs, o del servidor elegido).
  const gDesk = () => (globalThis.PS_ENV || {}).googleDesktop || null;
  // Consolas (PS5, Switch): sin navegador, el flujo para dispositivos de Google (RFC 8628) con PS_ENV.googleTV.
  const gTV = () => (globalThis.PS_ENV || {}).googleTV || null;
  // Android: el de escritorio, por el navegador del sistema. La vuelta a 127.0.0.1 la recibe y contesta el hilo de net.c
  // aunque el juego esté en segundo plano (el bucle de SDL se para, ese hilo no); al volver al juego, el JS la recoge.
  // Android puede congelar el proceso entero en segundo plano (GrapheneOS, al momento: el navegador se quedaba en
  // «Continuar»): mientras escucha, net.c pide plat_keep_alive (un servicio en primer plano). Sin cliente de escritorio,
  // el de dispositivos (QR) como antes.
  const tvMode = () => !(ps.open_url && ps.net_inbox) || (CAN.touch && !(gDesk() && gDesk().clientId));
  const googleOk = () => { const g = CAN.page ? {} : tvMode() ? gTV() : gDesk(); return !!(g && (CAN.page || g.clientId) && G.DB.fb && G.DB.fb.auth); };   // (la web: la ventana de Google de siempre)
  let googleCancel = null, googleErr = '', tvCode = null;   // tvCode: { url, code, qr } mientras se espera al móvil
  const qs = o => Object.entries(o).map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&');
  // ponytail: Math.random (crypto del shim) para state y verifier, y PKCE «plain» (no hay SHA-256 en QuickJS): el
  // código sólo vuelve a 127.0.0.1 de este ordenador. Con crypto de verdad en el shim, S256.
  const rnd = (n, abc) => Array.from({ length: n }, () => abc[Math.random() * abc.length | 0]).join('');
  function desktopGoogle() {
    return new Promise((resolve, reject) => {
      const g = gDesk(), state = rnd(32, '0123456789abcdef');
      const verifier = rnd(64, 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~');
      const fail = (m, code = 'auth/google-desktop') => { googleErr = m; reject({ code, message: m }); };
      const port = ps.net_inbox(state, '');
      if (!port) return fail(T('No se pudo abrir el navegador.'));
      const redirect = 'http://127.0.0.1:' + port;
      const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + qs({ client_id: g.clientId, redirect_uri: redirect,
        response_type: 'code', scope: 'openid email profile', state, code_challenge: verifier, code_challenge_method: 'plain',
        prompt: 'select_account' });
      if (!ps.open_url(url)) return fail(T('No se pudo abrir el navegador.'));
      const until = Date.now() + 10 * 60e3;
      let cancelled = false;
      googleCancel = () => { cancelled = true; };
      const t = setInterval(async () => {
        const back = ps.net_inbox_take();
        if (!back && !cancelled && Date.now() < until) return;
        clearInterval(t); googleCancel = null;
        if (!back) return fail('', 'auth/popup-closed-by-user');
        const p = Object.fromEntries(back.replace(/^\?/, '').split('&').map(kv => kv.split('=').map(x => decodeURIComponent(x.replace(/\+/g, ' ')))));
        if (p.state !== state || p.error || !p.code) return fail(p.error === 'access_denied' ? '' : T('Google no dejó entrar.') + (p.error ? ' (' + p.error + ')' : ''), 'auth/popup-closed-by-user');
        try {
          const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: qs({ code: p.code, client_id: g.clientId, client_secret: g.clientSecret || '', redirect_uri: redirect,
              grant_type: 'authorization_code', code_verifier: verifier }) });
          const j = await r.json();
          if (!r.ok || !j.id_token) { console.error('[google] token: ' + r.status + ' ' + (j.error || '')); return fail(T('Google no dejó entrar.') + ' (' + (j.error || r.status) + ')'); }
          resolve(firebase.auth.GoogleAuthProvider.credential(j.id_token, j.access_token));
        } catch (e) { fail(T('Sin conexión a internet.')); }
      }, 300);
    });
  }
  // El móvil abre google.com/device (QR) y escribe el código que sale aquí; mientras, se pregunta a Google cada `interval` s.
  async function tvGoogle() {
    const g = gTV(), fail = (m, code = 'auth/google-tv') => { googleErr = m; return { code, message: m }; };
    const post = async (url, o) => {
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: qs(o) });
      let j = {}; try { j = await r.json(); } catch (e) { /* sin JSON */ }
      return [r, j];
    };
    let cancelled = false;
    googleCancel = () => { cancelled = true; };
    // Espera en trocitos para que ○ cancele al momento.
    const sleep = ms => new Promise(res => { const end = Date.now() + ms, t = setInterval(() => { if (cancelled || Date.now() >= end) { clearInterval(t); res(); } }, 250); });
    try {
      let d;
      try {
        const [r, j] = await post('https://oauth2.googleapis.com/device/code', { client_id: g.clientId, scope: 'openid email profile' });
        if (!r.ok || !j.device_code) { console.error('[google] device/code: ' + r.status + ' ' + (j.error || '')); throw fail(T('Google no dejó entrar.') + ' (' + (j.error || r.status) + ')'); }
        d = j;
      } catch (e) { throw e.code ? e : fail(T('Sin conexión a internet.')); }
      const url = String(d.verification_url || d.verification_uri || 'https://www.google.com/device');
      tvCode = { url, code: String(d.user_code), qr: globalThis.psQR ? psQR(url) : null };
      const until = Date.now() + (d.expires_in || 900) * 1000;
      let wait = Math.max(5, d.interval | 0) * 1000;
      for (;;) {
        await sleep(wait);
        if (cancelled) throw fail('', 'auth/popup-closed-by-user');
        if (Date.now() > until) throw fail(T('El código caducó. Vuelve a intentarlo.'));
        let r, j;
        try { [r, j] = await post('https://oauth2.googleapis.com/token', { client_id: g.clientId, client_secret: g.clientSecret || '',
          device_code: d.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }); }
        catch (e) { continue; }   // la red falló un momento: se vuelve a preguntar
        if (cancelled) throw fail('', 'auth/popup-closed-by-user');
        if (j.id_token) return firebase.auth.GoogleAuthProvider.credential(j.id_token, j.access_token);
        if (j.error === 'authorization_pending') continue;
        if (j.error === 'slow_down') { wait += 5000; continue; }
        if (j.error === 'access_denied') throw fail('', 'auth/popup-closed-by-user');
        if (j.error === 'expired_token') throw fail(T('El código caducó. Vuelve a intentarlo.'));
        console.error('[google] token: ' + r.status + ' ' + (j.error || ''));
        throw fail(T('Google no dejó entrar.') + ' (' + (j.error || r.status) + ')');
      }
    } finally { tvCode = null; googleCancel = null; }
  }
  async function googleLogin() {
    const a = G.DB.fb.auth;
    if (!CAN.page && !a._psDesk) { a.signInWithPopup = async function () { return this.signInWithCredential(await (tvMode() ? tvGoogle() : desktopGoogle())); }; a._psDesk = true; }
    googleErr = '';
    const r = await G.DB.loginWithGoogle();
    console.log('[google] ' + (r.ok ? 'dentro' : 'no: ' + (googleErr || r.error)));
    return r.ok ? r : { ok: false, error: googleErr || r.error || '' };
  }

  function loginScreen(err = '') {
    let tab = 0, sel = 0, name = '', pass = '', busy = false, msg = err;
    const rows = () => ['name', 'pass', 'go', 'google', 'local'];
    const submit = async () => {
      if (busy) return;
      busy = true; msg = T('Conectando…');
      console.log('[cuenta] ' + (tab ? 'crear cuenta' : 'entrar') + ' (' + G.DB.mode + ')…');
      // Tope: si Firebase no contesta, que no se quede en "Conectando…" para siempre.
      const r = await Promise.race([tab ? G.DB.register(name, pass) : G.DB.login(name, pass),
        new Promise(res => setTimeout(() => res({ ok: false, error: 'No responde. Revisa la conexión y vuelve a intentarlo.' }), 20000))]);
      console.log('[cuenta] ' + JSON.stringify(r));
      busy = false;
      if (!r.ok) { msg = T(r.error || 'No se pudo entrar.'); G.Audio.sfx('error'); return; }
      G.Audio.sfx('confirm'); close(); afterCloudLogin();
    };
    open({
      key: () => tab + '|' + sel + '|' + name + '|' + pass.length + '|' + busy + '|' + msg + '|' + showPass + '|' + (tvCode ? tvCode.code : ''),
      draw() {
        const BW2 = 420, X = (W - BW2) / 2, Y = 40, BH2 = H - 80;
        dim(); box(X, Y, BW2, BH2);
        text('PokéSurvivor Classic Native', W / 2 + 2, Y + 18 + 2, 26, C.navy, 'center', true, null);
        text('PokéSurvivor Classic Native', W / 2, Y + 18, 26, C.gold, 'center', true, null);
        text(T('La misma cuenta y la misma partida que en la web'), W / 2, Y + 58, 10, C.muted, 'center');
        ['Entrar', 'Crear cuenta'].forEach((t, i) => {
          const x = X + 18 + i * ((BW2 - 40) / 2 + 4), w = (BW2 - 40) / 2;
          rr(x, Y + 80, w, 28, 7); ctx.fillStyle = i === tab ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.2)'; ctx.fill();
          ctx.strokeStyle = i === tab ? C.edge : 'transparent'; ctx.lineWidth = 1.5; ctx.stroke();
          text(T(t), x + w / 2, Y + 87, 12, '#fff', 'center', true);
          hot(x, Y + 80, w, 28, false, () => { if (!busy) { tab = i; msg = ''; } });   // (clic: esa pestaña)
        });
        padIcon('l1', X + 8, Y + 94); padIcon('r1', X + BW2 - 8, Y + 94);
        // Clic en un campo o botón: elegirlo y pulsarlo (como ✕ sobre él).
        const press = i => () => { if (busy || !top) return; sel = i; top.input({ a: true }); };
        const field = (i, label, val, y) => {
          text(T(label), X + 18, y, 10, C.muted);
          rr(X + 18, y + 14, BW2 - 36, 30, 7); ctx.fillStyle = '#0f1f4a'; ctx.fill();
          ctx.strokeStyle = sel === i ? C.gold : C.edgeIn; ctx.lineWidth = sel === i ? 2.5 : 2; ctx.stroke();
          asIs(() => text(val, X + 28, y + 22, 13, '#fff'));
          hot(X + 18, y + 14, BW2 - 36, 30, false, press(i));
        };
        const fr = rows()[sel];
        liveField(!busy && (fr === 'name' || fr === 'pass') ? fr : null, () => (fr === 'name' ? name : pass),
          v => { if (fr === 'name') name = v; else pass = v; }, fr === 'name' ? 16 : 64);
        field(0, 'Nombre', name, Y + 120);
        field(1, 'Contraseña', showPass ? pass : '*'.repeat(pass.length), Y + 170);
        text(msg, W / 2, Y + 222, 10.5, busy ? C.muted : '#ffb0b8', 'center');
        btn(X + 18, Y + 244, BW2 - 36, 32, T(tab ? 'Crear cuenta' : 'Entrar'), busy ? 'off' : 'gold', sel === 2, 13, undefined, () => { sel = 2; });
        btn(X + 18, Y + 290, BW2 - 36, 30, T('Entrar con Google') + (googleOk() && !CAN.page ? ' (' + (tvMode() ? 'QR' : T('navegador')) + ')' : ''),
          googleOk() && !busy ? 'blue' : 'off', sel === 3, 11, undefined, () => { sel = 3; });
        // (invitado: en la web, sin guardar; en el resto, la cuenta local de este aparato: Cloud.set(false))
        btn(X + 18, Y + 334, BW2 - 36, 28, T('Jugar como invitado'), 'ghost', sel === 4, 11, undefined, () => { sel = 4; });
        if (sel === 4) { rr(X + 15, Y + 331, BW2 - 30, 34, 10); ctx.strokeStyle = C.gold; ctx.lineWidth = 2; ctx.stroke(); }
        hot(X + 18, Y + 244, BW2 - 36, 32, false, press(2));
        hot(X + 18, Y + 290, BW2 - 36, 30, false, press(3));
        hot(X + 18, Y + 334, BW2 - 36, 28, false, press(4));
        text(T('Si guardas en la web (botón Guardar), aquí verás tu progreso.'), W / 2, Y + 378, 9.5, C.muted, 'center');
        if (tvCode) {   // consolas: QR de google.com/device y el código a escribir en el móvil
          const [bx, by] = centerBox(460, 340, T('Entrar con Google'));
          if (CAN.touch && CAN.browser) hot(bx + 20, by + 80, 420, 250, false, () => { ps.open_url(tvCode.url); });
          wrap(T(CAN.touch && CAN.browser ? 'Toca el código para abrir la dirección en el navegador y escríbelo allí; luego vuelve al juego.'
                         : 'Escanéalo con el móvil (o abre la dirección) y escribe este código:'), 420, 11).forEach((l, i) => text(l, W / 2, by + 46 + i * 15, 11, C.muted, 'center'));
          if (tvCode.qr) qrAt(tvCode.qr, W / 2, by + 84, 160);
          text(tvCode.url.replace(/^https:\/\//, ''), W / 2, by + 254, 13, '#fff', 'center', true);
          rr(bx + 100, by + 278, 260, 44, 8); ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fill();
          text(tvCode.code, W / 2, by + 286, 26, C.gold, 'center', true);
          hints([['o', 'Cancelar']]);
        } else hints([['ud', 'Mover'], ['x', 'Elegir'], ['sel', showPass ? 'Ocultar' : 'Mostrar'], ['l1', 'Entrar / Crear cuenta']]);
      },
      input(ev) {
        if (busy) { if (ev.b && googleCancel) { G.Audio.sfx('back'); googleCancel(); } return; }
        const b = psPadRaw().buttons;
        if ((b[4] && !this._l) || (b[5] && !this._r)) { tab = 1 - tab; msg = ''; G.Audio.sfx('select'); }
        this._l = b[4]; this._r = b[5];
        if (ev.dy) { const n = rows().length; sel = (sel + ev.dy + n) % n; G.Audio.sfx('select'); }
        if (ev.sel) { showPass = !showPass; G.Audio.sfx('select'); }
        if (!ev.a && !ev.start) return;
        const r = rows()[sel];
        if (ev.start || r === 'go') submit();
        else if (r === 'name') { if (!typeIn(r)) { close(); keyboard('Nombre', name, { max: 16 }, v => { if (v != null) name = v.trim(); reopen(); }); } }
        else if (r === 'pass') { if (!typeIn(r)) { close(); keyboard('Contraseña', pass, { mask: true, max: 64 }, v => { if (v != null) pass = v; reopen(); }); } }
        else if (r === 'google') {
          if (!googleOk()) return G.Audio.sfx('error');
          busy = true; msg = tvMode() || CAN.page ? T('Conectando…') : T('Termina de entrar en el navegador…') + ' ({back} ' + T('Cancelar') + ')'; G.Audio.sfx('select');
          googleLogin().then(r => {
            busy = false;
            if (!r.ok) { msg = T(r.error || ''); if (r.error) G.Audio.sfx('error'); return; }
            G.Audio.sfx('confirm'); close(); afterCloudLogin();
          });
        }
        else if (r === 'local') { G.Audio.sfx('select'); Cloud.set(false); }
      },
    });
    // Al volver del teclado: la misma pantalla con lo escrito.
    const me = top;
    function reopen() { open(me); }
  }

  // Hasta el 29-10-2026, juntar la partida de la consola le ponía su nombre ("Entrenador"/"Trainer") a la de la cuenta:
  // arriba salía ése y Amigos pedía apodo (en las cuentas de nombre y contraseña, el apodo es el nombre de la partida).
  // Se recupera del email interno de la cuenta (el nombre en minúsculas, codificado en hexadecimal: nameToEmail de db.js).
  // Correo de la cuenta (Google); las de nombre y contraseña llevan uno interno que no se enseña.
  function accountEmail() {
    const u = G.DB.fb && G.DB.fb.auth && G.DB.fb.auth.currentUser;
    return u && u.email && !G.DB.nameAccount ? ' · ' + u.email : '';
  }
  function fixName() {
    const s = G.DB.save, u = G.DB.fb && G.DB.fb.auth && G.DB.fb.auth.currentUser, local = Cloud.localSave();
    if (!s || !u || !G.DB.nameAccount) return;
    const bad = ['Entrenador', 'Trainer', local && local.name].filter(Boolean);
    if (!bad.includes(s.name)) return;
    const hex = String(u.email || '').split('@')[0];
    if (!/^([0-9a-f]{2})+$/.test(hex)) return;
    const name = new TextDecoder().decode(new Uint8Array(hex.match(/../g).map(h => parseInt(h, 16))));
    if (!name || name === s.name) return;
    console.log('[cuenta] nombre reparado: ' + s.name + ' -> ' + name);
    G.DB.setName(name);
    G.DB.commit(true);
  }

  // Tras entrar: la primera vez en esta cuenta, ofrecer juntar la partida de la consola.
  function afterCloudLogin() {
    fixName();
    const uid = G.DB.fb && G.DB.fb.uid, local = Cloud.localSave();
    if (!uid || !local || Cloud.imported(uid) || !local.partner) return G.Flow.afterLogin();
    let sel = 0;
    const n = o => Object.keys((o && o.owned) || {}).length;
    open({
      key: () => String(sel),
      draw() {
        const [x, y] = centerBox(460, 220, T('¿Traer tu partida de la consola?'));
        wrap(T('En esta PS5 ya tenías una partida. Se puede juntar con la de tu cuenta online: te quedas con lo mejor de las dos (Pokémon, monedas, mejoras, logros).'), 420, 10.5)
          .forEach((l, i) => text(l, x + 20, y + 50 + i * 14, 10.5, '#fff'));
        text(G.I18n.f('En la consola: {x} Pokémon · en la cuenta: {x}', n(local), n(G.DB.save)), W / 2, y + 112, 10.5, C.muted, 'center');
        btn(x + 20, y + 150, 200, 32, T('Sí, juntarlas'), 'gold', sel === 0, 12, undefined, () => { sel = 0; });
        btn(x + 240, y + 150, 200, 32, T('No, gracias'), 'blue', sel === 1, 12, undefined, () => { sel = 1; });
        hints([['lr', 'Mover'], ['x', 'Elegir']]);
      },
      input(ev) {
        if (ev.dx) { sel = 1 - sel; G.Audio.sfx('select'); }
        if (ev.b) sel = 1;   // ○: «No» (no toca ninguna partida)
        else if (!ev.a) return;
        if (sel === 0) {
          try {
            // Manda la online: es la base (merge toma la más reciente; a la de la consola se le quita la fecha) y gana en
            // todo lo que esté en las dos; de la consola sólo se añade lo que la online no tiene (Pokémon, logros…).
            const s = G.DB.save, name = s.name, m = G.DB.merge(JSON.parse(JSON.stringify(s)), Object.assign({}, local, { updated: 0 }));
            for (const k of Object.keys(s)) delete s[k];
            Object.assign(s, m, { name: name || m.name });   // (el nombre, el de la cuenta: leído ANTES de vaciarla)
            G.DB.commit(true);
            G.UI.toast(T('Partidas juntadas: pulsa Guardar para subirla a la nube.'), 4000);
          } catch (e) { console.error('[cuenta] juntar: ' + e.message); G.UI.toast(T('No se pudo juntar la partida.')); }
        }
        Cloud.markImported(uid);
        G.Audio.sfx('confirm'); close(); G.Flow.afterLogin();
      },
    });
  }

  // Guardar en la nube (como el botón Guardar de la barra de la web): avisa de cómo ha ido.
  async function cloudSave() {
    const r = await G.DB.saveNow();
    const M = { done: 'Ya estaba todo guardado.', wait: G.I18n.f('Se guardará en {x} s.', r.secs || 0), offline: 'Sin conexión: se guardará cuando vuelva.', fail: 'No se pudo guardar.' };
    G.UI.toast(T(r.ok && !r.why ? 'Guardado en la nube.' : M[r.why] || 'Guardado.'), 4000);
  }

  // ---------------- apodo, ranking y amigos (js/ui/social-ui.js, ranking-ui.js; datos: js/net/) ----------------
  // Todo necesita la cuenta online (Ajustes → Cuenta) y un apodo (el nombre que ven los demás).
  function needOnline() {
    if (G.DB.online) return true;
    G.UI.toast(T(G.DB.guest ? 'Crea una cuenta para jugar con amigos y salir en el ranking.' : 'Esto necesita la versión online del juego (con la nube).'), 3500);
    G.Audio.sfx('error');
    if (!top) mainMenu();   // (el menú ya se cerró al elegir: sin esto no quedaba ninguna pantalla y el mando no hacía nada)
    return false;
  }
  let nickSkipped = false;
  // Abre fn si tienes apodo; si no, lo pide antes (como withNick de la web).
  function withNick(fn) {
    if (!needOnline()) return;
    if (G.Social.me) return fn();
    // Mientras se conecta, una pantalla (si no, el menú ya cerrado dejaba sólo el fondo); a los 15 s, al menú.
    let waiting = true;
    open({ key: () => 'wait', draw() { centerBox(320, 90, T('Conectando…')); hints([['o', 'Volver']]); },
           live(now) { const a = now / 160; ctx.lineWidth = 3.5; ctx.lineCap = 'round'; ctx.strokeStyle = C.gold;
                       ctx.beginPath(); ctx.arc(W / 2, H / 2 + 12, 12, a, a + 4.2); ctx.stroke(); },
           input(ev) { if (ev.b) { waiting = false; G.Audio.sfx('back'); close(); mainMenu(); } } });
    const giveUp = setTimeout(() => {
      if (!waiting) return;
      waiting = false; console.log('[social] start: sin respuesta en 15 s'); close(); mainMenu();
      G.UI.toast(T('No se pudo conectar con los servidores. Inténtalo de nuevo.'), 3500);
    }, 15000);
    G.Social.start().then(r => {
      if (!waiting) return;
      waiting = false; clearTimeout(giveUp); close();
      if (r === 'ok' && G.Social.me) return fn();
      // Cuentas de nombre y contraseña: el apodo es el nombre de la partida (Social.start lo hace al empezar, pero si
      // entonces el nombre aún era el de la consola, se quedaba sin apodo hasta reiniciar). Se intenta otra vez aquí.
      if (r === 'need-nick' && G.DB.nameAccount && G.DB.save && G.DB.save.name) {
        return G.Social.claimNick(G.DB.save.name).then(c => {
          console.log('[social] apodo de la cuenta (' + G.DB.save.name + '): ' + (c.ok ? 'bien' : c.error));
          if (c.ok && G.Social.me) fn(); else nickScreen(fn);
        });
      }
      // ponytail: diagnóstico (el juego se traga el error de leer el perfil y pide el apodo): ¿qué pasó de verdad?
      const fb = G.DB.fb, t0 = ps.now();
      console.log('[social] start: ' + r + ' · uid ' + (fb && fb.uid));
      if (fb && fb.uid) fb.fs.collection('profiles').doc(fb.uid).get()
        .then(s => console.log('[social] perfil en ' + Math.round(ps.now() - t0) + ' ms: ' + (s.exists ? JSON.stringify(s.data()).slice(0, 80) : 'no existe')))
        .catch(e => console.log('[social] perfil: error ' + (e.code || '') + ' ' + e.message + ' en ' + Math.round(ps.now() - t0) + ' ms'));
      nickScreen(fn);
    });
  }

  function nickScreen(next) {
    let nick = '', sel = 0, busy = false, msg = '';
    const back = () => (next ? next() : mainMenu());
    const me = {
      key: () => sel + '|' + nick + '|' + busy + '|' + msg,
      draw() {
        const [x, y] = centerBox(440, 250, T('Elige tu apodo'));
        wrap(T('Es el nombre que verán tus amigos y el que sale en el ranking.') + ' ' + T('Tu nombre y tu correo de Google no se enseñan a nadie.'), 400, 10.5)
          .forEach((l, i) => text(l, x + 20, y + 50 + i * 14, 10.5, C.muted));
        rr(x + 20, y + 96, 400, 30, 7); ctx.fillStyle = '#0f1f4a'; ctx.fill(); ctx.strokeStyle = sel === 0 ? C.gold : C.edgeIn; ctx.lineWidth = sel === 0 ? 2.5 : 2; ctx.stroke();
        liveField(!busy && sel === 0 ? 'nick' : null, () => nick, v => { nick = v; }, 16);
        text(nick || T('3-16 letras, números o _'), x + 30, y + 104, 13, nick ? '#fff' : C.muted);
        text(msg, W / 2, y + 134, 10.5, busy ? C.muted : '#ffb0b8', 'center');
        btn(x + 20, y + 156, 400, 30, T('Guardar apodo'), busy ? 'off' : 'gold', sel === 1, 12, undefined, () => { sel = 1; });
        btn(x + 20, y + 200, 400, 26, T('Ahora no'), 'ghost', sel === 2, 11, undefined, () => { sel = 2; });
        if (sel === 2) { rr(x + 17, y + 197, 406, 32, 10); ctx.strokeStyle = C.gold; ctx.lineWidth = 2; ctx.stroke(); }
        hints([['ud', 'Mover'], ['x', 'Elegir']]);
      },
      input(ev) {
        if (busy) return;
        if (ev.dy) { sel = (sel + ev.dy + 3) % 3; G.Audio.sfx('select'); }
        if (!ev.a) return;
        if (sel === 0) { if (!typeIn('nick')) { close(); keyboard('Elige tu apodo', nick, { max: 16 }, v => { if (v != null) nick = v.trim(); open(me); }); } }
        else if (sel === 2) { nickSkipped = true; G.Audio.sfx('back'); close(); mainMenu(); }
        else {
          busy = true; msg = T('Conectando…');
          G.Social.claimNick(nick).then(r => {
            busy = false;
            if (!r.ok) { msg = T(r.error || 'No se pudo guardar.'); G.Audio.sfx('error'); return; }
            G.Audio.sfx('confirm'); G.UI.toast(G.I18n.f('Tu apodo es {x}', G.Social.me.name));
            close(); back();
          });
        }
      },
    };
    open(me);
  }

  // Al entrar en el menú con cuenta online: arrancar lo social (amigos, invitaciones) y, una vez, pedir el apodo.
  function socialOnMenu() {
    if (!G.DB.online || G.Social.started) return;
    G.Social.start().then(r => { if (r === 'need-nick' && !nickSkipped && top && top.isMenu) { close(); nickScreen(); } }).catch(e => console.warn('[social] ' + e.message));
  }

  // Perfil de otro jugador (lo lee de la nube).
  function showProfile(uid, back) {
    if (!uid) return;
    if (uid === G.Social.uid) return publicProfile(G.Social.profileData(), back);
    G.UI.toast(T('Cargando…'), 1500);
    const t0 = ps.now();   // ponytail: diagnóstico del título («Ver perfil» se queda cargando)
    console.log('[social] ver perfil ' + uid.slice(0, 6) + '…');
    G.Social.getProfile(uid).then(d => {
      console.log('[social] ver perfil: ' + (d ? 'llegó' : 'vacío') + ' en ' + Math.round(ps.now() - t0) + ' ms · pantalla ' + (top && top.social ? 'amigos' : 'otra'));
      if (!d) { G.UI.toast(T('Este jugador aún no tiene perfil.')); return; }
      close(); publicProfile(d, back);
    }).catch(() => G.UI.toast(T('No se pudo cargar.')));
  }

  // Como #scr-rank: Solo / Grupo, periodo, todos o sólo amigos, y las dos mitades (daño a Arceus | tiempo).
  let rkMode = 's', rkPeriod = 'w', rkScope = 'all';
  const RK_MODES = [['s', 'Solo', 'user'], ['g', 'Grupo', 'friends'], ['e', 'Endless', 'star']];
  function rankScreen() {
    if (!needOnline()) return;
    if (!G.Social.started) G.Social.start();
    const fmtT = t => (t >= 3600 ? Math.floor(t / 3600) + ':' + G.U.mmss(t % 3600).padStart(5, '0') : G.U.mmss(t));
    const num = n => (n || 0).toLocaleString();
    let rows = null, dmg = null, me = null, err = '', token = 0, col = 1, sel = 0, scroll = [0, 0], ver = 0;
    const load = async () => {
      const my = ++token;
      rows = dmg = me = null; err = ''; sel = 0; scroll = [0, 0]; ver++;
      try {
        // Sin red (o la red colgada) no se queda en «Cargando»: a los 15 s, error y se puede volver a probar.
        const r = await Promise.race([Promise.all([G.Ranking.top(rkMode, rkPeriod, null, rkScope === 'friends'),
          G.Social.me ? G.Ranking.myRank(rkMode, rkPeriod, null) : Promise.resolve(null),
          rkMode === 'e' ? Promise.resolve({ rows: [], me: null }) : G.Ranking.topDmg(rkMode, rkPeriod, rkScope === 'friends')]),
          new Promise((_, no) => setTimeout(() => no(new Error(T('sin conexión'))), 15000))]);
        if (my !== token) return;
        [rows, me, dmg] = r;
      } catch (e) { if (my === token) err = T('No se pudo cargar el ranking') + ' (' + (e.code || e.message) + ').'; }
      ver++;
    };
    load();
    const lists = () => [dmg ? dmg.rows : [], rows || []];
    const L = BX + 18, CW2 = (BW - 46) / 2, RH = 34, TOP = BY + 104, VIS = 9;
    open({ wheel: true,
      key: () => [rkMode, rkPeriod, rkScope, col, sel, scroll.join(','), ver].join('|'),
      draw() {
        modal('Ranking');
        // Solo / Grupo
        // (cada pestaña, del ancho de su texto: con tres, las de 104 px se montaban sobre R1 y □)
        let mx = L + 28;
        RK_MODES.forEach(([k, t, ic]) => {
          font(11, true);
          const x = mx, w = Math.ceil(ctx.measureText(T(t)).width) + 34, on = k === rkMode;
          hot(x, BY + 46, w, 24, false, () => { if (rkMode !== k) { rkMode = k; load(); } });   // (ratón)
          rr(x, BY + 46, w, 24, 7); ctx.fillStyle = on ? 'rgba(255,210,63,0.15)' : 'rgba(0,0,0,0.25)'; ctx.fill();
          ctx.strokeStyle = on ? C.gold : 'rgba(244,248,255,0.22)'; ctx.lineWidth = 1.5; ctx.stroke();
          icon(ic, x + 8, BY + 50, 14); text(T(t), x + 26, BY + 52, 11, on ? C.gold : '#fff', 'left', true);
          mx += w + 4;
        });
        padIcon('l1', L + 12, BY + 58); padIcon('r1', mx + 10, BY + 58);
        // Periodo (□) y alcance (△): detrás de R1, con el mismo hueco que antes
        let cx = Math.max(L + 290, mx + 44);
        padIcon('s', cx, BY + 58, 7); cx += 12;
        for (const [k, t] of G.Ranking.PERIODS) { const w = chip(cx, BY + 48, T(t), k === rkPeriod); hot(cx, BY + 48, w, 20, false, () => { if (rkPeriod !== k) { rkPeriod = k; load(); } }); cx += w + 4; }
        cx += 8; padIcon('t', cx, BY + 58, 7); cx += 12;
        for (const [k, t] of [['all', 'Todos'], ['friends', 'Sólo amigos']]) { const w = chip(cx, BY + 48, T(t), k === rkScope); hot(cx, BY + 48, w, 20, false, () => { if (rkScope !== k) { rkScope = k; load(); } }); cx += w + 4; }
        // Las dos columnas
        const L2 = lists();
        ['Daño a Arceus', 'Tiempo aguantado'].forEach((h, c) => {
          const x = L + c * (CW2 + 10);
          text(T(h), x, BY + 80, 13.5, c === col ? C.gold : '#fff', 'left', true);
          panel(x, TOP - 4, CW2, VIS * RH + 6);
          if (err) { if (c === 0) wrap(err, CW2 * 2, 10).forEach((l, i) => text(l, x + 10, TOP + 6 + i * 13, 10, '#ffb0b8')); return; }
          if (!rows) { text(T('Cargando…'), x + 10, TOP + 6, 10, C.muted); return; }
          const list = L2[c];
          if (!list.length) wrap(T(c ? 'Todavía no hay marcas aquí. ¡Sé el primero!' : (rkMode === 'e' ? 'En Endless no hay Sentencia de Arceus.' : 'Todavía nadie le ha hecho daño a Arceus aquí. ¡Llega al minuto 30 y pégale!')), CW2 - 20, 10)
            .forEach((l, i) => text(l, x + 10, TOP + 6 + i * 13, 10, C.muted));
          for (let i = scroll[c]; i < Math.min(list.length, scroll[c] + VIS); i++) {
            const r = list[i], y = TOP + (i - scroll[c]) * RH, on = c === col && i === sel, mine = r.uids.includes(G.Social.uid);
            const ci = c, ri = i; hot(x + 3, y, CW2 - 6, RH - 2, on, null, () => { col = ci; sel = ri; });   // (ratón: foco directo)
            if (on || mine) { rr(x + 3, y, CW2 - 6, RH - 2, 6); ctx.fillStyle = mine ? 'rgba(255,210,63,0.12)' : 'rgba(255,255,255,0.08)'; ctx.fill(); }
            if (on) { ctx.strokeStyle = C.gold; ctx.lineWidth = 2; ctx.stroke(); }
            if (i < 3) icon('trophy', x + 8, y + 8, 14);
            text(String(i + 1), x + (i < 3 ? 26 : 12), y + 10, 11, i < 3 ? C.gold : C.muted, 'left', true);
            const names = r.names.join(' · ');
            text(names.length > 26 ? names.slice(0, 25) + '…' : names, x + 44 + r.dex.length * 30, y + (c ? 4 : 10), 11, '#fff', 'left', true);
            if (c) text(T('Nv.') + ' ' + (r.lv || 1) + ' · ' + num(r.kills) + ' ' + T('derrotados'), x + 44 + r.dex.length * 30, y + 18, 8.5, C.muted);
            text(c ? fmtT(r.t) : num(r.d), x + CW2 - 10, y + 10, 11, '#fff', 'right', true);
          }
          // tu puesto
          let line = '';
          if (c === 0) line = !dmg || !dmg.me ? '' : dmg.me.out ? T('Aún no estás en el top 50 de daño.') : G.I18n.f('Tu puesto: {x}', '#' + dmg.me.pos) + ' · ' + num(dmg.me.d);
          else line = !G.Social.me ? T('Elige un apodo (en Amigos) para salir en el ranking.') : me && me.out ? T('Aún no estás en el top 50. Tu puesto está en Histórico.')
            : me ? G.I18n.f('Tu mejor puesto: {x}', '#' + (me.capped ? '1000+' : me.pos)) + ' · ' + fmtT(me.t) : T('Aún no tienes marca.');
          if (line) text(line, x + 4, TOP + VIS * RH + 8, 10, C.gold);
        });
        hints([['lr', 'Columna'], ['ud', 'Mover'], ['x', 'Ver perfil'], ['o', 'Volver']]);
      },
      // Como la web (spriteCanvas a escala 1, recortado en su recuadro, shiny si lo era): sin recorte, los grandes se salían.
      live(now) {
        if (!rows) return;
        const L2 = lists();
        [0, 1].forEach(c => {
          const x = L + c * (CW2 + 10);
          for (let i = scroll[c]; i < Math.min(L2[c].length, scroll[c] + VIS); i++) {
            const r = L2[c][i];
            r.dex.forEach((d, k) => monBox(d, x + 40 + k * 30, TOP + (i - scroll[c]) * RH, 30, RH - 2, 0.75, now, !!(r.shiny && r.shiny[k])));
          }
        });
      },
      input(ev) {
        const b = psPadRaw().buttons;
        if ((b[4] && !this._l) || (b[5] && !this._r)) { const i = RK_MODES.findIndex(m => m[0] === rkMode); rkMode = RK_MODES[(i + (b[5] ? 1 : RK_MODES.length - 1)) % RK_MODES.length][0]; G.Audio.sfx('select'); load(); }
        this._l = b[4]; this._r = b[5];
        if (ev.x) { const ps2 = G.Ranking.PERIODS.map(p => p[0]); rkPeriod = ps2[(ps2.indexOf(rkPeriod) + 1) % ps2.length]; G.Audio.sfx('select'); load(); }
        if (ev.y) { rkScope = rkScope === 'all' ? 'friends' : 'all'; G.Audio.sfx('select'); load(); }
        if (ev.dx) { col = 1 - col; sel = Math.min(sel, Math.max(0, lists()[col].length - 1)); G.Audio.sfx('select'); }
        if (ev.dy) {
          const n = lists()[col].length;
          if (n) { sel = Math.max(0, Math.min(n - 1, sel + ev.dy)); if (sel < scroll[col]) scroll[col] = sel; else if (sel >= scroll[col] + VIS) scroll[col] = sel - VIS + 1; G.Audio.sfx('select'); }
        }
        if (ev.wheelRows) scroll[col] = clamp(scroll[col] + ev.wheelRows, 0, Math.max(0, lists()[col].length - VIS));   // (sólo la vista)
        const r = lists()[col][sel];
        if (ev.a && r && r.uids[0]) showProfile(r.uids[0], rankScreen);
        else if (ev.b) { G.Audio.sfx('back'); close(); mainMenu(); }
      },
    });
  }

  // Como #scr-friends: tu apodo, añadir por apodo y la lista (solicitudes, enviadas, amigos).
  function friendsScreen() {
    withNick(() => {
      let sel = 0, act = 0, msg = '', bad = false, ver = 0;
      const say = (t, isBad) => { msg = T(t || ''); bad = !!isBad; G.Audio.sfx(isBad ? 'error' : 'confirm'); ver++; };
      const list = () => G.Social.friends.sort((a, b) => {
        const rank = f => (f.status === 'in' ? 0 : f.status === 'ok' ? 1 : 2);
        return rank(a) - rank(b) || a.name.localeCompare(b.name);
      });
      // Lo que se puede hacer con cada uno: [texto, tipo, acción]
      const actions = f => f.status === 'in' ? [['Aceptar', 'gold', async () => { const r = await G.Social.accept(f.uid); say(r.ok ? r.msg : r.error, !r.ok); }], ['Rechazar', 'ghost', () => G.Social.remove(f.uid)]]
        : f.status === 'out' ? [['Cancelar', 'ghost', () => G.Social.remove(f.uid)]]
        : [...(canInvite(f) ? [['Invitar', 'gold', async () => {
            const r = await G.Social.invite(f.uid).catch(e => ({ ok: false, error: G.I18n.f('No se pudo invitar ({x}).', e.code || e.message) }));
            say(r.ok ? r.msg : r.error, !r.ok);
            if (r.ok && top === me) { G.Social.off(onChange); close(); lobbyScreen(); }
          }]] : []),
          ['Ver perfil', 'blue', () => showProfile(f.uid, friendsScreen)], ['Quitar', 'ghost', () => { G.Social.remove(f.uid); say(G.I18n.f('Ya no sois amigos: {x}', f.name)); }]];
      const room = () => G.Social.room, inRoom = f => !!room() && room().members.some(m => m.uid === f.uid);
      const canInvite = f => !inRoom(f) && (!room() || room().isHost);
      const onChange = () => ver++;
      const LOCAL = !!ps.core_pads && !G.Social.room;   // (Cooperativo local: con mandos de esta copia; en una sala online, no)
      G.Social.on(onChange);
      G.Social.ensureFriends().then(onChange);
      const me = { social: true,
        key: () => [sel, act, msg, ver, G.Social.friends.length, socVer, !!G.Social.room].join('|'),
        draw() {
          modal('Multijugador');
          spans([[T('Tu apodo') + ': ', C.muted], [G.Social.me ? G.Social.me.name : '', C.gold, true], [' · ' + T('dáselo a tus amigos para que te añadan.'), C.muted]], BX + 18, BY + 48, 10.5);
          btn(BX + 18, BY + 68, 200, 28, T('Añadir amigo'), 'gold', sel === 0 && act === 0, 12, undefined, () => { sel = 0; act = 0; });
          // Al lado: volver a la sala online (como #fr-room de la web) o, sin ella, crear la sala local (los mandos de esta PS5).
          const mx = BX + 232 + 168;
          btn(BX + 232, BY + 68, 156, 28, T(G.Social.room ? 'Ir a la sala' : 'Crear sala'), 'blue', sel === 0 && act === 1, 12, undefined, () => { sel = 0; act = 1; });
          if (sel === 0 && act === 1) { rr(BX + 229, BY + 65, 162, 34, 10); ctx.strokeStyle = C.gold; ctx.lineWidth = 2; ctx.stroke(); }
          if (LOCAL) btn(mx, BY + 68, 156, 28, T('Cooperativo local'), 'blue', sel === 0 && act === 2, 12, undefined, () => { sel = 0; act = 2; });
          if (LOCAL && sel === 0 && act === 2) { rr(mx - 3, BY + 65, 162, 34, 10); ctx.strokeStyle = C.gold; ctx.lineWidth = 2; ctx.stroke(); }
          text(msg, mx + (LOCAL ? 168 : 0), BY + 76, 10.5, bad ? '#ffb0b8' : C.muted);
          const fl = list();
          if (!fl.length) text(T('Aún no tienes amigos añadidos. Pulsa Añadir amigo y escribe su apodo.'), BX + 18, BY + 112, 10.5, C.muted);
          fl.slice(0, 9).forEach((f, i) => {
            const y = BY + 108 + i * 38, on = sel === i + 1;
            hot(BX + 18, y, BW - 36, 32, on, null, () => { sel = i + 1; });   // (ratón: foco directo)
            rr(BX + 18, y, BW - 36, 32, 7); ctx.fillStyle = on ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.2)'; ctx.fill();
            ctx.beginPath(); ctx.arc(BX + 32, y + 16, 4, 0, 6.2832); ctx.fillStyle = f.status === 'ok' ? '#5fe08a' : C.gold; ctx.fill();
            text(f.name, BX + 44, y + 9, 12, '#fff', 'left', true);
            text(T(f.status === 'in' ? 'Quiere ser tu amigo' : f.status === 'out' ? 'Solicitud enviada' : inRoom(f) ? 'En tu sala' : ''), BX + 220, y + 10, 10, C.muted);
            let bx = BX + BW - 26;
            actions(f).slice().reverse().forEach(([t, kind], k, arr) => {
              const idx = arr.length - 1 - k; font(10, true); const w = ctx.measureText(T(t)).width + 26; bx -= w;
              btn(bx, y + 5, w, 22, T(t), kind, on && act === idx, 10, undefined, () => { sel = i + 1; act = idx; });
              if (on && act === idx && kind === 'ghost') { rr(bx - 3, y + 2, w + 6, 28, 9); ctx.strokeStyle = C.gold; ctx.lineWidth = 2; ctx.stroke(); }
              bx -= 6;
            });
          });
          hints([['ud', 'Mover'], ['lr', 'Acción'], ['x', 'Elegir'], ['o', 'Volver']]);
        },
        input(ev) {
          const fl = list(), n = Math.min(fl.length, 9) + 1;
          if (ev.dy) { sel = (sel + ev.dy + n) % n; act = 0; G.Audio.sfx('select'); }
          if (ev.dx && sel > 0) { const k = actions(fl[sel - 1]).length; act = (act + ev.dx + k) % k; G.Audio.sfx('select'); }
          if (ev.dx && sel === 0) { const k = LOCAL ? 3 : 2; act = (act + ev.dx + k) % k; G.Audio.sfx('select'); }
          if (ev.a) {
            if (sel === 0 && act === 2) { G.Social.off(onChange); G.Audio.sfx('select'); close(); localCoopScreen(); }
            else if (sel === 0 && act === 1) { G.Social.off(onChange); G.Audio.sfx('select'); close(); if (G.Social.room) lobbyScreen(); else G.Social.createRoom().then(lobbyScreen, e => { G.UI.toast(T((e && e.msg) || 'No se pudo crear la sala'), e && e.msg ? 4200 : undefined); console.warn('[sala] ' + (e && e.message)); mainMenu(); }); }
            else if (sel === 0) {
              close();
              keyboard('Apodo de tu amigo', '', { max: 16 }, v => {
                open(me);
                if (v && v.trim()) G.Social.request(v.trim()).then(r => say(r.ok ? r.msg : r.error, !r.ok));
              });
            } else { const a = actions(fl[sel - 1])[act] || actions(fl[sel - 1])[0]; if (a) a[2](); }
          } else if (ev.b) { G.Social.off(onChange); G.Audio.sfx('back'); close(); mainMenu(); }
        },
      };
      open(me);
    });
  }

  // Multijugador → Cooperativo local: cada mando entra con {confirm} (main.c, p_poll: también en el menú) y elige Pokémon con
  // ◀ ▶ (los de su perfil de la PS5 si tiene partida; si no, los del J1). {confirm} en su mando: listo; {back}: fuera.
  // {alt2} abre en su columna una mini Pokédex (rejilla 4×4) con filtros: {prev}/{next} tipo, L2/R2 generación (o letra si
  // se ordena por nombre), {alt} el panel de filtro, {alt2} uno al azar. Cada uno la lleva con su mando, a la vez.
  // El J1 elige el suyo (su compañero) y empieza cuando todos están listos. core.js suma a cada uno con lo elegido
  // (psCoopPick) y deja fuera a los que salieron (psCoopOut). Un mando puede seguir entrando a mitad de partida.
  // ponytail: el teclado como otro jugador sigue entrando sólo en partida (Enter, core.js).
  function localCoopScreen() {
    if (!thumbs.done) return thumbsLoading(localCoopScreen);
    const PC = ['#ffcb3d', '#5fc8ff', '#7ee07a', '#ff8ad8'];   // (los de core.js, COLORS)
    const s = G.DB.save, orig = { dex: s.partner, shiny: !!s.partnerShiny };
    const mine = Object.keys(s.owned).map(Number).filter(d => G.DEX_BY[d] && G.SPRITE_META[d]);
    // src: la partida de la que salen sus Pokémon (favoritos, shiny, fechas). shinyOf: el que lleva en shiny (su dex) o 0.
    const lists = [mine], src = [s], at = [Math.max(0, mine.indexOf(orig.dex))], shinyOf = [orig.shiny ? orig.dex : 0], ready = [], held = [], rep = [];
    const out = globalThis.psCoopOut = new Set();
    let msg = '';
    const joined = i => !!(((ps.core_pads ? ps.core_pads() : 1) >> i) & 1) && !out.has(i);
    const dexOf = i => lists[i][at[i]];
    const turn = (i, d) => { const n = lists[i].length; if (n > 1) { at[i] = (at[i] + d + n) % n; G.Audio.sfx('select'); } };
    // Lo de los mandos 2-4, siempre con iconos de mando (aunque el J1 juegue con teclado: psKeys).
    const padText = (...a) => { const k = globalThis.psKeys; globalThis.psKeys = false; try { text(...a); } finally { globalThis.psKeys = k; } };
    const tri = (x, y, d) => { ctx.beginPath(); ctx.moveTo(x + 5 * d, y); ctx.lineTo(x - 5 * d, y - 7); ctx.lineTo(x - 5 * d, y + 7); ctx.closePath(); ctx.fillStyle = '#fff'; ctx.fill(); };
    // Su lista, la primera vez que entra: la de su perfil o la del J1 (empieza en su compañero o en otro que el del J1).
    function setup(i) {
      const sv = psCore.userSave ? psCore.userSave(i) : null;
      const own = sv ? Object.keys(sv.owned).map(Number).filter(d => G.DEX_BY[d] && G.SPRITE_META[d]) : [];
      lists[i] = own.length ? own : mine;
      src[i] = own.length ? sv : s;
      const k = sv ? lists[i].indexOf(+sv.partner) : -1;
      at[i] = k >= 0 ? k : lists[i].length > 1 ? (at[0] + i) % lists[i].length : 0;
      shinyOf[i] = sv && sv.partnerShiny ? +sv.partner : 0;
      ready[i] = false;
    }

    // ---- la mini Pokédex de cada uno (en su columna) ----
    const SHOW = [['all', 'Todos'], ['fav', 'Favoritos'], ['shiny', 'Shiny'], ['leg', 'Legendarios'], ['free', 'Sin usar']];
    const SORTS = [['num', 'Nº'], ['name', 'Nombre'], ['rar', 'Rareza'], ['new', 'Recientes']];
    const FROWS = [['show', 'Mostrar'], ['type', 'Tipo'], ['gen', 'Generación'], ['sort', 'Orden'], ['ch', 'Inicial']];
    const fresh = () => ({ show: 'all', type: '', gen: 0, sort: 'num', ch: '' });
    const D = [];   // por jugador: { mode: ''|'grid'|'filter', f, list, sel, top, seen, row }
    const nameOf = d => G.T(G.DEX_BY[d].name);
    const initial = d => nameOf(d).normalize('NFD').replace(/[̀-ͯ]/g, '')[0].toUpperCase();
    // Lo que puede valer cada filtro (con lo que hay en su lista; '' / 0 / 'all': todos).
    const opts = (i, key) => key === 'show' ? SHOW.map(o => o[0]) : key === 'sort' ? SORTS.map(o => o[0])
      : key === 'type' ? [''].concat(Object.keys(G.U.TYPE_NAME).filter(t => lists[i].some(d => G.DEX_BY[d].types.includes(t))))
      : key === 'gen' ? [0].concat([...new Set(lists[i].map(d => G.DEX_BY[d].gen))].sort((a, b) => a - b))
      : [''].concat([...new Set(lists[i].map(initial))].sort());
    const optName = (key, v) => key === 'show' ? T(SHOW.find(o => o[0] === v)[1]) : key === 'sort' ? T(SORTS.find(o => o[0] === v)[1])
      : key === 'type' ? (v ? G.U.TYPE_NAME[v] : T('Todos')) : key === 'gen' ? (v ? GEN_NAMES[v - 1] || 'Gen ' + v : T('Todas')) : v || T('Todas');
    function build(i) {
      const d = D[i], f = d.f, sv = src[i] || {}, cur = d.list[d.sel];
      const taken = new Set([0, 1, 2, 3].filter(j => j !== i && (j === 0 || (joined(j) && lists[j]))).map(dexOf));
      const l = lists[i].filter(n => {
        const p = G.DEX_BY[n];
        if (f.show === 'fav' && !(sv.dfav && +sv.dfav[n] > 0)) return false;
        if (f.show === 'shiny' && !(sv.shiny && sv.shiny[n])) return false;
        if (f.show === 'leg' && p.rarity !== 5) return false;
        if (f.show === 'free' && taken.has(n)) return false;
        if (f.type && !p.types.includes(f.type)) return false;
        if (f.gen && p.gen !== f.gen) return false;
        return !f.ch || initial(n) === f.ch;
      });
      const got = n => (sv.owned && sv.owned[n] && sv.owned[n].at) || 0;
      l.sort({ num: (a, b) => a - b, name: (a, b) => nameOf(a).localeCompare(nameOf(b), G.I18n.locale),
               rar: (a, b) => G.DEX_BY[b].rarity - G.DEX_BY[a].rarity || a - b, new: (a, b) => got(b) - got(a) || a - b }[f.sort]);
      d.list = l; d.sel = Math.max(0, l.indexOf(cur));
    }
    const cyc = (i, key, dir) => {
      const f = D[i].f, o = opts(i, key), k = o.indexOf(f[key]);
      f[key] = o[(k + dir + o.length) % o.length];
      if (key === 'sort') f.ch = '';   // (la letra sólo con el orden por nombre)
      build(i);
    };
    function openDex(i) {
      if (!D[i]) D[i] = { f: fresh(), list: [], sel: 0, top: 0, row: 0 };
      const d = D[i]; d.mode = 'grid'; d.list = [dexOf(i)]; d.sel = 0; build(i); d.seen = -1;
      G.Audio.sfx('select');
    }
    function pick(i, dex) {
      at[i] = lists[i].indexOf(dex);
      if (D[i].f.show === 'shiny') shinyOf[i] = dex;
      D[i].mode = '';
      if (i) ready[i] = true;
      msg = ''; G.Audio.sfx('confirm');
    }
    // k: { a, b, x, y, dx, dy, l1, r1, l2, r2 } de su mando (pulsaciones, con repetición en la dirección).
    function dexInput(i, k) {
      const d = D[i], n = d.list.length;
      if (d.mode === 'filter') {
        if (k.dy) d.row = (d.row + k.dy + FROWS.length) % FROWS.length;
        else if (k.dx) cyc(i, FROWS[d.row][0], k.dx);
        else if (k.y) { d.f = fresh(); build(i); }
        else if (k.a || k.b || k.x) d.mode = 'grid';
        else return;
        return G.Audio.sfx(k.b ? 'back' : 'select');
      }
      if (k.b) { d.mode = ''; return G.Audio.sfx('back'); }
      if (k.x) { d.mode = 'filter'; return G.Audio.sfx('select'); }
      if (k.l1 || k.r1) { cyc(i, 'type', k.r1 ? 1 : -1); return G.Audio.sfx('select'); }
      if (k.l2 || k.r2) { cyc(i, d.f.sort === 'name' ? 'ch' : 'gen', k.r2 ? 1 : -1); return G.Audio.sfx('select'); }
      if (!n) return;
      if (k.y) { d.sel = Math.floor(Math.random() * n); G.Audio.sfx('select'); }
      else if (k.a) pick(i, d.list[d.sel]);
      else if (k.dx || k.dy) { const t = d.sel + k.dx + k.dy * 4; if (t >= 0 && t < n) { d.sel = t; G.Audio.sfx('select'); } }
    }
    // Dibujo de la mini Pokédex en su columna (x, y: la esquina; SW de ancho, SH de alto).
    function dexDraw(i, x, y, SW, SH) {
      const d = D[i], f = d.f, tx = i ? padText : text, mid = x + SW / 2;
      if (d.mode === 'filter') {
        tx(T('Filtro'), mid, y + 32, 11, C.muted, 'center');
        FROWS.forEach(([key, label], r) => {
          const ry = y + 52 + r * 30, on = d.row === r;
          if (on) { rr(x + 6, ry - 4, SW - 12, 26, 6); ctx.fillStyle = 'rgba(255,255,255,0.1)'; ctx.fill(); ctx.strokeStyle = C.gold; ctx.lineWidth = 1.5; ctx.stroke(); }
          text(T(label), x + 12, ry, 9.5, C.muted);
          text(optName(key, f[key]), mid + 18, ry + 9, 10.5, key === 'ch' && f.sort !== 'name' ? C.muted : '#fff', 'center', true);
          tri(x + 66, ry + 15, -0.7); tri(x + SW - 14, ry + 15, 0.7);
          if (!i) hot(x + 6, ry - 4, SW - 12, 26, false, () => { d.row = r; cyc(0, key, 1); }, () => { d.row = r; });
        });
        tx(G.I18n.f('Quedan {x}', d.list.length), mid, y + 210, 10.5, C.gold, 'center');
        tx('{confirm} ' + T('Ver') + '  {alt2} ' + T('Limpiar'), mid, y + SH - 22, 10, C.muted, 'center');
        return;
      }
      // Rejilla: el filtro a la vista, tipo ({prev}/{next}) y generación o letra (L2/R2).
      const show = optName('show', f.show);
      font(10, true); const cw = ctx.measureText(show).width + 14;
      rr(mid - cw / 2, y + 28, cw, 15, 7); ctx.fillStyle = f.show === 'all' ? 'rgba(255,255,255,0.14)' : C.gold; ctx.fill();
      text(show, mid, y + 31, 10, f.show === 'all' ? '#fff' : '#3a2a00', 'center', true);
      tx('{prev} ' + optName('type', f.type) + ' {next}', mid, y + 48, 10, '#fff', 'center');
      tx('{l2} ' + (f.sort === 'name' ? optName('ch', f.ch) : optName('gen', f.gen)) + ' {r2}', mid, y + 64, 10, C.muted, 'center');
      const CS = 34, GP = 3, COLS = 4, ROWS = 4, gx = x + (SW - (CS * COLS + GP * (COLS - 1))) / 2, gy = y + 82, n = d.list.length;
      const rows = Math.ceil(n / COLS), selRow = Math.floor(d.sel / COLS);
      if (d.sel !== d.seen) { d.seen = d.sel; if (selRow < d.top) d.top = selRow; else if (selRow >= d.top + ROWS) d.top = selRow - ROWS + 1; }
      d.top = Math.max(0, Math.min(d.top | 0, rows - ROWS));
      const sv = src[i] || {};
      for (let k = d.top * COLS; k < Math.min(n, (d.top + ROWS) * COLS); k++) {
        const r = Math.floor(k / COLS) - d.top, c = k % COLS, cx = gx + c * (CS + GP), cy = gy + r * (CS + GP), dex = d.list[k], on = k === d.sel;
        rr(cx, cy, CS, CS, 5); ctx.fillStyle = on ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.08)'; ctx.fill();
        if (on) { ctx.strokeStyle = C.gold; ctx.lineWidth = 2; ctx.stroke(); }
        thumbIn(dex, cx + 1, cy + 1, CS - 2, CS - 2, 1.5);
        if (sv.dfav && +sv.dfav[dex] > 0) { ctx.beginPath(); ctx.arc(cx + CS - 5, cy + 5, 2.5, 0, 6.2832); ctx.fillStyle = '#ff8ad8'; ctx.fill(); }
        if (sv.shiny && sv.shiny[dex]) { ctx.beginPath(); ctx.arc(cx + 5, cy + 5, 2.5, 0, 6.2832); ctx.fillStyle = C.gold; ctx.fill(); }
        if (!i) hot(cx, cy, CS, CS, false, () => pick(0, dex), () => { d.sel = k; });
      }
      if (rows > ROWS) {   // dónde se está de la lista
        const bh = CS * ROWS + GP * (ROWS - 1), bx = gx + CS * COLS + GP * COLS + 1;
        rr(bx, gy, 3, bh, 1.5); ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.fill();
        rr(bx, gy + bh * d.top / rows, 3, Math.max(8, bh * ROWS / rows), 1.5); ctx.fillStyle = C.gold; ctx.fill();
      }
      const dex = d.list[d.sel];
      text(dex ? (sv.shiny && sv.shiny[dex] && f.show === 'shiny' ? '★ ' : '') + nameOf(dex) : T('Ninguno'), mid, gy + ROWS * (CS + GP) + 4, 11, '#fff', 'center', true);
      text(n ? (d.sel + 1) + ' / ' + n : '', mid, gy + ROWS * (CS + GP) + 20, 9.5, C.muted, 'center');
      tx('{alt} ' + T('Filtro') + '  {alt2} ' + T('Al azar'), mid, y + SH - 22, 10, C.muted, 'center');
    }

    // Los mandos 2-4 (ui.js sólo lee el del J1): listo, fuera, ◀ ▶ y la mini Pokédex, cada fotograma.
    // Botones de SDL (ps.pad().b): 0 ✕ · 1 ○ · 2 □ · 3 △ · 9 L1 · 10 R1 · 11-14 cruceta; L2/R2 analógicos.
    // El teclado (escritorio y web): si el J1 juega con mando, Enter/Espacio lo mete como otro jugador (ps.core_kb, main.c /
    // web.js) y desde ahí es un mando más (psKbBits). psKbOwn: 'a', su confirmar no va al J1; true, nada suyo va al J1.
    const kbOn = CAN.keyboard && ps.core_kb && globalThis.psKbBits;
    let kbHeld = kbOn ? psKbBits() : 0;   // (el Enter con que se abrió la sala no cuenta)
    function kbJoin() {
      if (!kbOn) return 0;
      const kb = ps.core_kb(0), b = psKbBits(), hasPad = (ps.pad(0) || {}).b !== undefined;
      globalThis.psKbOwn = kb ? true : hasPad ? 'a' : false; globalThis.psKbOwnT = ps.now();
      const tap = b & 1 && !(kbHeld & 1);
      kbHeld = b;
      if (kb || !hasPad || !tap) return kb;
      const k = ps.core_kb(1);
      if (k) { held[k] = b; G.Audio.sfx('select'); }   // (su Enter no lo pone ya «Listo»)
      return k;
    }
    function pads(now) {
      const kb = kbJoin();
      for (let i = 1; i < 4; i++) {
        const p = i === kb ? { b: psKbBits() } : ps.pad(i) || {};
        if (p.b === undefined) { held[i] = 0; rep[i] = null; continue; }
        const b = (p.b | 0) | ((p.l2 || 0) > 0.3 ? 1 << 20 : 0) | ((p.r2 || 0) > 0.3 ? 1 << 21 : 0), tap = bit => !!((b & 1 << bit) && !(held[i] & 1 << bit));
        const dir = b & 1 << 13 || (p.lx || 0) < -0.5 ? 'l' : b & 1 << 14 || (p.lx || 0) > 0.5 ? 'r'
          : b & 1 << 11 || (p.ly || 0) < -0.5 ? 'u' : b & 1 << 12 || (p.ly || 0) > 0.5 ? 'd' : '';
        // (como readInput: al mantener, 350 ms y luego cada 120 ms)
        let mv = '';
        if (dir && (!rep[i] || rep[i].dir !== dir)) { mv = dir; rep[i] = { dir, t: now + 350 }; }
        else if (dir && now > rep[i].t) { mv = dir; rep[i].t = now + 120; }
        else if (!dir) rep[i] = null;
        const k = { a: tap(0), b: tap(1), x: tap(2), y: tap(3), l1: tap(9), r1: tap(10), l2: tap(20), r2: tap(21),
                    dx: mv === 'l' ? -1 : mv === 'r' ? 1 : 0, dy: mv === 'u' ? -1 : mv === 'd' ? 1 : 0 };
        held[i] = b;
        if (!lists[i] && joined(i)) setup(i);
        if (out.has(i)) { if (k.a) { out.delete(i); ready[i] = false; G.Audio.sfx('select'); } }
        else if (!lists[i]) continue;
        else if (D[i] && D[i].mode) dexInput(i, k);
        else if (k.a) { ready[i] = !ready[i]; msg = ''; G.Audio.sfx(ready[i] ? 'confirm' : 'back'); }
        else if (k.b) { if (ready[i]) ready[i] = false; else out.add(i); G.Audio.sfx('back'); }
        else if (k.y && !ready[i]) openDex(i);
        else if (k.dx && !ready[i]) turn(i, k.dx);
      }
    }
    // El J1: L1/R1 (también Q/E y un clic en su icono, shoulders) y L2/R2, que readInput no da.
    const sh = shoulders();
    let held0 = 0;
    function pad0() {
      const bt = psPadRaw().buttons, l2 = bt[6] && !(held0 & 1), r2 = bt[7] && !(held0 & 2), s0 = sh();
      held0 = (bt[6] ? 1 : 0) | (bt[7] ? 2 : 0);
      if (D[0] && D[0].mode === 'grid' && (s0 || l2 || r2)) dexInput(0, { l1: s0 < 0, r1: s0 > 0, l2, r2 });
    }
    function start() {
      const wait = [1, 2, 3].filter(i => joined(i) && lists[i] && !ready[i]);
      if (wait.length) { msg = T('Esperando a que todos estén listos'); G.Audio.sfx('back'); return; }
      const d0 = dexOf(0);
      if (d0 && (d0 !== s.partner || !!s.partnerShiny !== (d0 === shinyOf[0]))) { s.partner = d0; s.partnerShiny = d0 === shinyOf[0]; G.DB.commit(); }
      globalThis.psCoopPick = {};
      for (let i = 1; i < 4; i++) if (joined(i) && lists[i]) psCoopPick[i] = { dex: dexOf(i), shiny: dexOf(i) === shinyOf[i] };
      if (kbOn) { const kb = ps.core_kb(0); if (kb && out.has(kb)) ps.core_kb(-1); globalThis.psKbOwn = false; }   // (fuera: vuelve al J1)
      G.Audio.sfx('confirm'); close(); G.UI.hideAll(); G.Game.startRun();
    }
    const leave = () => { if (kbOn) { ps.core_kb(-1); globalThis.psKbOwn = false; } globalThis.psCoopPick = null; globalThis.psCoopOut = null; G.Audio.sfx('back'); close(); G.DB.online ? friendsScreen() : mainMenu(); };
    open({ wheel: true,
      draw(now) {
        pads(now); pad0();
        modal('Cooperativo local');
        padText(T('Pulsa {confirm} para entrar') + ' · ' + T('cada mando'), BX + 18, BY + 48, 11, C.muted);
        const SW = 166, SY = BY + 74, SH = 290;
        for (let i = 0; i < 4; i++) {
          const x = BX + 18 + i * (SW + 10), on = i === 0 || (joined(i) && lists[i]), dm = on && D[i] && D[i].mode;
          rr(x, SY, SW, SH, 10);
          ctx.fillStyle = on ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.2)'; ctx.fill();
          ctx.globalAlpha = on ? 1 : 0.45; ctx.strokeStyle = PC[i]; ctx.lineWidth = 2; ctx.stroke(); ctx.globalAlpha = 1;
          text(T('Jugador') + ' ' + (i + 1), x + SW / 2, SY + 12, 12, PC[i], 'center', true);
          if (!on) { padText(T(out.has(i) ? 'Fuera' : 'Pulsa {confirm} para entrar'), x + SW / 2, SY + SH / 2 - 6, 11, C.muted, 'center'); continue; }
          if (dm) { dexDraw(i, x, SY, SW, SH); continue; }
          const dex = dexOf(i), sh = dex === shinyOf[i];
          if (dex) { preIdle([dex], sh); monBox(dex, x + 13, SY + 40, SW - 26, 150, 2, now, sh); }
          const name = dex ? (sh ? '★ ' : '') + G.DEX_BY[dex].name : '-';
          text(name, x + SW / 2, SY + 204, 12, '#fff', 'center', true);
          if (!(i && ready[i])) {   // ◀ ▶ (también con un clic)
            tri(x + 18, SY + 210, -1); tri(x + SW - 18, SY + 210, 1);
            if (!i) { hot(x + 4, SY + 194, 30, 30, false, () => turn(0, -1)); hot(x + SW - 34, SY + 194, 30, 30, false, () => turn(0, 1)); }
          }
          if (i) padText(ready[i] ? T('Listo') : '{confirm} ' + T('Listo') + '  {back} ' + T('Fuera'), x + SW / 2, SY + 238, 10.5, ready[i] ? '#7ee07a' : C.muted, 'center');
          else text(T('Tu compañero'), x + SW / 2, SY + 238, 10.5, C.muted, 'center');
          if (!(i && ready[i])) {
            (i ? padText : text)('{alt2} ' + T('Pokédex'), x + SW / 2, SY + 260, 10, C.muted, 'center');
            if (!i) hot(x + 30, SY + 254, SW - 60, 22, false, () => openDex(0));
          }
        }
        btn(BX + BW / 2 - 90, SY + SH + 14, 180, 30, T('Empezar'), 'gold', true, 13, undefined, start);
        if (msg) text(msg, BX + BW / 2, SY + SH + 52, 10.5, '#ffb0b8', 'center');
        const m0 = D[0] && D[0].mode;
        hints(m0 === 'filter' ? [['ud', 'Mover'], ['lr', 'Cambiar'], ['t', 'Limpiar'], ['o', 'Volver']]
          : m0 ? [['lr', 'Mover'], ['x', 'Elegir'], ['s', 'Filtro'], ['t', 'Al azar'], ['o', 'Cerrar']]
          : [['lr', 'Pokémon'], ['t', 'Pokédex'], ['x', 'Empezar'], ['o', 'Volver']]);
      },
      input(ev) {
        if (D[0] && D[0].mode) {
          if (ev.wheelRows && D[0].mode === 'grid') D[0].top = (D[0].top | 0) + ev.wheelRows;   // (sólo la vista)
          return dexInput(0, ev);
        }
        if (ev.dx) { turn(0, ev.dx); msg = ''; }
        if (ev.y) openDex(0);
        else if (ev.a) start();
        else if (ev.b) leave();
      },
    });
  }

  // Lo que cambia en la sala o en la conexión con los demás (js/net/social.js, net.js): para repintar.
  let socVer = 0, socHooked = false;
  function socHook() {
    if (socHooked) return;
    socHooked = true;
    G.Social.on(what => {
      // ponytail: diagnóstico del título (tras salir de una sala no llegan invitaciones): ¿llega el aviso y por qué no se enseña?
      const rm = G.Social.room;
      if (what !== 'peer') console.log('[social] aviso ' + what + ' · invitaciones ' + G.Social.invites.length + ' · sala ' + (rm ? rm.id.slice(0, 6) +
        ' (anfitrión ' + String(rm.host).slice(0, 6) + (rm.isHost ? ', yo' : '') + ', jugadores: ' + (rm.members || []).map(m => (m.name || '?') + '/' + String(m.uid).slice(0, 6) + '/' + m.dex).join(' ') + ')' : 'no') +
        ' · estado ' + G.Game.state + ' · pantalla ' + (!top ? 'ninguna' : top.invite ? 'invitación' : top.isMenu ? 'menú' : top.lobby ? 'sala' : top.social ? 'amigos' : 'otra'));
      socVer++; if (what === 'invites' || what === 'room') inviteCheck();
    });
    G.Net.onPeer(() => socVer++);
  }

  // Como #scr-lobby: los de la sala (hasta 4) con su Pokémon y su conexión, invitar amigos (el anfitrión) y
  // empezar. La red de la sala (G.Net.open / syncMembers) la sigue llevando LobbyUI de la web (social-ui.js).
  function lobbyScreen() {
    socHook();
    if (!G.Social.room) return mainMenu();
    G.Social.refreshMember();
    G.Social.ensureFriends().then(() => socVer++);
    let sel = 0;
    const room = () => G.Social.room;
    const free = () => G.Social.friends.filter(f => f.status === 'ok' && !room().members.some(m => m.uid === f.uid)).slice(0, 4);
    const canInvite = () => room().isHost && room().members.length < G.Social.MAX_PLAYERS;
    const mode = m => G.Net.mode(m.uid);
    const connecting = () => room().members.some(m => m.uid !== room().host && mode(m) === 'connecting');
    const failed = () => room().members.some(m => m.uid !== room().host && mode(m) === 'failed');
    const canStart = () => room().isHost && room().members.length >= 2 && !connecting() && !failed();
    // Lo que se puede elegir, de arriba abajo: invitar a cada amigo, empezar (el anfitrión), menú, salir.
    const items = () => [...(canInvite() ? free().map(f => ['inv', f]) : []), ...(room().isHost ? [['start']] : []), ['menu'], ['leave']];
    const connText = m => {
      const r = room();
      if (m.uid === r.host) return 'Anfitrión';
      if (!r.isHost) return m.uid === G.Social.uid ? 'Tú' : 'En la sala';
      if (G.Again.isAway(m.uid)) return 'Viendo el resumen';
      const md = mode(m);
      return md === 'direct' ? 'Conectado' : md === 'failed' ? 'No se pudo conectar (reintentando…)' : 'Conectando…';
    };
    const CW = (BW - 36 - 30) / 4, CY = BY + 70, CH = 150;
    const start = () => {
      const r = room();
      // hw: ¿Halloween? (como la web); turbo: el del anfitrión, para todos (trucos de Ajustes).
      // seed: la del mundo que el menú ya tiene preparado (psNextSeed, boot.js): con una nueva, el terreno se generaba de golpe
      // al empezar (Path.update 366 ms en la tablet de anfitrión). Sin hilos del suelo (la web), una al azar como antes.
      const pre = globalThis.psNextSeed ? psNextSeed() : 0;
      const cfg = { k: 'start', seed: pre || Math.floor(Math.random() * 1e6), host: r.host, hw: G.Halloween.on, turbo: globalThis.psTurbo ? psTurbo() : 1,
        members: r.members.map(m => ({ uid: m.uid, name: m.name, dex: m.dex, shiny: !!m.shiny })) };
      G.Social.setOpen(false);
      G.Net.broadcast(cfg);
      G.Flow.startCoop(cfg);
    };
    const me = { social: true, lobby: true,
      key: () => [sel, socVer, room() ? room().members.map(m => m.uid + m.dex + mode(m)).join() : '', G.Social.friends.length].join('|'),
      draw() {
        const r = room();
        if (!r) return;
        const ms = r.members;
        modal('Sala');
        const sub = r.isHost ? G.I18n.f('Eres el anfitrión. Invita a tus amigos (hasta {x}) y empezad cuando estéis.', G.Social.MAX_PLAYERS)
          : G.I18n.f('Estás en la sala de {x}. El anfitrión empezará la partida.', (ms.find(m => m.uid === r.host) || {}).name || '…');
        text(sub, BX + 18, BY + 46, 10.5, C.muted);
        for (let i = 0; i < G.Social.MAX_PLAYERS; i++) {
          const m = ms[i], x = BX + 18 + i * (CW + 10);
          rr(x, CY, CW, CH, 10); ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fill();
          ctx.strokeStyle = m ? G.Coop.COLORS[i] : 'rgba(244,248,255,0.18)'; ctx.lineWidth = m ? 3 : 1.5; ctx.stroke();
          if (!m) { text(T('Libre'), x + CW / 2, CY + CH / 2 - 6, 11, C.muted, 'center'); continue; }
          text(m.name, x + CW / 2, CY + 96, 13, G.Coop.COLORS[i], 'center', true);
          text((G.DEX_BY[m.dex] || {}).name || '', x + CW / 2, CY + 114, 9, C.muted, 'center');
          const t = connText(m);
          text(T(t), x + CW / 2, CY + 128, 9, t === 'Conectando…' || t === 'Viendo el resumen' ? C.gold : '#5fe08a', 'center');
        }
        const it = items();
        let y = CY + CH + 14;
        if (canInvite()) {
          text(T('Invitar amigos'), BX + 18, y, 13, '#fff', 'left', true); y += 20;
          if (!free().length) { text(T('Aún no tienes amigos añadidos.'), BX + 18, y + 2, 10, C.muted); y += 20; }
        }
        it.forEach(([k, f], i) => {
          const on = i === sel;
          if (k === 'inv') {
            rr(BX + 18, y, BW - 36, 26, 7); ctx.fillStyle = on ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.2)'; ctx.fill();
            ctx.beginPath(); ctx.arc(BX + 32, y + 13, 4, 0, 6.2832); ctx.fillStyle = '#5fe08a'; ctx.fill();
            text(f.name, BX + 44, y + 7, 11, '#fff', 'left', true);
            btn(BX + BW - 104, y + 3, 80, 20, T('Invitar'), 'gold', on, 10, undefined, () => { sel = i; });
            y += 30;
          }
        });
        const by = BY + BH - 78, bi = k => it.findIndex(x => x[0] === k);
        if (r.isHost) btn(BX + 18, by, BW - 36 - 280, 32, (G.Again.left ? G.I18n.f('Empezar ya ({x} s)', G.Again.left) : G.I18n.f('Empezar partida ({x})', ms.length + '/' + G.Social.MAX_PLAYERS)), canStart() ? 'gold' : 'ghost', sel === bi('start'), 13, undefined, () => { sel = bi('start'); });
        btn(BX + BW - 270, by, 120, 32, T('Menú'), 'ghost', sel === bi('menu'), 12, undefined, () => { sel = bi('menu'); });
        btn(BX + BW - 142, by, 124, 32, T('Salir de la sala'), 'ghost', sel === bi('leave'), 12, undefined, () => { sel = bi('leave'); });
        for (const k of ['menu', 'leave']) if (sel === bi(k)) { const x = k === 'menu' ? BX + BW - 270 : BX + BW - 142, w = k === 'menu' ? 120 : 124; rr(x - 3, by - 3, w + 6, 38, 10); ctx.strokeStyle = C.gold; ctx.lineWidth = 2; ctx.stroke(); }
        const note = !r.isHost ? 'Cuando el anfitrión empiece, entraréis todos a la vez.'
          : ms.length < 2 ? 'Necesitas al menos un amigo en la sala.'
          : failed() ? 'No se puede conectar con algún amigo: su red (o la tuya) no deja jugar en grupo. Probad con otra wifi o datos móviles; se reintenta solo.'
          : connecting() ? 'Conectando con tus amigos…'
          : G.Again.waiting ? 'Alguien sigue viendo el resumen: al empezar tendrá 10 s para volver.' : 'La partida empieza para todos a la vez.';
        wrap(T(note), BW - 36, 10).slice(0, 2).forEach((l, i) => text(l, BX + 18, by + 40 + i * 13, 10, C.muted));
        hints([['ud', 'Mover'], ['lr', 'Botones'], ['x', 'Elegir'], ['o', 'Menú']]);
      },
      live(now) {
        const r = room();
        if (r) r.members.slice(0, G.Social.MAX_PLAYERS).forEach((m, i) => monIn(m.dex, BX + 18 + i * (CW + 10), CY + 6, CW, 84, 2, now, { shiny: !!m.shiny }));
      },
      input(ev) {
        if (!room()) { close(); mainMenu(); return; }   // la sala se ha cerrado (lo avisa LobbyUI de la web)
        const it = items();
        if (sel >= it.length) sel = it.length - 1;
        // Arriba/abajo: los amigos para invitar y, debajo, la fila de botones; ←→ dentro de esa fila.
        const nInv = it.filter(x => x[0] === 'inv').length, row = it.map((x, i) => i).filter(i => i >= nInv);
        if (ev.dx && sel >= nInv) { const j = row.indexOf(sel); sel = row[(j + ev.dx + row.length) % row.length]; G.Audio.sfx('select'); }
        if (ev.dy) {
          const to = sel < nInv ? (sel + ev.dy < 0 ? sel : sel + ev.dy >= nInv ? row[0] : sel + ev.dy) : ev.dy < 0 && nInv ? nInv - 1 : sel;
          if (to !== sel) { sel = to; G.Audio.sfx('select'); }
        }
        if (ev.b) { G.Audio.sfx('back'); close(); mainMenu(); return; }
        if (!ev.a) return;
        const [k, f] = it[sel];
        if (k === 'inv') { G.Audio.sfx('confirm'); G.Social.invite(f.uid).then(r => G.UI.toast(r.ok ? r.msg : r.error), e => G.UI.toast(G.I18n.f('No se pudo invitar ({x}).', e.code || e.message), 3000)); }
        else if (k === 'start') { if (canStart()) { G.Audio.sfx('confirm'); G.Again.start(start); } else G.Audio.sfx('error'); }
        else if (k === 'menu') { G.Audio.sfx('back'); close(); mainMenu(); }
        else if (k === 'leave') { G.Audio.sfx('back'); close(); G.Social.leaveRoom().then(() => G.Net.close()); mainMenu(); }
      },
    };
    preIdle(room().members.map(m => m.dex));
    open(me);
  }

  globalThis.psAtMenu = () => !!(top && top.isMenu) && !booting;   // (update.js: sólo se aplica en el menú)
  globalThis.psTopInfo = () => (top ? (top.id || 'sin id') : 'ninguna') + (booting ? ', cargando' : '') + (waitText ? ', «' + waitText + '»' : '');

  // Como #invite-pop: «X te invita a jugar en su sala», abajo a la derecha, encima del menú, Amigos o la sala
  // (en otras pantallas espera a que vuelvas al menú). Unirme o No, gracias.
  function inviteCheck() {
    const room = G.Social.room;
    const list = G.Social.invites.filter(i => !room || i.room !== room.id).sort((a, b) => a.at - b.at);
    if (top && top.invite && !list.some(i => i.from === top.inv.from)) { const b = top.back; close(); open(b); }
    if (!list.length || G.Game.state !== 'ui' || !G.DB.loggedIn || !top || top.invite || !(top.isMenu || top.social)) return;
    const back = top, inv = list[0];
    let sel = 0;
    G.Audio.sfx('shiny');
    open({ invite: true, inv, back,
      key: n => 'inv|' + sel + '|' + back.key(n),
      draw(now) {
        back.draw(now);
        const w = 300, h = 84, x = W - w - 16, y = H - h - 44;
        box(x, y, w, h);
        icon('friends', x + 14, y + 12, 18);
        spans([[inv.name, C.gold, true], [' ' + T('te invita a jugar en su sala'), '#fff']], x + 38, y + 15, 11);
        btn(x + 14, y + 44, 160, 26, T('Unirme'), 'gold', sel === 0, 11, undefined, () => { sel = 0; });
        btn(x + 182, y + 44, w - 196, 26, T('No, gracias'), 'ghost', sel === 1, 11, undefined, () => { sel = 1; });
        if (sel === 1) { rr(x + 179, y + 41, w - 190, 32, 9); ctx.strokeStyle = C.gold; ctx.lineWidth = 2; ctx.stroke(); }
        hints([['lr', 'Mover'], ['x', 'Elegir'], ['o', 'No, gracias']]);
      },
      live(now) { if (back.live) back.live(now); },
      input(ev) {
        if (ev.dx) { sel = 1 - sel; G.Audio.sfx('select'); }
        if (ev.a && sel === 0) {
          G.Audio.sfx('confirm'); close(); open(back);
          G.UI.toast(T('Entrando en la sala…'), 4000);
          const t0 = ps.now();
          G.Social.acceptInvite(inv.from).then(r => {
            console.log('[sala] unirse a la de ' + inv.name + ': ' + (r.ok ? 'dentro' : r.error) + ' en ' + Math.round(ps.now() - t0) + ' ms');
            if (!r.ok) { G.UI.toast(r.error, 3000); return; }
            // A la sala desde el menú o las pantallas de amigos (aunque se hayan vuelto a abrir mientras tanto).
            if (G.Game.state === 'ui' && G.Social.room && (!top || top === back || top.isMenu || top.social) && !(top && top.lobby)) { if (top) close(); lobbyScreen(); }
          }, e => { console.warn('[sala] unirse: ' + (e.code || e.message)); G.UI.toast(G.I18n.f('No se pudo entrar en la sala ({x}).', e.code || e.message), 3000); });
        } else if (ev.b || ev.a) { G.Audio.sfx('back'); G.Social.declineInvite(inv.from); close(); open(back); }
      },
    });
  }

  // La web abre y cierra la sala desde el flujo (al acabar una partida en grupo, al empezarla): aquí, la de
  // mando. Y la partida en grupo puede empezar (la manda el anfitrión) con cualquier pantalla abierta.
  Object.assign(G.LobbyUI, {
    open: lobbyScreen,
    close() { if (top && (top.lobby || (top.invite && top.back.lobby))) close(); },
    render() { socVer++; },
  });
  const startCoop = G.Flow.startCoop;
  G.Flow.startCoop = function (cfg) {
    // Con el resumen aún abierto: se cierra y se entra (el anfitrión ya cuenta con todos; si no, se quedaba fuera
    // y en la partida su Pokémon quieto). Lo de la run ya se guardó en endRun.
    if (G.Game.state === 'over' && G.Social.room && overBack) overBack();
    if (G.Game.state !== 'ui' || !G.Social.room) return;
    if (top) close();
    G.UI.hideAll();
    return startCoop.call(this, cfg);
  };

  // ---------------- Trucos (antes God mode; Ajustes → Trucos) ----------------
  // Tres interruptores: todos los Pokémon, todos los shiny y mejoras al máximo. Con alguno encendido no se guarda nada:
  // al encender el primero se guarda una copia de toda la partida y al apagar el último vuelve tal cual (lo de mientras se
  // pierde). Ni la partida ni el perfil salen a la nube (net.js, psDevOn) y no hay marcas en el ranking.
  const PERF_KEY = 'ps5.perf', perfOn = () => G.U.ls.get(PERF_KEY) === '1';
  const Dev = (() => {
    const BACKUP = 'ps5.dev.backup', CHEATS = ['mons', 'shiny', 'upg', 'turbo', 'god'];
    const get = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
    const val = c => get('ps5.cheat.' + c) || '0', has = c => (guard(), val(c) !== '0');
    // Los trucos (y su copia) están en este aparato, no en la cuenta: son de la partida en la que se encendieron.
    // Al cerrar sesión se apagan (vuelve su partida de antes, onLeave abajo); si aparece otra partida con ellos encendidos
    // (otra cuenta, o de antes de esto), se quitan sin tocarla: apagarlos le metería la partida de la otra cuenta.
    let seen = null;
    function guard() {
      const s = G.DB.save, b = s && s !== seen && get(BACKUP);
      if (s) seen = s;
      if (!b) return;
      try { const o = JSON.parse(b); if (o.created === s.created || o.name === s.name) return; } catch (e) { /* copia rota: fuera */ }   // (el nombre: al juntarse con la nube, created puede bajar)
      console.log('[trucos] de otra partida: se quitan');
      try { for (const c of CHEATS) localStorage.removeItem('ps5.cheat.' + c); localStorage.removeItem(BACKUP); } catch (e) { /* nada */ }
      speed();
    }
    // Turbo (×2, ×4): el dt de la partida multiplicado (G.Game.debugSpeed de la web; el menú no cambia).
    // ponytail: un paso más largo, no más pasos: a ×4 y menos de 30 fps el núcleo da saltos de 0,13 s; si molesta, varios update.
    // Invencible: el núcleo no hace daño al jugador (ps.core_god) y, en el cooperativo online (JS de la web), Player.hurt no hace nada.
    // Cooperativo online: valen los trucos del anfitrión. El invitado juega sin los suyos (turbo, invencible, mejoras) y con
    // el turbo que manda el anfitrión al empezar (cfg.turbo, lobby). Si no, cada uno corría a su velocidad.
    let hostTurbo = 0, starting = false;   // hostTurbo > 0: soy invitado en esta partida
    const guest = () => hostTurbo > 0 && (starting || G.Coop.active);
    const turbo = () => (guest() ? hostTurbo : has('turbo') ? +val('turbo') : 1);
    const god = () => has('god') && !guest();
    const speed = () => { G.Game.debugSpeed(turbo()); if (ps.core_god) ps.core_god(god() ? 1 : 0); };
    speed();
    globalThis.psTurbo = turbo;   // (boot.js: el suelo, más adelantado; lobby: el turbo del anfitrión)
    const startRun0 = G.Game.startRun;
    G.Game.startRun = function (cfg) {
      const r = G.Social.room;
      hostTurbo = cfg && r && !r.isHost ? Math.max(1, +cfg.turbo || 1) : 0;
      starting = true;
      try { speed(); return startRun0.apply(this, arguments); } finally { starting = false; }
    };
    const hurt0 = G.Player.prototype.hurt;
    G.Player.prototype.hurt = function (...a) { return god() ? undefined : hurt0.apply(this, a); };
    const on = () => CHEATS.some(has);
    // (el God mode de antes, ps5.dev = 1: los tres encendidos, con su misma copia)
    if (get('ps5.dev') === '1') try { for (const c of CHEATS) localStorage.setItem('ps5.cheat.' + c, '1'); localStorage.removeItem('ps5.dev'); } catch (e) { /* nada */ }
    let maxed = null;
    const upgradesOf = G.DB.upgradesOf;
    G.DB.upgradesOf = dex => {
      if (!has('upg') || guest()) return upgradesOf(dex);
      return maxed || (maxed = Object.fromEntries(G.Upgrades.LIST.map(u => [u.id, u.max])));
    };
    // El movimiento inicial (y el segundo) que eliges con esas mejoras: el juego sólo lo respeta si la mejora está comprada de
    // verdad (save.pupg); con las mejoras al máximo, como si lo estuviera. Sin esto, en Mejoras se elegía y la partida empezaba con el de serie.
    globalThis.psDevOn = on;   // net.js: con trucos, la partida no sale a la nube
    globalThis.psCheat = (c, v) => set(c, v);   // (diagnóstico: el arnés)
    const startOf = G.startMoveOf, start2Of = G.startMove2Of;
    G.startMoveOf = dex => { const sv = G.DB.save, id = has('upg') && !guest() && sv && sv.pstart && sv.pstart[dex]; return id && G.startChoices(dex).includes(id) ? id : startOf(dex); };
    G.startMove2Of = dex => { const sv = G.DB.save, id = has('upg') && !guest() && sv && sv.pstart2 && sv.pstart2[dex];
      return id && id !== G.startMoveOf(dex) && G.startChoices(dex).includes(id) ? id : start2Of(dex); };
    // Cambia un truco: vuelve la partida de la copia y se aplican los que queden encendidos.
    function set(c, v) {
      const s = G.DB.save, store = v === true ? '1' : v === false ? '0' : String(v);
      if (!s || store === val(c)) return;
      // En partida (desde la pausa → Ajustes): la partida se acaba ya, con sus recompensas (monedas, tickets, estadísticas,
      // como al abandonarla), y al menú. El truco se aplica después de subir la partida: si no, con el truco ya puesto la
      // nube se cortaba (psDevOn) y esas recompensas no subían. (Al apagarlo, vuelve la copia: lo de la partida, fuera.)
      if (G.Game.player && G.Game.state !== 'ui' && G.Game.state !== 'over') {
        console.log('[trucos] ' + c + ' en partida: se acaba y al menú');
        close();
        G.Game.quit();
        if (overBack) overBack();   // (el resumen, directo al menú)
        const apply = () => { set(c, v); if (G.Game.state === 'ui' && !G.Social.room) mainMenu(); };
        // (la subida puede ir programada hasta 25 s después: db.js, MIN_GAP; se espera a que acabe, como mucho 40 s)
        const t0 = Date.now(), wait = () => (!G.DB.online || ['ok', 'offline', 'fail'].includes(G.DB.syncState) || Date.now() - t0 > 40e3 ? apply() : setTimeout(wait, 500));
        return void G.DB.saveNow().then(wait, wait);
      }
      try {
        if (v && !on()) localStorage.setItem(BACKUP, JSON.stringify(s));
        const b = get(BACKUP);
        if (b) { const old = JSON.parse(b); for (const k of Object.keys(s)) delete s[k]; Object.assign(s, old); }
        localStorage.setItem('ps5.cheat.' + c, store);
        speed();
        const now = Date.now();
        s.shiny = s.shiny || {};
        for (const p of G.DEX) {
          const m = G.SPRITE_META[p.dex];
          if (!m) continue;
          if (has('mons') && !s.owned[p.dex]) s.owned[p.dex] = { at: now, from: 'dev' };
          if (has('shiny') && m.sh && !s.shiny[p.dex]) { s.shiny[p.dex] = { at: now, from: 'dev' }; if (!s.owned[p.dex]) s.owned[p.dex] = { at: now, from: 'dev' }; }
        }
        if (!on()) localStorage.removeItem(BACKUP);
      } catch (e) { console.error('[trucos] ' + e.message); return; }
      G.DB.commit(true);
    }

    G.DB.onLeave(why => { if (why === 'logout') for (const c of CHEATS) if (has(c)) set(c, false); });   // (antes de subir lo pendiente: sube la de antes)

    // Partidas con trucos: sin marcas en el ranking (las vería todo el mundo).
    for (const k of ['submitSolo', 'submitGroup']) {
      const orig = G.Ranking[k];
      G.Ranking[k] = (...a) => (on() ? (console.log('[trucos] sin marca en el ranking'), null) : orig.apply(G.Ranking, a));
    }
    return { on, has, val, set };
  })();

  // ---------------- Ajustes (#scr-settings, js/ui/settings-ui.js) ----------------
  // Pestañas con L1/R1; filas con ↑↓; ✕ cambia (sí/no), ←→ mueve las barras y las opciones.
  let setTab = 0;
  function settingsScreen(back = mainMenu) {
    const S = G.Settings, A = G.Audio;
    const toggle = (key, label, desc) => ({ kind: 'toggle', label, desc, get: () => !!S.get(key), set: v => S.set(key, v) });
    const choice = (key, label, desc, opts) => ({ kind: 'choice', label, desc, opts, get: () => S.get(key), set: v => S.set(key, v) });
    const info = (label, desc) => ({ kind: 'info', label, desc });
    let langPick = G.I18n.lang;
    const resNow = Math.round(ps.H * 16 / 9) + 'x' + ps.H;   // (cuenta el alto: en escritorio es 16:9; en el móvil, el ancho es el de su pantalla)
    let resPick = resNow;
    let hwPick = (() => { try { return localStorage.getItem('ps5.halloween') || ''; } catch (e) { return ''; } })();
    const hwNow = hwPick;
    const TABS = [
      ['Sonido', () => [
        { kind: 'slider', label: 'Música', get: () => A.settings.music, set: v => A.setVolume('music', v) },
        { kind: 'slider', label: 'Efectos', get: () => A.settings.sfx, set: v => { A.setVolume('sfx', v); A.sfx('click'); } },
        { kind: 'toggle', label: 'Silenciar todo', get: () => !!A.settings.muted, set: () => A.toggleMute() },
      ]],
      ['Gráficos', () => [
        // ←→ elige, ✕ aplica: el juego vuelve a empezar en ese idioma (location.reload, main.c). Los nombres en
        // chino, en letras latinas: la fuente no tiene sus caracteres.
        { kind: 'choice', label: 'Idioma', desc: langPick !== G.I18n.lang ? T('Pulsa {confirm} para cambiar: el juego se reinicia.') : '',
          opts: G.I18n.choices.map(([v, l]) => [v, { 'zh-Hans': 'Zhongwen (jianti)', 'zh-Hant': 'Zhongwen (fanti)' }[v] || l]),
          get: () => langPick, set: v => { langPick = v; }, pending: () => langPick !== G.I18n.lang, apply: () => {
            if (langPick === G.I18n.lang) return;
            try { localStorage.setItem('ps.lang', langPick); } catch (e) { /* nada */ }
            location.reload();
            G.UI.toast(T('Se aplica al volver a abrir el juego.'), 4000);   // sólo se ve si no se pudo reiniciar
          } },
        // Resolución (escritorio): se guarda en resolution.txt (ps.DATA) y el programa se vuelve a abrir con ella.
        ...(CAN.resolution && ps.relaunch ? [{ kind: 'choice', label: 'Resolución',
          desc: resPick !== resNow ? T('Pulsa {confirm} para cambiar: el juego se reinicia.') : T('Más alta: más nítido, y más trabajo para el ordenador.'),
          opts: [['960x540', '960 × 540'], ['1280x720', '1280 × 720'], ['1600x900', '1600 × 900'], ['1920x1080', '1920 × 1080']],   // (más no: el juego dibuja a ×1,5 de 1280x720 como mucho; platform/sdl.c)
          get: () => resPick, set: v => { resPick = v; }, pending: () => resPick !== resNow, apply: () => {
            if (resPick === resNow) return;
            if (ps.writeFile(ps.DATA + '/resolution.txt', resPick)) ps.relaunch();
            else G.UI.toast(T('Se aplica al volver a abrir el juego.'), 4000);
          } }] : []),
        choice('quality', 'Calidad', 'Cuántos efectos y partículas se dibujan.', [['auto', 'Auto'], ['high', 'Alta'], ['mid', 'Media'], ['low', 'Baja']]),
        toggle('dmgNumbers', 'Números de daño', 'Los números que salen al golpear y al recibir daño.'),
        toggle('calm', 'Menos sacudidas y destellos', 'La cámara tiembla menos y los fogonazos son suaves.'),
      ]],
      ['Controles', () => [
        // Android: el joystick táctil de la web (G.Touch: flotante, anclado o fijo; su tamaño) y cómo se juega con el dedo.
        ...(CAN.touch ? [
          info('Toca la pantalla', 'Arrastra en cualquier sitio para moverte; toca un ataque o una esfera para usarlos y el botón de arriba a la derecha para pausar.'),
          choice('stickMode', 'Joystick', 'Dónde aparece el joystick: donde pones el dedo (y te sigue o se queda ahí) o siempre en el mismo sitio, abajo a la izquierda.',
            [['float', 'Flotante'], ['anchor', 'Anclado'], ['fixed', 'Fijo']]),
          choice('stick', 'Tamaño del joystick', 'Cuánto hay que arrastrar el dedo.', [[0.8, 'Pequeño'], [1, 'Normal'], [1.25, 'Grande']]),
          info('Mandos', 'Varios jugadores en este dispositivo: el teclado (si lo hay) es el jugador 1 y cada mando entra pulsando {confirm} en el suyo. Sin teclado, hacen falta dos mandos.'),
        ] : []),
        toggle('padRumble', 'Vibración', 'El mando vibra al recibir daño (si el mando y el navegador lo permiten).'),
        // Switch: el applet de mandos del sistema (ps.pad_setup, platform/switch.c), normal o un Joy-Con suelto por jugador.
        ...(CAN.padApplet && ps.pad_setup ? [
          { kind: 'button', label: 'Conectar mandos', desc: 'Mando Pro, Joy-Con en pareja o la consola en las manos.', go: () => { ps.pad_setup(4, false); settingsScreen(back); } },
          { kind: 'button', label: 'Joy-Con sueltos', desc: 'Un Joy-Con de lado por jugador: hasta 4 con dos pares.', go: () => { ps.pad_setup(4, true); settingsScreen(back); } },
        ] : []),
        // Con teclado, las teclas de la web (handleKeys de js/app.js); con mando, sus botones ({…}: padIcon).
        ...(globalThis.psKeys ? [
          info('WASD', 'moverse · elegir en los menús'),
          info('1-4 · Q / E', 'ataque anterior / siguiente'),
          info('5-8', T('usar') + ' · ' + T('Tus esferas')),
          info('ESC · P', 'pausa'),
          info('{confirm} / {back}', T('Elegir') + ' / ' + T('Volver')),
        ] : [
          info('{move} {side}', 'moverse · elegir en los menús'),
          info('{prev} / {next}', 'ataque anterior / siguiente'),
          info('{alt} / {alt2}', T('usar') + ' / ' + T('cambiar') + ' · ' + T('Tus esferas')),
          info('{menu}', 'pausa'),
          info('{confirm} / {back}', T('Elegir') + ' / ' + T('Volver')),
        ]),
      ]],
      ['Accesibilidad', () => [
        toggle('aimManual', 'Apuntar a mano', 'Tus ataques van hacia donde empujes el stick derecho del mando en vez de al enemigo más cercano.'),
      ]],
      ['Cuenta', () => {
        const btnRow = (label, go, stay) => ({ kind: 'button', label, go, stay });
        const again = () => settingsScreen(back);
        // Borrar cuenta (G.DB.deleteAccount de la web: la partida, el perfil, amigos, marcas y el usuario). Antes, ¿seguro?
        // (foco en «Cancelar»); las cuentas de nombre escriben su contraseña y las de Google vuelven a entrar con Google
        // (reauthenticateWithPopup, que aquí no hay: el mismo flujo que al entrar). Al acabar, el juego vuelve a empezar.
        const delAccount = () => {
          close();
          ask('Borrar cuenta', 'Se borrarán tu cuenta y toda tu partida, para siempre. ¿Seguro?', 'Borrar para siempre', 'Cancelar', ok => {
            if (!ok) return again();
            const go = async pass => {
              const cu = G.DB.fb && G.DB.fb.auth && G.DB.fb.auth.currentUser;
              if (cu && !G.DB.nameAccount && !CAN.page) cu.reauthenticateWithPopup = async function () { return this.reauthenticateWithCredential(await (tvMode() ? tvGoogle() : desktopGoogle())); };
              G.UI.toast(T('Borrando la cuenta…'));
              const r = await G.DB.deleteAccount(pass);
              console.log('[cuenta] borrar: ' + (r.ok ? 'hecho' : r.error));
              if (!r.ok) { G.UI.toast(T(r.error || 'No se pudo borrar la cuenta.'), 5000); G.Audio.sfx('error'); return again(); }
              G.UI.toast(T('Cuenta borrada'));
              location.reload();
            };
            if (G.DB.mode === 'cloud' && G.DB.nameAccount) keyboard('Contraseña', '', { mask: true, max: 64 }, v => (v ? go(v) : again()));
            else go('');
          });
        };
        const srv = [
          info(T('Servidor') + ': ' + Server.name(), 'Tu cuenta online, partida, amigos, ranking y cooperativo son de este servidor. Para usar otro, escribe su web (la que tiene pokesurvivor-server.json).'),
          btnRow('Cambiar de servidor', () => keyboard('Servidor', '', { max: 120 }, v => {
            if (v == null || !v.trim()) return again();
            G.UI.toast(T('Conectando…'));
            Server.load(v).then(err => { if (err === null) again(); else if (err) { G.UI.toast(T(err)); G.Audio.sfx('error'); again(); } });
          })),
          ...(Server.custom() ? [btnRow('Volver al servidor por defecto', () => Server.reset())] : []),
          ...(fromWebOk() ? [
            info('', 'Abre pokesurvivor.com en tu navegador y cambia tu partida de aquí (y la de la nube) por la que tengas allí.'),
            btnRow('Traer mi partida de la web', () => importFromWeb(again)),
          ] : []),
          ...(fromFileOk() ? [btnRow('Importar partida de un archivo', () => importFromFile(again))] : []),
        ];
        if (G.DB.mode === 'cloud' && !G.DB.guest) return [
          info(T('Cuenta') + ': ' + (G.DB.user || '') + accountEmail(), T({ ok: 'Guardado en la nube', syncing: 'Guardando…', pending: 'Sin guardar en la nube: pulsa Guardar',
            offline: 'Sin conexión: pulsa Guardar cuando vuelva' }[G.DB.syncState] || '')),
          btnRow('Guardar en la nube', () => {
            if (Dev.on()) { G.UI.toast(T('Con trucos no se guarda nada.')); G.Audio.sfx('error'); return; }
            cloudSave().then(() => { ver++; });
          }, true),
          btnRow('Cerrar sesión', () => { G.DB.logout().then(() => loginScreen()); }),
          btnRow('Borrar cuenta', delAccount),
          ...(CAN.consoleAccount ? [btnRow('Usar la cuenta de la consola', () => Cloud.set(false))] : []),
          ...srv,
        ];
        if (Cloud.on()) return [   // pedida la nube, pero no arrancó (sin red, sin el SDK...)
          info('Sin conexión con la nube', T('La cuenta online no se pudo abrir') + ' (' + (G.DB.localReason || '?') + ').'),
          btnRow('Reintentar', () => location.reload()),
          btnRow(CAN.consoleAccount ? 'Usar la cuenta de la consola' : 'Jugar sin conexión', () => Cloud.set(false)),
          ...srv,
        ];
        return [
          CAN.consoleAccount ? info('Cuenta de la consola', 'Tu partida se guarda sólo en esta PS5.') : info('Cuenta local', 'Tu partida se guarda sólo en este ordenador.'),
          btnRow('Usar una cuenta online', () => Cloud.set(true)),
          ...(G.DB.guest ? [] : [btnRow('Borrar cuenta', delAccount)]),
          info('', 'La misma cuenta y la misma partida que en la web. La primera vez puedes juntar tu partida de la consola con la online.'),
          ...srv,
        ];
      }],
      ['Trucos', () => [
        ...[['mons', 'Desbloquear todos los Pokémon'], ['shiny', 'Desbloquear todos los shiny'], ['upg', 'Mejoras al máximo'], ['god', 'Invencible']].map(([c, label]) => ({ kind: 'toggle', label,
          get: () => Dev.has(c), set: v => {
            if (!v || Dev.on()) return Dev.set(c, v);
            close();
            ask('Trucos: sin guardar', 'Mientras haya algún truco encendido, tu partida NO se guarda (ni aquí ni en la nube) y tus partidas no llegan al ranking. Al apagarlos vuelves a tu partida de antes; lo que pase mientras, se pierde.',
              'Activar', 'Cancelar', ok => { if (ok) Dev.set(c, true); settingsScreen(back); });
          } })),
        { kind: 'choice', label: 'Modo turbo', desc: T('La partida va más rápida (los menús no).'), opts: [['0', 'No'], ['2', '×2'], ['4', '×4']],
          get: () => Dev.val('turbo'), set: v => {
            if (v === '0' || Dev.on()) return Dev.set('turbo', v);
            close();
            ask('Trucos: sin guardar', 'Mientras haya algún truco encendido, tu partida NO se guarda (ni aquí ni en la nube) y tus partidas no llegan al ranking. Al apagarlos vuelves a tu partida de antes; lo que pase mientras, se pierde.',
              'Activar', 'Cancelar', ok => { if (ok) Dev.set('turbo', v); settingsScreen(back); });
          } },
        info('', 'Mientras haya alguno encendido no se guarda nada (ni aquí ni en la nube, ni a mano ni solo) y no hay marcas en el ranking. Al apagarlos todos vuelves a tu partida tal cual.'),
        { kind: 'toggle', label: 'Contador de FPS', desc: T('Los FPS y el fotograma más lento (ms), arriba a la derecha.'),
          get: perfOn, set: v => G.U.ls.set(PERF_KEY, v ? '1' : '0') },
        // Eventos: forzar uno encendido o apagado para probarlo (boot.js); ✕ aplica y el juego se reinicia.
        info('Eventos', 'Forzar el evento (mapa, caramelos, skins, banner). Pulsa {confirm} para aplicar: el juego se reinicia.'),
        { kind: 'choice', label: 'Halloween',
          opts: [['', 'Según la fecha'], ['1', 'Siempre'], ['0', 'Nunca']],
          get: () => hwPick, set: v => { hwPick = v; }, pending: () => hwPick !== hwNow,
          apply: () => { try { if (hwPick) localStorage.setItem('ps5.halloween', hwPick); else localStorage.removeItem('ps5.halloween'); } catch (e) { return; } location.reload(); } },
      ]],
      ['Acerca de', () => [
        info('PokéSurvivor Classic Native', 'Juego de fans gratuito y sin ánimo de lucro: sin anuncios ni compras. Pokémon y sus personajes son propiedad de Nintendo, Creatures y GAME FREAK; este proyecto no está afiliado a ellos.'),
        info('Sprites', 'PMD SpriteCollab y sus artistas (CC BY-NC 4.0).'),
        info('Datos de los Pokémon', 'PokéAPI.'),
        info('Música y sonidos', 'originales, generados por el propio juego.'),
        info('Fuente', 'Pixelify Sans (OFL).'),
        info(T('Versión'), PS_VERSION || '—'),
        info('Build', G.ENV.build || '—'),   // (el commit del que salió: tools/apply-env.mjs)
        // (el nombre de la plataforma sólo para enseñarlo)
        ({ web: info('Web', 'Las pantallas de las consolas y el escritorio · GPL-3.0'),
           desktop: info('Windows, macOS y Linux', 'QuickJS, PlutoVG, SDL2, libcurl, OpenSSL y libdatachannel · GPL-3.0'),
           android: info('Android', 'QuickJS, PlutoVG, SDL2, libcurl, OpenSSL y libdatachannel · GPL-3.0'),
           switch: info('Switch', 'QuickJS, PlutoVG, SDL2, libcurl, mbedTLS y libdatachannel · GPL-3.0') })[ps.PLATFORM]
          || info('PS5', 'QuickJS, PlutoVG y SDL2 · GPL-3.0'),
        { kind: 'button', label: 'Aviso legal y privacidad', go: () => legalScreen(() => settingsScreen(back)) },
      ]],
    ];
    const BW2 = 520, X = (W - BW2) / 2, Y = 48, BH2 = H - Y - 40, RW = BW2 - 36;
    const sh = shoulders();
    let sel = 0, scroll = 0, ver = 0, follow = true, setMax = 0;   // (la vista va a lo elegido con teclas; la rueda la mueve sola)
    const rows = () => TABS[setTab][1]();
    const rowH = r => 24 + (r.desc ? wrap(T(r.desc), r.kind === 'info' ? RW - 140 : RW - 150, 9).length * 12 : 0);
    open({ wheel: true,
      key: () => setTab + '|' + sel + '|' + ver,
      scrollNow: () => scroll,   // (desplazar no redibuja: scrollBegin)
      draw() {
        dim(); box(X, Y, BW2, BH2);
        text(T('Ajustes'), X + 18, Y + 16, 19.5, '#fff', 'left', true);
        btn(X + BW2 - 72, Y + 14, 56, 22, T('Cerrar'), 'ghost', false, 10);
        // Pestañas
        font(10, true);
        let tx = X + 40;
        padIcon('l1', X + 24, Y + 58);
        TABS.forEach(([name], i) => {
          const w = ctx.measureText(T(name)).width + 16, on = i === setTab;
          hot(tx, Y + 47, w, 22, false, () => { setTab = i; sel = 0; scroll = 0; });   // (ratón)
          rr(tx, Y + 47, w, 22, 6); ctx.fillStyle = on ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.2)'; ctx.fill();
          ctx.strokeStyle = on ? C.edge : 'transparent'; ctx.lineWidth = 1.5; ctx.stroke();
          text(T(name), tx + w / 2, Y + 52, 10, '#fff', 'center', true); font(10, true);
          tx += w + 4;
        });
        padIcon('r1', tx + 12, Y + 58);
        // Filas (.set-row)
        const list = rows(), top = Y + 80, vh = BH2 - 86, PAD = 8;   // PAD: que la primera fila no quede pegada a las pestañas
        let y = 0, selY = 0, selH = 0;
        list.forEach((r, i) => { if (i === sel) { selY = y; selH = rowH(r); } y += rowH(r) + 8; });
        if (follow) { if (selY < scroll) scroll = selY; else if (selY + selH + PAD * 2 > scroll + vh) scroll = selY + selH + PAD * 2 - vh; follow = false; }
        setMax = Math.max(0, y + PAD * 2 - vh);
        scroll = clamp(scroll, 0, setMax);
        scrollBegin(X + 3, top, BW2 - 6, vh, scroll);
        y = top + PAD - scroll;
        list.forEach((r, i) => {
          const h = rowH(r), on = i === sel;   // también en las de sólo texto: así se ve que se baja
          // Ratón: la fila se elige al momento, y el clic hace lo de su control (el punto del deslizador, ‹ › de una opción,
          // Sí/No, el botón); en una ya elegida que se aplica (Idioma, Resolución), aplica. Las de fuera del recuadro, no.
          if (y + h > vTop && y - 4 < vBot) hot(X + 12, y - 4, BW2 - 24, h + 4, on, (mx, my, ev) => {
            const was = sel === i, rx = X + BW2 - 24;
            sel = i;
            if (r.kind === 'slider' && mx >= rx - 156) r.set(Math.max(0, Math.min(1, Math.round((mx - (rx - 150)) / 150 * 20) / 20)));
            else if (r.kind === 'choice' && mx >= rx - 40) ev.dx = 1;
            else if (r.kind === 'choice' && mx >= X + BW2 / 2) ev.dx = -1;
            else if (r.kind === 'toggle' || r.kind === 'button' || (was && r.apply)) ev.a = true;
          }, () => { sel = i; });
          if (on) { rr(X + 12, y - 4, BW2 - 24, h + 4, 6); ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fill(); icon('cursor', X + 14, y + 2, 12); }
          const lx = X + 30;
          if (r.kind !== 'button') text(T(r.label), lx, y, 11, r.kind === 'info' ? C.gold : '#fff', 'left', true);
          if (r.desc) wrap(T(r.desc), r.kind === 'info' ? RW - 140 : RW - 150, 9).forEach((l, k) => text(l, lx, y + 16 + k * 12, 9, C.muted));
          const rx = X + BW2 - 24;
          if (r.kind === 'toggle') { const v = r.get(); btn(rx - 52, y, 52, 22, v ? T('Sí') : T('No'), v ? 'gold' : 'blue', on, 10); }
          else if (r.kind === 'button') { font(10, true); const bw = Math.max(90, ctx.measureText(T(r.label)).width + 24); btn(rx - bw, y - 2, bw, 22, T(r.label), 'blue', on, 10); }
          else if (r.kind === 'slider') {
            const v = r.get();
            rr(rx - 150, y + 6, 150, 6, 3); ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fill();
            rr(rx - 150, y + 6, 150 * v, 6, 3); ctx.fillStyle = C.gold; ctx.fill();
            rr(rx - 150 + 150 * v - 6, y + 2, 12, 14, 3); ctx.fillStyle = '#ffe37a'; ctx.fill(); ctx.strokeStyle = on ? '#fff' : C.edgeOut; ctx.lineWidth = 1.5; ctx.stroke();
            text(Math.round(v * 100) + '%', rx - 160, y + 2, 10, C.muted, 'right');
          } else if (r.kind === 'choice') {
            const cur = r.get(), o = r.opts.find(([v]) => v === cur) || r.opts[0];
            font(10, true); const w = Math.max(80, ctx.measureText(T(o[1])).width + 40);
            rr(rx - w, y, w, 22, 11); ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fill(); ctx.strokeStyle = on ? C.gold : 'rgba(244,248,255,0.25)'; ctx.lineWidth = 1.5; ctx.stroke();
            text('‹', rx - w + 8, y + 4, 11, on ? C.gold : C.muted, 'left', true); text('›', rx - 8, y + 4, 11, on ? C.gold : C.muted, 'right', true);
            text(T(o[1]), rx - w / 2, y + 5, 10, on ? C.gold : '#fff', 'center', true);
            // «Aplicar» con un clic o un toque (sin teclado ni mando no había forma de pulsar {confirm})
            if (r.apply && r.pending && r.pending()) {
              font(10, true); const aw = ctx.measureText(T('Aplicar')).width + 24, ax = rx - w - 8 - aw;
              btn(ax, y, aw, 22, T('Aplicar'), 'gold', false, 10);
              hot(ax, y, aw, 22, false, () => { sel = i; G.Audio.sfx('confirm'); r.apply(); ver++; });
            }
          }
          y += h + 8;
          ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fillRect(X + 18, y - 5, BW2 - 36, 1);
        });
        scrollEnd();
        topbar();
        const cur = list[sel], hh = [['ud', 'Mover']];
        if (cur && cur.kind === 'toggle') hh.push(['x', 'Cambiar']);
        if (cur && cur.kind === 'button') hh.push(['x', 'Abrir']);
        if (cur && (cur.kind === 'slider' || cur.kind === 'choice')) hh.push(['lr', 'Cambiar']);
        if (cur && cur.apply && (!cur.pending || cur.pending())) hh.push(['x', 'Aplicar']);
        hh.push(['o', 'Cerrar']);
        hints(hh);
      },
      input(ev) {
        const g = sh(), list = rows();
        if (g) { setTab = (setTab + g + TABS.length) % TABS.length; sel = 0; scroll = 0; G.Audio.sfx('select'); }
        if (ev.dy) {
          // las filas de sólo texto no se eligen, pero se pasa por ellas para poder leerlas
          sel = Math.max(0, Math.min(list.length - 1, sel + ev.dy)); follow = true; G.Audio.sfx('select');
        }
        if (ev.wheelPx) scroll = clamp(scroll + ev.wheelPx, 0, setMax);   // (sólo la vista)
        const r = list[sel];
        if (r && ev.dx) {
          if (r.kind === 'slider') r.set(Math.max(0, Math.min(1, Math.round((r.get() + ev.dx * 0.05) * 20) / 20)));
          else if (r.kind === 'choice') { const i = r.opts.findIndex(([v]) => v === r.get()); r.set(r.opts[(i + ev.dx + r.opts.length) % r.opts.length][0]); G.Audio.sfx('select'); }
          ver++;
        }
        if (ev.a && r && r.kind === 'toggle') { r.set(!r.get()); G.Audio.sfx('confirm'); ver++; }
        else if (ev.a && r && r.apply) { G.Audio.sfx('confirm'); r.apply(); ver++; }
        else if (ev.a && r && r.kind === 'button') { G.Audio.sfx('select'); if (r.stay) r.go(); else { close(); r.go(); } }
        else if (ev.b) { G.Audio.sfx('back'); close(); back(); }
      },
    });
  }

  // Medidas de la web a 1280x720, por 0,75.
  // (MX y LX, en fit(): cambian con el tamaño de la pantalla)
  const MY = 48, MW = 247;
  const hms = ms => { const t = Math.floor(ms / 1000); return [Math.floor(t / 3600) % 24, Math.floor(t / 60) % 60, t % 60].map(v => String(v).padStart(2, '0')).join(':'); };
  const hwLeft = ms => { const d = Math.floor(ms / 864e5); return d ? G.I18n.f('{x} d {x}', d, hms(ms)) : hms(ms); };
  function hwText() {
    const c = G.Halloween.countdown();
    return G.Halloween.on ? (c && c.on ? G.I18n.f('¡Halloween! Termina en {x}', hwLeft(c.ms)) : T('¡Halloween!'))
      : c && !c.on ? G.I18n.f('Halloween empieza en {x}', hwLeft(c.ms)) : '';
  }   // panel del menú; centro de la columna izquierda
  // La barra de arriba, de izquierda a derecha (como #topbar): Guardar y Salir sólo con la cuenta en la nube (con la
  // de la consola, salir sería volver a entrar en la misma); Apoyar si hay Ko-fi.
  const fullOk = () => !!(ps.fullOk && ps.fullOk());   // pantalla completa: sólo la web (web.js)
  function barList() {
    const cloud = G.DB.mode === 'cloud';
    return [...(G.Funding && G.Funding.url ? ['support'] : []),
      'user', ...(cloud && !G.DB.guest ? ['save'] : []), 'news', 'sound', ...(fullOk() ? ['full'] : []), ...(cloud ? ['logout'] : [])];
  }

  // QR centrado en cx, de QS px como mucho: blanco con 4 módulos de margen, como pide el estándar.
  function qrAt(qr, cx, y, QS) {
    const k = Math.floor(QS / (qr.size + 8)), side = k * (qr.size + 8), qx = Math.round(cx - side / 2);
    ctx.fillStyle = '#fff'; ctx.fillRect(qx, y, side, side);
    ctx.fillStyle = '#000';
    for (let my = 0; my < qr.size; my++) for (let mx = 0; mx < qr.size; mx++)
      if (qr.dark(mx, my)) ctx.fillRect(qx + (mx + 4) * k, y + (my + 4) * k, k, k);
  }
  // Apoyar: dos Ko-fi, cada uno con su QR: primero el de esta versión (DevVeda), a la derecha el del autor original.
  const KOFI_PS5 = 'https://ko-fi.com/DevVeda';
  function kofiScreen() {
    const cols = [[KOFI_PS5, 'PokéSurvivor Classic Native'], [G.Funding.url, T('Autor original')]].map(([url, who]) => [url, who, globalThis.psQR ? psQR(url) : null]);
    const WEBLINK = CAN.browser;   // (sin navegador: sólo el QR)
    let pick = 0;
    const go = i => { pick = i; if (ps.open_url(cols[i][0])) G.Audio.sfx('confirm'); else { G.UI.toast(T('No se pudo abrir el navegador.')); G.Audio.sfx('error'); } };
    open({
      key: () => 'kofi|' + pick,
      draw() {
        const lines = [T('La versión original de PokéSurvivor era de código abierto; desde el 4 de noviembre de 2026 es de código cerrado.'),
          T('PokéSurvivor Classic es gratis, sin anuncios ni compras. Si quieres ayudar a pagar los servidores, puedes donar en Ko-fi (escanéalo con el móvil):')]
          .flatMap(t => wrap(t, 520, 11));
        const dy = Math.max(0, lines.length - 2) * 15;   // (lo que bajan los QR con más líneas de texto)
        const [x, y] = centerBox(560, 330 + dy, T('Apoyar'));
        lines.forEach((l, i) => text(l, W / 2, y + 46 + i * 15, 11, C.muted, 'center'));
        cols.forEach(([url, who, qr], i) => {
          const cx = x + 140 + i * 280;
          text(who, cx, y + 92 + dy, 13, C.gold, 'center', true);
          if (qr) qrAt(qr, cx, y + 114 + dy, 150);
          const u = url.replace(/^https:\/\//, '');
          if (!WEBLINK) { text(u, cx, y + 276 + dy, 11, '#fff', 'center', true); return; }
          // Con navegador (escritorio, Android): el enlace se abre con un clic, un toque o ✕ (←→ elige cuál)
          font(11, true); const uw = ctx.measureText(u).width;
          text(u, cx, y + 276 + dy, 11, '#7cc4ff', 'center', true);
          ctx.fillStyle = '#7cc4ff'; ctx.fillRect(cx - uw / 2, y + 290 + dy, uw, 1);
          hot(cx - uw / 2 - 6, y + 270 + dy, uw + 12, 26, false, () => go(i));
          if (i === pick) ring(cx - uw / 2 - 6, y + 270 + dy, uw + 12, 26, 7);
        });
        hints(WEBLINK ? [['lr', 'Mover'], ['x', 'Abrir'], ['o', 'Volver']] : [['o', 'Volver']]);
      },
      input(ev) {
        if (WEBLINK && ev.dx) { pick = (pick + 1) % cols.length; G.Audio.sfx('select'); }
        else if (WEBLINK && ev.a) go(pick);
        else if (ev.b || ev.a) { G.Audio.sfx('back'); close(); mainMenu(); }
      },
    });
  }
  // Arriba a la izquierda del menú: Apoyar (Ko-fi), sólo con su icono. Sin el banner de la web (Discord y el último vídeo)
  // ni el botón de YouTube: el dueño los quitó el 05-11.
  function sideCol(focus) {
    const x = 12 - OX, y = 10;
    if (G.Funding && G.Funding.url) {
      btn(x, y, 30, 26, null, 'gold', false); icon('heart', x + 7, y + 5, 16); if (focus === 'support') ring(x, y, 30, 26, 7);
      hot(x, y, 30, 26, focus === 'support', () => barGo('support'));   // (ratón)
    }
  }

  // En la PS5 no hay navegador: lo que en la web abre otra pestaña (window.open) sale aquí, para abrirlo en el móvil.
  function linkScreen(title, url, why, back = mainMenu) {
    const qr = globalThis.psQR ? psQR(url) : null;   // para escanear con el móvil (shim/qr.js)
    open({
      key: () => url,
      draw() {
        const QS = qr ? 168 : 0, h = 170 + (qr ? QS + 16 : 0);
        const [x, y] = centerBox(460, h, T(title));
        wrap(T(why), 420, 11).forEach((l, i) => text(l, W / 2, y + 48 + i * 15, 11, C.muted, 'center'));
        let ty = y + 92;
        if (qr) { qrAt(qr, W / 2, ty, QS); ty += QS + 16; }
        rr(x + 20, ty, 420, 34, 8); ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fill();
        text(url.replace(/^https:\/\//, ''), W / 2, ty + 9, 15, C.gold, 'center', true);
        hints([['o', 'Volver']]);
      },
      input(ev) { if (ev.b || ev.a) { G.Audio.sfx('back'); close(); back(); } },
    });
  }
  // (la web tiene navegador: window.open de verdad; si no, la ventana de Google de Firebase salía como este QR)
  if (!CAN.page) globalThis.open = url => { const back = top; if (top) close(); linkScreen('Abrir en el móvil', String(url), 'Escanéalo con el móvil o escribe la dirección en el navegador:', back ? () => open(back) : mainMenu); return null; };

  function logoutScreen() {
    let yes = false;
    open({
      key: () => String(yes),
      draw() {
        const [x, y] = centerBox(400, 130, T('¿Cerrar sesión?'));
        text(T('Lo de esta cuenta queda guardado en la nube.'), W / 2, y + 46, 11, C.muted, 'center');
        btn(x + 50, y + 80, 140, 30, T('Salir'), 'blue', yes, 12, undefined, () => { yes = true; });
        btn(x + 210, y + 80, 140, 30, T('No'), 'gold', !yes, 12, undefined, () => { yes = false; });
        hints([['lr', 'Mover'], ['x', 'Elegir'], ['o', 'No']]);
      },
      input(ev) {
        if (ev.dx) { yes = !yes; G.Audio.sfx('select'); }
        if (ev.a && yes) {
          close(); G.Audio.music(null);
          // Como el botón Salir de la web (menu.js), con lo pendiente subido antes.
          G.DB.saveNow().catch(() => {}).then(() => G.DB.logout()).then(() => G.Flow.toLogin());
        } else if (ev.a || ev.b) { G.Audio.sfx('back'); close(); mainMenu(); }
      },
    });
  }
  let menuSel = 0, menuBar = -1;   // al volver al menú, el cursor en la opción (o el botón de arriba) de la que se vino
  function mainMenu() {
    const keep = globalThis.psMenuRemember !== false;   // (el arnés de Node lo apaga: cuenta desde Jugar)
    let sel = keep ? menuSel : 0, bar = keep && menuBar < barList().length ? menuBar : -1;   // bar >= 0: el cursor está en la barra de arriba (BAR[bar])
    try { fixName(); } catch (e) { console.error('[cuenta] fixName: ' + e.message); }
    const fromRun = G.Game.state !== 'ui';
    if (fromRun) { const t = ps.now(); G.Game.toUI(); console.log('[menu] salir de la partida (toUI): ' + Math.round(ps.now() - t) + ' ms'); }
    // El suelo de la próxima run, pintándose ya (boot.js). Después de toUI: al volver de una partida el estado aún era 'over'
    // y psPrepareRun no cargaba ese mundo, así que al pulsar Jugar se generaba todo de golpe (~0,5 s de parón).
    // Al volver de una partida, en el fotograma siguiente: así primero sale la pantalla de carga (el sorteo de enemigos y
    // sus precargas eran un parón en seco de ~0,3 s antes de ella).
    const prep = () => { if (!globalThis.psPrepareRun || G.Game.state !== 'ui') return; const t = ps.now(); psPrepareRun(); console.log('[menu] preparar la próxima partida: ' + Math.round(ps.now() - t) + ' ms'); };
    if (fromRun) setTimeout(prep, 0); else prep();
    // Al volver de una partida: la pantalla de carga mientras el juego monta el mundo del menú (World.update ~150 ms, sus
    // temporizadores ~100 ms) y se prepara el terreno de la siguiente; se quita cuando ya no queda nada (bootCover).
    if (ps.PAD !== 'node' && !CAN.page && !booting && (fromRun || (globalThis.psPreBusy && psPreBusy()))) { booting = true; bootT0 = 0; bootCalm = 0; }
    if (fromRun) bootCalm = -10;   // (la preparación llega en el fotograma siguiente: que no se quite antes)
    G.UI.hideAll();
    G.Audio.music('village');
    socialOnMenu();
    const s = G.DB.save;
    const shinyOn = () => !!s.partnerShiny && G.DB.ownsShiny(s.partner);
    const setShiny = v => { s.partnerShiny = v; G.DB.commit(); preIdle([s.partner], v); };
    open({ isMenu: true,
      key: () => sel + '|' + bar + '|' + hwText() + '|' + G.Halloween.on + '|' + G.DB.syncState + '|' + G.Audio.settings.muted + '|' + s.partner + '|' + s.coins + '|' + shinyOn() + '|' + sum(s.bag) + '|' + sum(s.tms) + '|' + s.tickets.t1 + '|' + s.tickets.t10,
      draw() {
        // Columna derecha: degradado oscuro (.menu-right)
        const g = ctx.createLinearGradient(MX - 19, 0, W + OX, 0);
        g.addColorStop(0, 'rgba(5,10,25,0)'); g.addColorStop(0.3, 'rgba(5,10,25,0.65)'); g.addColorStop(1, 'rgba(5,10,25,0.65)');
        ctx.fillStyle = g; ctx.fillRect(MX - 19, -OY, W + OX - MX + 19, H + 2 * OY);
        // Logo
        text('PokéSurvivor', LX + 4.5, 104.5, 48, C.navy, 'center', true, null);
        text('PokéSurvivor', LX + 2.25, 102.25, 48, '#a55f00', 'center', true, null);
        text('PokéSurvivor', LX, 100, 48, C.gold, 'center', true, null);
        spaced(('Classic Native · ' + T('Mundo Misterioso')).toUpperCase(), LX, 158, 13, 2.5);
        // Halloween: cuenta atrás bajo el título (hwLine de la web): 14 días antes, cuánto falta; durante, cuánto queda.
        const hw = hwText();
        if (hw) { font(11, true); const hw2 = ctx.measureText(hw).width + 18; icon('pumpkin', LX - hw2 / 2, 175, 14); text(hw, LX - hw2 / 2 + 18, 176, 11, '#ffb347', 'left', true); }
        // El compañero
        const mon = G.DEX_BY[s.partner], sh = shinyOn();
        stage(LX - 98, 190, 196, 150, sh ? '#9ae6ff' : G.U.TYPE_COLOR[mon.types[0]], sh);
        text(mon.name, LX, 352, 18, '#fff', 'center', true);
        if (sh) { font(18, true); icon('shiny', LX + ctx.measureText(mon.name).width / 2 + 4, 352, 18); }
        const tw = typeChips(mon.types, LX - 9, 378, true);
        icon(G.Icons.RARITY_BALL[mon.rarity] || 'ball', LX + tw / 2 - 2, 377, 12);
        if (G.DB.ownsShiny(s.partner)) {
          btn(LX - 62, 400, 60, 20, T('Normal'), 'ghost', !sh, 10);
          btn(LX + 2, 400, 60, 20, 'Shiny', 'ghost', sh, 10, 'shiny');
          hot(LX - 62, 400, 60, 20, false, () => setShiny(false)); hot(LX + 2, 400, 60, 20, false, () => setShiny(true));   // (clic o toque: directo)
        }
        // Panel del menú
        box(MX, MY, MW, 404);
        let y = MY + 10;
        MENU.forEach(([label, ico, sub], i) => {
          const play = i === 0, h = play ? 44 : 34, on = i === sel && bar < 0;
          hot(MX + 8, y, MW - 16, h - 2, on, null, () => { sel = i; bar = -1; });   // (ratón: foco directo)
          if (on) { rr(MX + 8, y, MW - 16, h - 2, 5); ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fill(); icon('cursor', MX + 11, y + h / 2 - 9, 14); }
          icon(ico, MX + 28, y + h / 2 - 10, 20);
          const px = play ? 18 : 13, col = play ? C.gold : '#fff';
          text(T(label), MX + 54, y + (play ? 6 : 5), px, col, 'left', true);
          let st = T(sub());
          font(8.5); while (st.length > 4 && ctx.measureText(st).width > MW - 70) st = st.slice(0, -2) + '…';
          text(st, MX + 54, y + h - 15, 8.5, C.muted, 'left');
          y += h;
        });
        // Estadísticas (#menu-stats)
        box(MX, 466, MW, 56);
        const st = s.stats, b = v => [String(v), '#fff', true], m = t => [t, C.muted];
        spans([m('Runs '), b(st.runs), m(' · ' + T('Mejor tiempo') + ' '), b(G.U.mmss(st.bestTime))], MX + 14, 480, 10.5);
        spans([m(T('Mejor nivel') + ' '), b(st.bestLevel), m(' · ' + T('Derrotados') + ' '), b(st.totalKills.toLocaleString())], MX + 14, 498, 10.5);
        topbar(barList()[bar]);
        sideCol(barList()[bar]);
        // Abajo a la izquierda: quién hace esta versión y las licencias (el aviso «Required Notice» de la licencia del juego).
        text(T('Versión nativa por DevVeda (GPL-3.0) · Juego original © 2026 JPTER78 (PolyForm Noncommercial 1.0.0)'), 10 - OX, H - 26, 8, 'rgba(185,203,240,0.7)', 'left', false, '#000');
        text(T('Proyecto de fan sin ánimo de lucro · Sprites: SpriteCollab (CC BY-NC 4.0) · Pokémon © Nintendo/Creatures/GAME FREAK'), 10 - OX, H - 14, 8, 'rgba(185,203,240,0.7)', 'left', false, '#000');
        const h = [['ud', 'Mover'], ['x', 'Elegir']];
        if (G.DB.ownsShiny(s.partner)) h.push(['lr', 'Normal / shiny']);
        hints(bar >= 0 ? [['lr', 'Mover'], ['x', 'Elegir'], ['o', 'Volver']] : h, MX - 30);
      },
      live(now) { drawMon(s.partner, LX, 318, 3, now, shinyOn(), 0, G.Skins.worn(s, s.partner)); },
      input(ev) {
        if (bar >= 0) {   // en la barra de arriba
          const BAR = barList();
          if (ev.dx) { bar = (bar + ev.dx + BAR.length) % BAR.length; G.Audio.sfx('select'); }
          if (ev.dy > 0 || ev.b) { bar = menuBar = -1; sel = 0; G.Audio.sfx('select'); }
          else if (ev.a) {
            menuBar = bar;
            barGo(BAR[bar]);
          }
          return;
        }
        if (ev.dy < 0 && sel === 0) { bar = barList().indexOf('news'); G.Audio.sfx('select'); return; }
        if (ev.dy) { sel = (sel + ev.dy + MENU.length) % MENU.length; G.Audio.sfx('select'); }
        // △ o ←→: los botones Normal / Shiny de debajo del compañero.
        if (G.DB.ownsShiny(s.partner) && (ev.y || (ev.dx && shinyOn() !== ev.dx > 0))) {
          setShiny(ev.y ? !shinyOn() : ev.dx > 0); G.Audio.sfx('confirm');
        }
        if (ev.a) { G.Audio.sfx(sel ? 'select' : 'confirm'); menuSel = sel; menuBar = -1; const fn = MENU[sel][3]; close(); fn(); }
        else if (ev.a) G.Audio.sfx('error');
      },
    });
    preIdle([s.partner], shinyOn());
    if (G.DB.online) { socHook(); inviteCheck(); }   // una invitación que llegó en otra pantalla
  }

  // El flujo de la web (Flow) abre aquí sus pantallas: el menú, la elección de inicial, y la cuenta.
  // En la PS5 hay una cuenta local de la consola, que se crea sola la primera vez.
  const ACCOUNT = ['Entrenador', 'ps5-local'];
  Object.assign(G.Flow, {
    tapToStart(then) { G.Audio.unlock(); then(); },
    async toLogin() {
      if (G.DB.mode === 'cloud') return loginScreen();
      let r = await G.DB.login(...ACCOUNT);
      if (!r.ok) r = await G.DB.register(...ACCOUNT);
      if (!r.ok) { console.error('[ui] sin cuenta local: ' + r.error); G.DB.playAsGuest(); }
      this.afterLogin();
    },
    afterLogin() { if (!G.DB.save.partner) personalityTest(); else this.goMenu(); },
    goMenu() { mainMenu(); },
  });
  // En modo nube, si Firebase no contesta, no quedarse sin menú: a los 15 s, pantalla para reintentar o volver
  // a la cuenta de la consola.
  globalThis.psStartFlow = () => {
    let settled = false;
    if (Cloud.on()) setTimeout(() => { if (!settled) { console.warn('[cuenta] la nube no contesta al arrancar'); cloudFailScreen(); } }, 15000);
    return G.DB.ready().then(r => {
      settled = true;
      console.log('[cuenta] arranque: modo ' + G.DB.mode + (G.DB.localReason ? ' (' + G.DB.localReason + ')' : '') + ', sesión ' + (r ? 'sí' : 'no'));
      if (top && top.cloudFail) close();
      return r ? (G.DB.mode === 'cloud' ? afterCloudLogin() : G.Flow.afterLogin()) : G.Flow.toLogin();
    });
  };
  function cloudFailScreen() {
    let sel = 0;
    open({ cloudFail: true,
      key: () => String(sel),
      draw() {
        const [x, y] = centerBox(460, 200, T('No se pudo abrir la cuenta online'));
        wrap(T(CAN.consoleAccount ? 'Firebase no contesta. Puedes reintentarlo o seguir con la cuenta de la consola (tu partida de esta PS5).'
          : 'Firebase no contesta. Puedes reintentarlo o jugar sin conexión (tu partida de este ordenador).'), 420, 10.5)
          .forEach((l, i) => text(l, x + 20, y + 52 + i * 14, 10.5, '#fff'));
        btn(x + 20, y + 130, 200, 32, T('Reintentar'), 'blue', sel === 0, 12, undefined, () => { sel = 0; });
        btn(x + 240, y + 130, 200, 32, T(CAN.consoleAccount ? 'Usar la cuenta de la consola' : 'Jugar sin conexión'), 'gold', sel === 1, 11, undefined, () => { sel = 1; });
        hints([['lr', 'Mover'], ['x', 'Elegir']]);
      },
      input(ev) {
        if (ev.dx) { sel = 1 - sel; G.Audio.sfx('select'); }
        if (ev.a) { G.Audio.sfx('confirm'); if (sel) Cloud.set(false); else location.reload(); }
        else if (ev.b) { G.Audio.sfx('back'); Cloud.set(false); }   // ○: seguir sin la cuenta online (lo de la derecha)
      },
    });
  }

  const draw0 = globalThis.psOverlay;
  // FPS arriba a la derecha: la media de cada medio segundo y el fotograma más lento de ese rato (ms).
  // Ajustes → Trucos → «Contador de FPS» (aparte de los trucos).
  let fpsT = 0, fpsN = 0, fpsLast = 0, fpsWorst = 0, fpsTxt = '';
  function fpsCounter(now) {
    if (fpsLast) fpsWorst = Math.max(fpsWorst, now - fpsLast);
    fpsLast = now; fpsN++;
    if (now - fpsT >= 500) { fpsTxt = Math.round(fpsN * 1000 / (now - fpsT)) + ' FPS · ' + Math.round(fpsWorst) + ' ms'; fpsT = now; fpsN = 0; fpsWorst = 0; }
    screen.setTransform(K, 0, 0, K, OX * K, OY * K);
    screen.font = 'bold 12px ' + FONT; screen.textAlign = 'right'; screen.textBaseline = 'top';
    // (debajo de la barra de arriba, pegado a la derecha: encima tapaba sus botones)
    screen.fillStyle = 'rgba(0,0,0,0.55)'; screen.fillRect(W + OX - 112, 42, 110, 18);
    screen.fillStyle = '#9fffa0'; screen.fillText(fpsTxt, W + OX - 6, 45);
  }
  // ---------------- avisos ----------------
  // G.UI.toast (.toast: abajo en el centro) y el aviso de logros de js/systems/progress.js (.ach-pop: arriba),
  // que escribe en el elemento #ach-pop: aquí se lee y se pinta encima de todo.
  let toastMsg = '', toastUntil = 0;
  G.UI.toast = (msg, ms = 2200) => { toastMsg = T(strip(msg)); toastUntil = ps.now() + ms; };
  function notices(now) {
    ctx = screen;
    screen.save(); screen.setTransform(K, 0, 0, K, OX * K, OY * K);
    if (toastMsg && now < toastUntil) {
      font(12);
      const w = Math.min(W - 40, ctx.measureText(toastMsg).width + 28), x = (W - w) / 2, y = H - 22 - 30;
      rr(x, y, w, 30, 8); ctx.fillStyle = 'rgba(10,20,50,0.95)'; ctx.fill(); ctx.strokeStyle = C.edge; ctx.lineWidth = 1.5; ctx.stroke();
      text(toastMsg, W / 2, y + 9, 12, '#fff', 'center');
    }
    const achEl = document.getElementById('ach-pop');   // lo crea progress.js al primer logro
    if (achEl && achEl.innerHTML && !achEl.classList.contains('hidden')) {
      const h = achEl.innerHTML, title = T(strip((/<b>([\s\S]*?)<\/b>/.exec(h) || [])[1] || '')), sub = T(strip((/<small>([\s\S]*?)<\/small>/.exec(h) || [])[1] || ''));
      font(12, true); let w = ctx.measureText(title).width;
      font(10); w = Math.min(W - 40, Math.max(w, ctx.measureText(sub).width) + 70);
      const x = (W - w) / 2, y = 48, bh = sub ? 46 : 34;
      box(x, y, w, bh);
      rr(x, y, w, bh, 9); ctx.strokeStyle = C.gold; ctx.lineWidth = 2; ctx.stroke();
      icon('medal3', x + 14, y + bh / 2 - 10, 20);
      text(title, x + 44, y + 9, 12, C.gold, 'left', true);
      if (sub) text(sub, x + 44, y + 26, 10, C.muted);
    }
    screen.restore();
  }
  // Pantalla de carga del arranque: tapa el menú a medio montar (fondo que cambia, tirones de los primeros segundos) hasta
  // que hay una pantalla abierta y nada carga (red, imágenes, terreno) durante 20 fotogramas seguidos; como mucho 20 s.
  // Las pantallas se siguen dibujando debajo (así piden sus sprites) pero no reciben el mando (readInput).
  let bootT0 = 0, bootCalm = 0;
  let bootLog = 0;
  function bootCover(now) {
    if (!bootT0) { bootT0 = now; bootLog = now; }
    // Offline first: la red no tapa el juego (sólo imágenes y terreno); lo online carga después, con su círculo en la esquina.
    const busy = (globalThis.psImgsPending ? psImgsPending() : 0) + (globalThis.psPreBusy && psPreBusy() ? 1 : 0);
    bootCalm = top && !busy ? bootCalm + 1 : 0;
    // Diagnóstico (la vuelta al menú tras el cooperativo local tardaba mucho): cada segundo, qué la tiene puesta.
    if (now - bootLog >= 1000) {
      bootLog = now;
      const pre = globalThis.psPreBusy && psPreBusy();
      console.log('[carga] ' + ((now - bootT0) / 1000).toFixed(1) + ' s: ' + (!top ? 'sin pantalla · ' : '') + 'red ' + (globalThis.psNetPending ? psNetPending() : 0) +
                  ' · imágenes ' + (globalThis.psImgsPending ? psImgsPending() : 0) + (pre ? ' · ' + (globalThis.psPreWhy || 'terreno') : '') + ' · estado ' + G.Game.state);
    }
    if (bootCalm >= 20 || now - bootT0 > 20000) { console.log('[carga] lista en ' + ((now - bootT0) / 1000).toFixed(1) + ' s' + (bootCalm < 20 ? ' (por tiempo: algo seguía cargando)' : '')); booting = false; lastKey = null; return; }
    screen.save();
    screen.setTransform(K, 0, 0, K, OX * K, OY * K);
    screen.globalAlpha = 1;
    screen.fillStyle = '#0a1430'; screen.fillRect(-OX, -OY, W + 2 * OX, H + 2 * OY);
    screen.restore();
    spin(W / 2, H / 2, now, 8);
  }
  // (Si la partida ya ha empezado —Reintentar del cooperativo local, desde la carga del menú—, la carga se quita: tapaba la
  // partida hasta 20 s mientras seguía cargando el terreno.)
  let slowUi = 0;
  const draw0t = now => {   // (diagnóstico: qué pantalla tarda, si la UI se lleva más de 30 ms)
    const t = ps.now(); draw0(now); const d = ps.now() - t;
    if (d > 30 && ps.now() - slowUi > 2000) { slowUi = ps.now(); console.log('[ui] ' + Math.round(d) + ' ms: ' + (top ? (top.id || 'sin id') : 'ninguna') + ', booting ' + booting); }
  };
  globalThis.psOverlay = now => { draw0t(now); if (booting && G.Game.state !== 'ui') { booting = false; console.log('[carga] la partida ya empezó: se quita'); } if (booting) return bootCover(now); if (!top) hudHints(); notices(now); if (perfOn()) fpsCounter(now); };

  Object.assign(G.RunUI, { showLevelUp, setWaiting, showItemChoice, showPause, wirePause, showOver, showBond, pickBond, bondBack,
                           closeLevelUp() { close(); G.UI.hide('scr-levelup'); } });
})();
