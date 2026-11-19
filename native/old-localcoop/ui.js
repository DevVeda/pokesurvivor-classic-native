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
  const screen = document.getElementById('game').getContext('2d');
  // Las pantallas se dibujan en un lienzo aparte sólo cuando cambia algo (su key()), y cada fotograma se
  // copia: repintar todo el texto en cada fotograma costaba ~15 ms (con las cartas, 28 ms por fotograma).
  const buf = document.createElement('canvas');
  buf.width = ps.W; buf.height = ps.H;
  const bufCtx = buf.getContext('2d');
  let ctx = screen, lastKey = null;
  const W = ps.W, H = ps.H;                        // 960x540: píxeles de dibujo
  const FONT = 'Pixelify';
  // Colores de css/style.css (:root). panel/panel2/line: .panel y .card de la web, sobre la caja azul.
  const C = { bg: 'rgba(3,6,16,0.8)', panel: 'rgba(0,0,0,0.22)', panel2: 'rgba(255,255,255,0.12)', line: 'rgba(244,248,255,0.25)', text: '#ffffff',
              muted: '#b9cbf0', gold: '#ffd23f', red: '#ff5f6d', navy: '#0a1430', box1: '#2c519f', box2: '#1a3170', edge: '#f4f8ff',
              edgeIn: '#5b83d6', edgeOut: '#0b1838' };

  // Los textos que sólo tiene la PS5 (el resto ya está en los diccionarios del juego, js/data/lang-*.js y js/lang/).
  // Columnas: en, fr, it, pt-BR, zh-Hans, zh-Hant. Los idiomas sin columna usan el inglés (la capa de reserva).
  const PS5_TEXTS = {
    'Multijugador': ['Multiplayer', 'Multijoueur', 'Multigiocatore', 'Multijogador', '多人游戏', '多人遊戲'],
    'Crear sala': ['Create room', 'Créer un salon', 'Crea stanza', 'Criar sala', '创建房间', '建立房間'],
    'Hasta 4 jugadores: enciende otro mando y elige su usuario. Cada uno entra, cambia de Pokémon o sale con su mando.': ['Up to 4 players: turn on another controller and pick its user. Each player joins, changes Pokémon or leaves with their own controller.', 'Jusqu’à 4 joueurs : allume une autre manette et choisis son utilisateur. Chacun rejoint, change de Pokémon ou part avec sa manette.', 'Fino a 4 giocatori: accendi un altro controller e scegli il suo utente. Ognuno entra, cambia Pokémon o esce con il suo controller.', 'Até 4 jogadores: ligue outro controle e escolha o usuário. Cada um entra, troca de Pokémon ou sai com o próprio controle.', '最多 4 名玩家：打开另一个手柄并选择其用户。每人用自己的手柄加入、更换宝可梦或退出。', '最多 4 名玩家：開啟另一個手把並選擇其使用者。每人用自己的手把加入、更換寶可夢或退出。'],
    'Pulsa [X] para entrar': ['Press [X] to join', 'Appuie sur [X] pour rejoindre', 'Premi [X] per entrare', 'Aperte [X] para entrar', '按 [X] 加入', '按 [X] 加入'],
    '[LR] [L1] [R1] mover · [UD] filtro': ['[LR] [L1] [R1] move · [UD] filter', '[LR] [L1] [R1] bouger · [UD] filtre', '[LR] [L1] [R1] scorri · [UD] filtro', '[LR] [L1] [R1] mover · [UD] filtro', '[LR] [L1] [R1] 移动 · [UD] 筛选', '[LR] [L1] [R1] 移動 · [UD] 篩選'],
    '[T] shiny · [S] Pokédex · [O] salir': ['[T] shiny · [S] Pokédex · [O] leave', '[T] shiny · [S] Pokédex · [O] quitter', '[T] shiny · [S] Pokédex · [O] esci', '[T] shiny · [S] Pokédex · [O] sair', '[T] 异色 · [S] 图鉴 · [O] 退出', '[T] 異色 · [S] 圖鑑 · [O] 退出'],
    '[LR] cambiar · [O] salir': ['[LR] change · [O] leave', '[LR] changer · [O] quitter', '[LR] cambia · [O] esci', '[LR] trocar · [O] sair', '[LR] 更换 · [O] 退出', '[LR] 更換 · [O] 退出'],
    'Sonido con varios jugadores': ['Sound with several players', 'Son à plusieurs joueurs', 'Audio con più giocatori', 'Som com vários jogadores', '多人时的声音', '多人時的聲音'],
    'Mandos: cada uno oye su partida por el altavoz de su mando. Tele: sólo la del jugador 1.': ['Controllers: each player hears their game through their controller speaker. TV: only player 1’s.', 'Manettes : chacun entend sa partie par le haut-parleur de sa manette. Télé : seulement celle du joueur 1.', 'Controller: ognuno sente la sua partita dall’altoparlante del controller. TV: solo quella del giocatore 1.', 'Controles: cada um ouve a sua partida pelo alto-falante do controle. TV: só a do jogador 1.', '手柄：每人用自己手柄的扬声器听自己的游戏。电视：只有玩家 1 的。', '手把：每人用自己手把的揚聲器聽自己的遊戲。電視：只有玩家 1 的。'],
    'Mandos': ['Controllers', 'Manettes', 'Controller', 'Controles', '手柄', '手把'],
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
    'Versión de PS5': ['PS5 version', 'Version PS5', 'Versione PS5', 'Versão de PS5', 'PS5 版', 'PS5 版'],
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
    'Forzar el evento (mapa, caramelos, skins, banner). Pulsa ✕ para aplicar: el juego se reinicia.': ['Force the event (map, candy, skins, banner). Press ✕ to apply: the game restarts.', 'Forcer l’événement (carte, bonbons, skins, bannière). Appuie sur ✕ pour appliquer : le jeu redémarre.', 'Forza l’evento (mappa, caramelle, skin, banner). Premi ✕ per applicare: il gioco si riavvia.', 'Forçar o evento (mapa, doces, skins, banner). Aperte ✕ para aplicar: o jogo reinicia.', '强制活动（地图、糖果、皮肤、卡池）。按 ✕ 应用：游戏会重启。', '強制活動（地圖、糖果、造型、卡池）。按 ✕ 套用：遊戲會重新啟動。'],
    'Según la fecha': ['By date', 'Selon la date', 'In base alla data', 'Pela data', '按日期', '按日期'],
    'Siempre': ['Always', 'Toujours', 'Sempre', 'Sempre', '始终', '始終'],
    'Nunca': ['Never', 'Jamais', 'Mai', 'Nunca', '从不', '從不'],
    'Juego de fans gratuito y sin ánimo de lucro: sin anuncios ni compras. Pokémon y sus personajes son propiedad de Nintendo, Creatures y GAME FREAK; este proyecto no está afiliado a ellos.': ['Free, non-profit fan game: no ads or purchases. Pokémon and its characters are property of Nintendo, Creatures and GAME FREAK; this project is not affiliated with them.', 'Jeu de fans gratuit et sans but lucratif : sans pubs ni achats. Pokémon et ses personnages appartiennent à Nintendo, Creatures et GAME FREAK ; ce projet n’est pas affilié à eux.', 'Gioco di fan gratuito e senza scopo di lucro: niente pubblicità né acquisti. Pokémon e i suoi personaggi sono di proprietà di Nintendo, Creatures e GAME FREAK; questo progetto non è affiliato a loro.', 'Jogo de fãs gratuito e sem fins lucrativos: sem anúncios nem compras. Pokémon e seus personagens são propriedade da Nintendo, Creatures e GAME FREAK; este projeto não é afiliado a elas.', '免费的非营利粉丝游戏：没有广告也没有内购。Pokémon 及其角色归 Nintendo、Creatures 和 GAME FREAK 所有；本项目与它们无关。', '免費的非營利粉絲遊戲：沒有廣告也沒有內購。Pokémon 及其角色歸 Nintendo、Creatures 和 GAME FREAK 所有；本專案與它們無關。'],
    'Música y sonidos': ['Music and sounds', 'Musique et sons', 'Musica e suoni', 'Música e sons', '音乐和音效', '音樂和音效'],
    '¿Cerrar sesión?': ['Log out?', 'Se déconnecter ?', 'Uscire?', 'Sair?', '要退出登录吗？', '要登出嗎？'],
    'Lo de esta cuenta queda guardado en la nube.': ['Everything in this account stays saved in the cloud.', 'Tout ce qui est sur ce compte reste sauvegardé dans le cloud.', 'Tutto ciò che è in questo account resta salvato nel cloud.', 'Tudo desta conta fica salvo na nuvem.', '此账号的内容会保存在云端。', '此帳號的內容會儲存在雲端。'],
    'Proyecto de fan sin ánimo de lucro · Sprites: SpriteCollab (CC BY-NC 4.0) · Pokémon © Nintendo/Creatures/GAME FREAK': ['Non-profit fan project · Sprites: SpriteCollab (CC BY-NC 4.0) · Pokémon © Nintendo/Creatures/GAME FREAK', 'Projet de fan sans but lucratif · Sprites : SpriteCollab (CC BY-NC 4.0) · Pokémon © Nintendo/Creatures/GAME FREAK', 'Progetto di fan senza scopo di lucro · Sprite: SpriteCollab (CC BY-NC 4.0) · Pokémon © Nintendo/Creatures/GAME FREAK', 'Projeto de fã sem fins lucrativos · Sprites: SpriteCollab (CC BY-NC 4.0) · Pokémon © Nintendo/Creatures/GAME FREAK', '非营利粉丝项目 · 精灵图：SpriteCollab (CC BY-NC 4.0) · Pokémon © Nintendo/Creatures/GAME FREAK', '非營利粉絲專案 · 精靈圖：SpriteCollab (CC BY-NC 4.0) · Pokémon © Nintendo/Creatures/GAME FREAK'],
    'Mejorar Pokémon': ['Upgrade Pokémon', 'Améliorer le Pokémon', 'Potenzia Pokémon', 'Melhorar Pokémon', '强化宝可梦', '強化寶可夢'],
    'Cambiar Pokémon': ['Change Pokémon', 'Changer de Pokémon', 'Cambia Pokémon', 'Trocar Pokémon', '更换宝可梦', '更換寶可夢'],
    'Atajos': ['Shortcuts', 'Raccourcis', 'Scorciatoie', 'Atalhos', '快捷键', '快捷鍵'],
    'Abrir en el móvil': ['Open on your phone', 'Ouvrir sur ton téléphone', 'Apri sul telefono', 'Abrir no celular', '在手机上打开', '在手機上開啟'],
    'Escanéalo con el móvil o escribe la dirección en el navegador:': ['Scan it with your phone or type the address in a browser:', 'Scanne-le avec ton téléphone ou tape l’adresse dans un navigateur :', 'Scansionalo con il telefono o scrivi l’indirizzo nel browser:', 'Escaneie com o celular ou digite o endereço no navegador:', '用手机扫描，或在浏览器中输入这个地址：', '用手機掃描，或在瀏覽器中輸入這個網址：'],
    'PokéSurvivor Classic es gratis, sin anuncios ni compras. Si quieres ayudar a pagar los servidores, puedes donar en Ko-fi (escanéalo con el móvil):': ['PokéSurvivor Classic is free, with no ads or purchases. If you want to help pay for the servers, you can donate on Ko-fi (scan it with your phone):', 'PokéSurvivor Classic est gratuit, sans pubs ni achats. Si tu veux aider à payer les serveurs, tu peux faire un don sur Ko-fi (scanne-le avec ton téléphone) :', 'PokéSurvivor Classic è gratis, senza pubblicità né acquisti. Se vuoi aiutare a pagare i server, puoi donare su Ko-fi (scansionalo con il telefono):', 'PokéSurvivor Classic é grátis, sem anúncios nem compras. Se quiser ajudar a pagar os servidores, pode doar no Ko-fi (escaneie com o celular):', 'PokéSurvivor Classic 免费，没有广告也没有内购。想帮忙支付服务器费用，可以在 Ko-fi 捐助（用手机扫描）：', 'PokéSurvivor Classic 免費，沒有廣告也沒有內購。想幫忙支付伺服器費用，可以在 Ko-fi 捐助（用手機掃描）：'],
    'Escribe esta dirección en el navegador del móvil o del ordenador:': ['Type this address in your phone or computer browser:', 'Saisis cette adresse dans le navigateur de ton téléphone ou ordinateur :', 'Scrivi questo indirizzo nel browser del telefono o del computer:', 'Digite este endereço no navegador do celular ou do computador:', '在手机或电脑的浏览器中输入这个地址：', '在手機或電腦的瀏覽器中輸入這個網址：'],
    'Shinies conseguidos': ['Shinies caught', 'Shinies obtenus', 'Shiny ottenuti', 'Shinies conseguidos', '获得的闪光宝可梦', '獲得的閃光寶可夢'],
    'Jugador': ['Player', 'Joueur', 'Giocatore', 'Jogador', '玩家', '玩家'],
    'y': ['and', 'et', 'e', 'e', '和', '和'],
    'Tu elección': ['Your pick', 'Ton choix', 'La tua scelta', 'Sua escolha', '你的选择', '你的選擇'],
    'Todos los Pokémon, shiny y mejoras, monedas y tickets de sobra, y el contador de FPS. Al apagarlo vuelves a tu partida de antes (con la cuenta online, lo que ya se subió a la nube se queda). Sin marcas en el ranking.': ['All Pokémon, shinies and upgrades, plenty of coins and tickets, and the FPS counter. Turning it off brings back your previous save (with the online account, whatever was already uploaded stays). No leaderboard marks.', 'Tous les Pokémon, chromatiques et améliorations, plein de pièces et de tickets, et le compteur de FPS. En le désactivant, tu retrouves ta partie d’avant (avec le compte en ligne, ce qui a déjà été envoyé reste). Aucun score au classement.', 'Tutti i Pokémon, shiny e potenziamenti, monete e biglietti in abbondanza, e il contatore FPS. Disattivandola torni alla partita di prima (con l’account online, ciò che è già stato caricato resta). Nessun record in classifica.', 'Todos os Pokémon, shinies e melhorias, moedas e tickets de sobra, e o contador de FPS. Ao desligar, você volta ao save de antes (com a conta online, o que já foi enviado fica). Sem marcas no ranking.', '全部宝可梦、闪光和强化，大量金币和抽奖券，以及 FPS 计数。关闭后恢复之前的存档（在线账号已上传的内容会保留）。不计入排行榜。', '全部寶可夢、閃光和強化，大量金幣和抽獎券，以及 FPS 計數。關閉後恢復之前的存檔（線上帳號已上傳的內容會保留）。不計入排行榜。'],
    'Con el modo dev: el evento de Halloween aunque no sea su fecha (mapa, caramelos, skins, banner). El juego se reinicia.': ['With dev mode: the Halloween event even when it isn’t its date (map, candy, skins, banner). The game restarts.', 'Avec le mode dev : l’événement Halloween même hors de sa date (carte, bonbons, skins, bannière). Le jeu redémarre.', 'Con la modalità dev: l’evento di Halloween anche fuori data (mappa, caramelle, skin, banner). Il gioco si riavvia.', 'Com o modo dev: o evento de Halloween mesmo fora da data (mapa, doces, skins, banner). O jogo reinicia.', '开发模式下：即使不在日期内也开启万圣节活动（地图、糖果、皮肤、卡池）。游戏会重新启动。', '開發模式下：即使不在日期內也開啟萬聖節活動（地圖、糖果、造型、卡池）。遊戲會重新啟動。'],
    'Modo estrés': ['Stress mode', 'Mode stress', 'Modalità stress', 'Modo estresse', '压力模式', '壓力模式'],
    'Con el modo dev, en solitario: empiezas con tus Atajos al nivel máximo y en un vínculo, no pierdes vida, siempre hay el máximo de enemigos y salen como si el reloj fuera 8 veces más rápido. Para probar el final de la partida.': ['With dev mode, solo only: you start with your Shortcuts at max level in one bond, you don’t lose health, enemies are always at the maximum and arrive as if the clock ran 8 times faster. To test the late game.', 'Avec le mode dev, en solo : tu commences avec tes Raccourcis au niveau max dans un lien, tu ne perds pas de vie, les ennemis sont toujours au maximum et arrivent comme si l’horloge allait 8 fois plus vite. Pour tester la fin de partie.', 'Con la modalità dev, in solitario: inizi con le tue Scorciatoie al livello massimo in un legame, non perdi vita, i nemici sono sempre al massimo e arrivano come se l’orologio andasse 8 volte più veloce. Per provare il finale della partita.', 'Com o modo dev, sozinho: você começa com seus Atalhos no nível máximo em um vínculo, não perde vida, os inimigos estão sempre no máximo e chegam como se o relógio fosse 8 vezes mais rápido. Para testar o fim da partida.', '开发模式下单人游戏：开局即带快捷键招式（满级、结为羁绊），不掉血，敌人始终保持最多，并按 8 倍时钟出现。用于测试后期。', '開發模式下單人遊戲：開局即帶快捷鍵招式（滿級、結為羈絆），不掉血，敵人始終保持最多，並按 8 倍時鐘出現。用於測試後期。'],
    'Primero enciende el modo dev.': ['Turn on dev mode first.', 'Active d’abord le mode dev.', 'Prima attiva la modalità dev.', 'Primeiro ligue o modo dev.', '请先开启开发模式。', '請先開啟開發模式。'],
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
    'Próximamente en PS5': ['Coming soon on PS5', 'Bientôt sur PS5', 'Presto su PS5', 'Em breve no PS5', 'PS5 版即将推出', 'PS5 版即將推出'],
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
    'Pulsa ✕ para cambiar: el juego se reinicia.': ['Press ✕ to change: the game restarts.', 'Appuie sur ✕ pour changer : le jeu redémarre.', 'Premi ✕ per cambiare: il gioco si riavvia.', 'Aperte ✕ para mudar: o jogo reinicia.', '按 ✕ 切换：游戏会重新启动。', '按 ✕ 切換：遊戲會重新啟動。'],
    'Aplicar': ['Apply', 'Appliquer', 'Applica', 'Aplicar', '应用', '套用'],
    'La misma cuenta y la misma partida que en pokesurvivor.com': ['The same account and save as on pokesurvivor.com', 'Le même compte et la même partie que sur pokesurvivor.com', 'Lo stesso account e lo stesso salvataggio di pokesurvivor.com', 'A mesma conta e o mesmo jogo de pokesurvivor.com', '与 pokesurvivor.com 相同的账号和存档', '與 pokesurvivor.com 相同的帳號和存檔'],
    'Usar la cuenta de la consola': ['Use the console account', 'Utiliser le compte de la console', "Usa l'account della console", 'Usar a conta do console', '使用主机账号', '使用主機帳號'],
    'Usar una cuenta online': ['Use an online account', 'Utiliser un compte en ligne', 'Usa un account online', 'Usar uma conta online', '使用在线账号', '使用線上帳號'],
    'Cuenta de la consola': ['Console account', 'Compte de la console', 'Account della console', 'Conta do console', '主机账号', '主機帳號'],
    'Tu partida se guarda sólo en esta PS5.': ['Your save is only stored on this PS5.', 'Ta partie est enregistrée seulement sur cette PS5.', 'Il salvataggio resta solo su questa PS5.', 'Seu jogo fica salvo só neste PS5.', '存档只保存在这台 PS5 上。', '存檔只儲存在這台 PS5 上。'],
    'La misma cuenta y la misma partida que en pokesurvivor.com. La primera vez puedes juntar tu partida de la consola con la online.': ['The same account and save as on pokesurvivor.com. The first time you can merge your console save with the online one.', 'Le même compte et la même partie que sur pokesurvivor.com. La première fois, tu peux fusionner ta partie de la console avec celle en ligne.', 'Lo stesso account e salvataggio di pokesurvivor.com. La prima volta puoi unire il salvataggio della console con quello online.', 'A mesma conta e o mesmo jogo de pokesurvivor.com. Na primeira vez você pode juntar o jogo do console com o online.', '与 pokesurvivor.com 相同的账号和存档。第一次可以把主机存档与在线存档合并。', '與 pokesurvivor.com 相同的帳號和存檔。第一次可以把主機存檔與線上存檔合併。'],
    'Sin conexión con la nube': ['No connection to the cloud', 'Pas de connexion au cloud', 'Nessuna connessione al cloud', 'Sem conexão com a nuvem', '无法连接云端', '無法連線雲端'],
    'La cuenta online no se pudo abrir': ['The online account could not be opened', "Le compte en ligne n'a pas pu s'ouvrir", "Non è stato possibile aprire l'account online", 'Não foi possível abrir a conta online', '无法打开在线账号', '無法開啟線上帳號'],
    'Reintentar': ['Retry', 'Réessayer', 'Riprova', 'Tentar de novo', '重试', '重試'],
    'Guardar en la nube': ['Save to the cloud', 'Sauvegarder dans le cloud', 'Salva nel cloud', 'Salvar na nuvem', '保存到云端', '儲存到雲端'],
    'No responde. Revisa la conexión y vuelve a intentarlo.': ['No response. Check your connection and try again.', 'Pas de réponse. Vérifie ta connexion et réessaie.', 'Nessuna risposta. Controlla la connessione e riprova.', 'Sem resposta. Verifique a conexão e tente de novo.', '没有响应。请检查网络后重试。', '沒有回應。請檢查網路後重試。'],
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
    'No se pudo cargar el ranking': ["Couldn't load the leaderboard", 'Impossible de charger le classement', 'Impossibile caricare la classifica', 'Não foi possível carregar o ranking', '无法加载排行榜', '無法載入排行榜'],
    'No se pudo cargar.': ["Couldn't load.", 'Impossible de charger.', 'Impossibile caricare.', 'Não foi possível carregar.', '无法加载。', '無法載入。'],
    'dáselo a tus amigos para que te añadan.': ['give it to your friends so they can add you.', "donne-le à tes amis pour qu'ils t'ajoutent.", 'dallo ai tuoi amici perché ti aggiungano.', 'passe para seus amigos te adicionarem.', '把它告诉好友，让他们加你。', '把它告訴好友，讓他們加你。'],
    'Aún no tienes amigos añadidos. Pulsa Añadir amigo y escribe su apodo.': ["You haven't added any friends yet. Press Add friend and type their nickname.", "Tu n'as encore aucun ami. Appuie sur Ajouter un ami et écris son pseudo.", 'Non hai ancora amici. Premi Aggiungi amico e scrivi il suo nickname.', 'Você ainda não tem amigos. Aperte Adicionar amigo e digite o apelido.', '还没有好友。按“添加好友”并输入昵称。', '還沒有好友。按「新增好友」並輸入暱稱。'],
    'Categoría': ['Category', 'Catégorie', 'Categoria', 'Categoria', '类别', '類別'],
    'títulos': ['titles', 'titres', 'titoli', 'títulos', '称号', '稱號'],
    '{x} de {x} logros': ['{x} of {x} achievements', '{x} succès sur {x}', '{x} obiettivi su {x}', '{x} de {x} conquistas', '已获得 {x} / {x} 个成就', '已獲得 {x} / {x} 個成就'],
    'Datos de los Pokémon': ['Pokémon data', 'Données des Pokémon', 'Dati dei Pokémon', 'Dados dos Pokémon', '宝可梦数据', '寶可夢資料'],
    'Desarrollador': ['Developer', 'Développeur', 'Sviluppatore', 'Desenvolvedor', '开发者', '開發者'],
    'Fuente': ['Font', 'Police', 'Font', 'Fonte', '字体', '字型'],
    'Modo dev': ['Dev mode', 'Mode dev', 'Modalità dev', 'Modo dev', '开发模式', '開發模式'],
    'Se aplica al volver a abrir el juego.': ['Applies the next time you open the game.', 'S\'applique à la prochaine ouverture du jeu.', 'Si applica alla prossima apertura del gioco.', 'Vale na próxima vez que abrir o jogo.', '下次打开游戏时生效。', '下次開啟遊戲時生效。'],
    'Todos los Pokémon y todas las mejoras desbloqueados, y el contador de FPS. Al apagarlo vuelves a tu partida de antes.': [
      'Every Pokémon and every upgrade unlocked, plus the FPS counter. Turning it off brings back your previous save.',
      'Tous les Pokémon et toutes les améliorations débloqués, et le compteur de FPS. En le désactivant, tu retrouves ta partie d\'avant.',
      'Tutti i Pokémon e tutti i potenziamenti sbloccati, più il contatore FPS. Spegnendolo torni al salvataggio di prima.',
      'Todos os Pokémon e todas as melhorias desbloqueados, e o contador de FPS. Ao desligar, você volta ao seu jogo de antes.',
      '解锁所有宝可梦和所有强化，并显示帧数。关闭后恢复之前的存档。', '解鎖所有寶可夢和所有強化，並顯示幀數。關閉後恢復之前的存檔。'],
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
  let booting = ps.PAD !== 'node' && !ps.PLAYER;   // pantalla de carga del arranque (ver psOverlay al final); en el arnés de
  // Node, no; ni en los jugadores 2-4 (su copia no se ve en los menús)
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
    return booting ? { dx: 0, dy: 0 } : ev;   // (cargando: no se elige nada a ciegas)
  }

  // ---------------- dibujo ----------------
  const strip = s => String(s == null ? '' : s).replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
  const T = (s, kind) => (G.T ? G.T(s, kind) : s);
  function font(px, bold) { ctx.font = `${bold ? 'bold ' : ''}${px}px ${FONT}`; }
  // Con la sombra de la web (text-shadow: 2px 2px 0 #0a1430, aquí a 0,75); shadow null: sin sombra.
  function text(s, x, y, px, color, align = 'left', bold = false, shadow = C.navy) {
    font(px, bold); ctx.textAlign = align; ctx.textBaseline = 'top';
    if (shadow) { const o = px >= 20 ? 2 : 1.5; ctx.fillStyle = shadow; ctx.fillText(s, x + o, y + o); }
    ctx.fillStyle = color; ctx.fillText(s, x, y);
  }
  function wrap(s, maxW, px, bold) {
    font(px, bold);
    const out = [];
    let line = '';
    for (const w of strip(s).split(' ')) {
      const t = line ? line + ' ' + w : w;
      if (line && ctx.measureText(t).width > maxW) { out.push(line); line = w; } else line = t;
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
  function dim() {
    if (winOn && G.Game.state !== 'ui') return;   // (cooperativo local, ventana en su cuarto: la partida se ve detrás)
    const g = ctx.createRadialGradient(W / 2, H * 0.4, 0, W / 2, H * 0.4, Math.hypot(W / 2, H * 0.6));
    g.addColorStop(0, 'rgba(10,20,50,0.55)'); g.addColorStop(1, 'rgba(3,6,16,0.88)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  function rr(x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }
  function vgrad(y, h, a, b) { const g = ctx.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, a); g.addColorStop(1, b); return g; }
  // .box: degradado azul, borde blanco, anillo oscuro por fuera y azul claro por dentro.
  function box(x, y, w, h) {
    if (winOn) winBox = winBox ? [Math.min(winBox[0], x), Math.min(winBox[1], y), Math.max(winBox[2], x + w), Math.max(winBox[3], y + h)] : [x, y, x + w, y + h];
    rr(x - 2, y - 2, w + 4, h + 4, 11); ctx.fillStyle = C.edgeOut; ctx.fill();
    rr(x, y, w, h, 9); ctx.fillStyle = C.edge; ctx.fill();
    rr(x + 2, y + 2, w - 4, h - 4, 7); ctx.fillStyle = vgrad(y, h, C.box1, C.box2); ctx.fill();
    rr(x + 3, y + 3, w - 6, h - 6, 6); ctx.strokeStyle = C.edgeIn; ctx.lineWidth = 1.5; ctx.stroke();
  }
  // .btn ('blue'), .btn.gold y .btn.ghost. on: el que tiene el cursor (anillo dorado).
  function btn(x, y, w, h, label, kind = 'blue', on = false, px = 13, ico) {
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
    const iw = ico ? px + 6 : 0, tw = ctx.measureText(label).width, x0 = x + (w - tw - iw) / 2;
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
  // #topbar (arriba a la derecha): monedas, tickets, cuenta, Novedades y Ajustes, como en la web.
  // focus: 'user' | 'news' | 'gear' (el cursor del mando está en la barra, desde el menú principal).
  // Marco del cursor, 3 px por fuera y con la misma forma (radio r del elemento + 3).
  const ring = (x, y, w, h, r) => { rr(x - 3, y - 3, w + 6, h + 6, r + 3); ctx.strokeStyle = C.gold; ctx.lineWidth = 2; ctx.stroke(); };
  // Novedades: las de la PS5, no las de la web (NEWS). [español, inglés]; los demás idiomas, por T() o en inglés.
  const NEWS = [
    { d: '2026-11-05', title: ['PokéSurvivor Classic en PS5', 'PokéSurvivor Classic on PS5'],
      new: [
        ['Cooperativo local: hasta 4 jugadores en la misma consola, cada uno con su mando. La pantalla se parte sola cuando os separáis y se une al volver a juntaros.',
         'Couch co-op: up to 4 players on the same console, each with their own controller. The screen splits on its own when you drift apart and merges when you regroup.'],
        ['Hecho para el mando: todas las pantallas se manejan con el DualSense, con vibración al recibir daño.',
         'Built for the controller: every screen works with the DualSense, with rumble when you take damage.'],
        ['Cada perfil de la PS5 tiene su propia partida guardada.', 'Each PS5 profile has its own save.'],
        ['Los enlaces (Apoyar y demás) salen con un código QR para abrirlos en el móvil.', 'Links (Support and others) show a QR code to open them on your phone.'],
      ] },
    { d: '2026-11-04', title: ['El juego clásico', 'The classic game'],
      chg: [
        ['PokéSurvivor Classic es el juego tal y como estaba el 4 de noviembre de 2026, el día del último cambio publicado del original.',
         'PokéSurvivor Classic is the game exactly as it was on November 4, 2026, the day of the last published change to the original.'],
        ['Desde entonces el original es de código cerrado, así que sus novedades ya no llegan a esta versión.',
         'Since then the original has been closed source, so its updates no longer reach this version.'],
      ] },
  ];
  const newsUnseen = () => { try { return (localStorage.getItem('ps.news.seen') || '') < NEWS[0].d; } catch (e) { return false; } };
  // Botón de 30x26 sólo con icono (la barra de arriba).
  function iconBtn(x, kind, ico, focused) {
    btn(x, 10, 30, 26, null, kind, kind === 'ghost' && focused);
    icon(ico, x + 7, 15, 16);
    if (focused) ring(x, 10, 30, 26, 7);
  }
  function topbar(focus) {
    if (winOn) return;   // (cooperativo local, en su ventana —la Pokédex de los jugadores 2-4—: sólo la ventana)
    const s = G.DB.save, t = (s && s.tickets) || { t1: 0, t10: 0 };
    // Halloween: los caramelos, al lado de los tickets (refreshCoins de la web).
    const tk = [['ticket', String(t.t1)], ['ticket10', String(t.t10)]].concat(G.Halloween.on && s ? [['candy', String((s.bag && s.bag.candy) || 0)]] : []);
    const items = [
      [() => pill(0, 0, [['coin', (s ? s.coins : 0).toLocaleString('es-ES')]], true), x => pill(x, 10, [['coin', (s ? s.coins : 0).toLocaleString('es-ES')]])],
      [() => pill(0, 0, tk, true), x => pill(x, 10, tk)],
      [() => pill(0, 0, [[G.DB.guest ? 'user' : 'crown', G.DB.guest ? T('Invitado') : (G.DB.user || '')]], true),
       (x, w) => {
        pill(x, 10, [[G.DB.guest ? 'user' : 'crown', G.DB.guest ? T('Invitado') : (G.DB.user || '')]]);
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
      [() => 30, x => { btn(x, 10, 30, 26, null, 'ghost', focus === 'gear'); icon('gear', x + 7, 15, 16); if (focus === 'gear') ring(x, 10, 30, 26, 7); }],
      ...(barList().includes('logout') ? [[() => { font(11, true); return ctx.measureText(T('Salir')).width + 22; }, (x, w) => {
        btn(x, 10, w, 26, T('Salir'), 'ghost', focus === 'logout', 11);
        if (focus === 'logout') ring(x, 10, w, 26, 7);
      }]] : []),
    ];
    let x = W - 16;   // pegada a la derecha, como la web (el contador de FPS del modo dev va encima, en su capa)
    for (let i = items.length - 1; i >= 0; i--) { const w = items[i][0](); x -= w; items[i][1](x, w); x -= 8; }
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
  function padIcon(k, cx, cy, r = 10) {
    ctx.save();
    const PILL = { opt: 'OPTIONS', sel: 'TOUCHPAD', l1: 'L1', r1: 'R1', l2: 'L2', r2: 'R2' };
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

  function hints(list, right = W - 24) {   // [['x', 'Elegir'], ...] abajo a la derecha
    if (winOn && ps.PLAYER && G.Game.state !== 'ui') return;   // (cooperativo local, en la partida: las pistas, una vez, en la ventana del 1)
    font(14, false);
    let x = right;
    for (let i = list.length - 1; i >= 0; i--) {
      const [k, label] = list[i], lw = ctx.measureText(T(label)).width;
      text(T(label), x, H - 30, 14, C.muted, 'right');
      x -= lw + 8;
      const w = padIcon(k, 0, -100);   // sólo para medir: se dibuja fuera de la pantalla
      padIcon(k, x - w / 2, H - 23);
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
    screen.setTransform(1, 0, 0, 1, 0, 0);
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

  // Tres lienzos por turnos: main.c lee el último terminado (ps.lc_win tras pintarlo) mientras se pinta otro; con uno solo
  // se veía a medio pintar (borrado: la ventana parpadeaba y se mezclaba con el terreno).
  let winCvs = null, winI = 0, winOn = false, winBox = null;   // winBox: lo que ocupan sus cajas (main.c la amplía a su zona)
  function winTarget() {
    // (Al acabar —«Has caído», 'over'—, no: el resumen del 1 va a pantalla completa, con una pestaña por jugador.)
    const want = !!(ps.lc_win && top && (globalThis.psLocalRun && psLocalRun() ? G.Game.state !== 'ui' && G.Game.state !== 'over'
      : ps.PLAYER && !top.guest && G.Game.state === 'ui'));   // (jugadores 2-4 en la sala: su Pokédex, en su cuarto)
    if (want && !winCvs) winCvs = [0, 1, 2].map(() => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; });
    if (want !== winOn) { winOn = want; lastKey = null; if (!want) ps.lc_win(-1); }   // (se redibuja: sin fondo oscuro)
    if (!want) return screen;
    winI = (winI + 1) % 3;
    return winCvs[winI].getContext('2d');
  }
  globalThis.psOverlay = now => {
    // Si el juego cierra la pantalla por su cuenta (p. ej. quita la pausa), se cierra también aquí.
    if (top && top.id && !G.UI.isOpen(top.id)) { if (top.id === 'scr-levelup') console.log('[cartas] el juego las cierra'); close(); }
    if (!top && winOn) { winOn = false; ps.lc_win(-1); }
    if (!top) { spinner(now); return; }
    const ev = readInput(now);
    try {
      const out = winTarget();   // (antes de dibujar: en modo ventana, sin oscurecer el fondo ni pistas repetidas)
      const key = top.key ? top.key(now) : String(now);
      if (key !== lastKey) {
        lastKey = key;
        winBox = null;
        ctx = bufCtx;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, W, H);
        top.draw(now);
        ctx = screen;
      }
      // Cooperativo local, en la partida juntos: la ventana (pausa, cartas, objeto…) no va en la pantalla de su copia sino en
      // un lienzo propio, que main.c pone a 1:1 en el cuarto de pantalla de su jugador (ps.lc_win); la partida sigue a la vista.
      out.save();
      out.setTransform(1, 0, 0, 1, 0, 0);
      out.globalAlpha = 1;
      out.globalCompositeOperation = 'source-over';
      if (out !== screen) out.clearRect(0, 0, W, H);
      out.drawImage(buf, 0, 0);
      if (top.live) { ctx = out; top.live(now); ctx = screen; }   // lo que se mueve (sprites), encima, cada fotograma
      out.restore();
      if (out !== screen) { const b = winBox || [0, 0, W, H], m = 6; ps.lc_win(winCvs[winI]._sid, b[0] - m, b[1] - m, b[2] - b[0] + 2 * m, b[3] - b[1] + 2 * m); }
      spinner(now);
      top.input(ev, now);
    } catch (e) { ctx = screen; console.error('[ui] ' + e.message + '\n' + e.stack); }
  };
  // Mientras hay una pantalla abierta el juego no ve el mando (browser.js, psPadHeld). Lo que ya estaba
  // pulsado al abrir no cuenta como pulsación nueva.
  const open = s => { top = s; lastKey = null; prev = psPadRaw().buttons.slice(); globalThis.psPadHeld = true; };
  const close = () => { top = null; globalThis.psPadHeld = false; globalThis.psPadRelease = true; };
  globalThis.psUiClose = () => { if (top) close(); };   // localcoop.js: la partida empieza desde la otra copia

  const GUARD = 600;   // como en la web: las cartas no se pueden elegir hasta pasados 0,6 s
  const rerollsLeft = () => { const p = G.Game.player; return p ? Math.max(0, 1 + (p.rerollBonus || 0) - (p.rerolls || 0)) : 0; };

  // .cards de la web: lista vertical de .card (icono en su cuadro, nombre con etiquetas, descripción y la tecla).
  function cardList(list, sel, x, y, w, guard) {
    const H0 = 56, GAP = 7;
    list.forEach((c, i) => {
      const on = i === sel, cx = x + (on ? 3 : 0), cy = y + i * (H0 + GAP);
      ctx.globalAlpha = guard ? 0.55 : 1;
      rr(cx, cy, w, H0, 9);
      ctx.fillStyle = c.evo ? 'rgba(255,210,63,0.12)' : c.bond ? 'rgba(255,138,216,0.12)' : on ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.2)'; ctx.fill();
      ctx.strokeStyle = on ? (c.evo ? C.gold : C.edge) : c.evo ? C.gold : c.bond ? '#ff8ad8' : 'rgba(244,248,255,0.3)'; ctx.lineWidth = on ? 2.5 : 1.5; ctx.stroke();
      if (on) { rr(cx - 3, cy - 3, w + 6, H0 + 6, 11); ctx.strokeStyle = C.gold; ctx.lineWidth = 2; ctx.stroke(); }
      rr(cx + 10, cy + 10, 36, 36, 8); ctx.fillStyle = (c.color || '#9fb1c9') + '33'; ctx.fill();
      icon(c.icon, cx + 14, cy + 14, 28);
      let tx = cx + 58;
      const title = strip(c.title);
      text(title, tx, cy + 10, 13, c.evo ? C.gold : c.bond ? '#ff8ad8' : '#fff', 'left', true);
      font(13, true); tx += ctx.measureText(title).width + 6;
      for (const [label, bg, fg, border] of c.chips || []) {
        font(8, true); const cw = ctx.measureText(label).width + 10;
        rr(tx, cy + 11, cw, 13, 4); ctx.fillStyle = bg; ctx.fill();
        if (border) { ctx.strokeStyle = border; ctx.lineWidth = 1; ctx.stroke(); }
        text(label, tx + 5, cy + 13.5, 8, fg || '#10131a', 'left', true, null); tx += cw + 4;
      }
      wrap(c.desc, w - 110, 10).slice(0, 2).forEach((l, k) => text(l, cx + 58, cy + 28 + k * 12, 10, C.muted));
      if (c.key) { rr(cx + w - 28, cy + H0 / 2 - 9, 18, 18, 4); ctx.strokeStyle = 'rgba(244,248,255,0.3)'; ctx.lineWidth = 1.5; ctx.stroke(); text(c.key, cx + w - 19, cy + H0 / 2 - 5, 9.5, C.muted, 'center'); }
      ctx.globalAlpha = 1;
    });
    return list.length * (H0 + GAP) - GAP;
  }
  // Las etiquetas de una carta de nivel, como renderCards de js/ui/run-ui.js.
  function levelChips(c) {
    if (c.type === 'new') return [[T('Nuevo') + ' · ' + strip(c.tag), c.color]].concat(c.cat ? [[strip(c.cat), 'rgba(10,20,48,0.55)', '#f4f8ff', 'rgba(170,195,255,0.5)']] : []);
    if (c.type === 'up' || c.type === 'evo') return [[strip(c.tag), c.color]];
    return [[strip(c.tag), c.color === '#ffd23f' ? '#ffd23f' : '#9fb1c9']];
  }
  // Caja centrada de ancho w (.box.center) con su título; devuelve [x, y] de dentro.
  function centerBox(w, h, title, sub) {
    dim();
    const x = (W - w) / 2, y = (H - h) / 2;
    box(x, y, w, h);
    text(title, W / 2, y + 16, 19.5, '#fff', 'center', true);
    if (sub) text(sub, W / 2, y + 44, 11, C.muted, 'center');
    return [x, y];
  }

  // Cuántas cartas caben a la vez; si hay más (modo dev: todas), la lista se desplaza con el cursor.
  const CARDS_VIS = 6;
  const cardTop = (sel, top, n) => Math.max(0, Math.min(n - CARDS_VIS, sel < top ? sel : sel >= top + CARDS_VIS ? sel - CARDS_VIS + 1 : top));
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
  function showLevelUp(level, list, cb, coop = false) {
    let sel = 0, top = 0, since = ps.now();
    waitText = '';
    console.log('[cartas] nivel ' + level + (coop ? ' (grupo)' : '') + ': ' + list.length + ' cartas');
    G.UI.show('scr-levelup');
    open({ id: 'scr-levelup',
      key: now => sel + '|' + list.map(c => c.title).join() + '|' + (now - since < GUARD) + '|' + rerollsLeft(),
      draw(now) {
        const rl = rerollsLeft(), vis = Math.min(list.length, CARDS_VIS), h = 74 + vis * 63 + (rl > 0 ? 40 : 6);
        top = cardTop(sel, top, list.length);
        const [x, y] = centerBox(444, h, G.I18n.f('¡Nivel {x}!', level), T('Elige una recompensa ·').replace(/\s*·$/, '') + (list.length > vis ? '  ·  ' + (sel + 1) + ' / ' + list.length : ''));
        cardList(list.slice(top, top + vis).map((c, i) => ({ ...c, evo: c.type === 'evo', chips: levelChips(c), key: String(top + i + 1) })), sel - top, x + 14, y + 66, 416, now - since < GUARD);
        if (rl > 0) {   // "Cambiar opciones (1) · △", texto y botón centrados juntos en el botón
          const label = T('Cambiar opciones (') + rl + ') ·', by = y + h - 36;
          font(10, true); const tw = ctx.measureText(label).width, bw = tw + 46, bx = W / 2 - bw / 2;
          btn(bx, by, bw, 24, null, 'ghost', false);
          text(label, bx + 14, by + 7, 10, '#fff', 'left', true);
          padIcon('t', bx + 14 + tw + 12, by + 12, 7);
        }
        const hh = [['ud', 'Mover'], ['x', 'Elegir']];
        if (rl > 0) hh.push(['t', T('Cambiar opciones (').replace(/\s*\($/, '')]);
        hints(hh);
      },
      input(ev, now) {
        if (ev.dy) { sel = (sel + ev.dy + list.length) % list.length; G.Audio.sfx('select'); }
        if (ev.y && rerollsLeft() > 0) {
          G.Game.player.rerolls = (G.Game.player.rerolls || 0) + 1;
          list = G.LevelUp.offer(G.Game.player);
          sel = Math.min(sel, list.length - 1);
          G.Audio.sfx('select');
        }
        if (ev.a && now - since >= GUARD && list[sel]) {
          const c = list[sel];
          console.log('[cartas] elegida: ' + c.title);
          close();
          if (coop) waitPicked(level, c);   // antes de cb: si eras el último, cb ya la cierra (closeLevelUp)
          else G.UI.hide('scr-levelup');
          cb(c);
        }
      },
    });
  }
  // Núcleo en C (shim/core.js): una carta de nivel por jugador, a la vez, cada uno en su zona de la pantalla y con el
  // mismo dibujo que las de siempre. La entrada la lleva core.js (el mando de cada uno).
  //   psCoreCards(nivel, sets): sets [{ i, offer, sel, done, zone: [x, y, w, h], color }] (se leen en cada dibujo).
  //   psCoreCards(null): se cierra. Un set con title / sub: otra ventana con cartas (el objeto: quedárselo o cambiarlo).
  globalThis.psCoreCards = (level, sets) => {
    if (!sets) { if (top && top.id === 'scr-core-cards') close(); return; }
    const since = ps.now();
    open({ id: 'scr-core-cards',
      key: now => sets.map(c => c.sel + (c.done ? 'd' : '')).join('|') + (now - since < GUARD),
      draw(now) {
        dim();
        for (const c of sets) {
          if (!c.offer.length) continue;
          // Como mucho 6 cartas a la vista (en un cuarto, 3) y el resto se desplaza con el cursor (modo dev: todas): si no,
          // la caja se encogía hasta no poder leerse.
          const [zx, zy, zw, zh] = c.zone, cap = zh < 400 ? 3 : CARDS_VIS, n = c.offer.length;
          c.top = Math.max(0, Math.min(n - cap, c.sel < (c.top | 0) ? c.sel : c.sel >= (c.top | 0) + cap ? c.sel - cap + 1 : c.top | 0));
          const list = c.done ? [c.offer[c.sel]] : c.offer.slice(c.top, c.top + cap), more = !c.done && n > cap;
          const bh = 74 + list.length * 63 + (c.done ? 30 : 6), s = Math.min(1, (zw - 12) / 444, (zh - 12) / bh);
          ctx.save();
          ctx.translate(zx + zw / 2, zy + zh / 2); ctx.scale(s, s);
          const x = -222, y = -bh / 2;
          box(x, y, 444, bh);
          text('J' + (c.i + 1) + ' · ' + (c.title || G.I18n.f('¡Nivel {x}!', level)), 0, y + 16, 19.5, c.color || '#fff', 'center', true);
          text((c.done ? T('Tu elección') : c.sub || T('Elige una recompensa ·').replace(/\s*·$/, '')) + (more ? '  ·  ' + (c.sel + 1) + ' / ' + n : ''), 0, y + 44, 11, C.muted, 'center');
          cardList(list.map((k, j) => ({ ...k, evo: k.type === 'evo', chips: levelChips(k), key: c.done ? '' : String(c.top + j + 1) })),
                   c.done ? 0 : c.sel - c.top, x + 14, y + 66, 416, !c.done && now - since < GUARD);
          if (c.done) text(T('Esperando a los demás…'), 0, y + 66 + 63 + 6, 11, C.gold, 'center', true);
          ctx.restore();
        }
        hints([['ud', 'Mover'], ['x', 'Elegir']]);
      },
      input() {},
    });
  };
  function waitPicked(level, c) {
    open({ id: 'scr-levelup',
      key: () => waitText,
      draw(now) {
        const [x, y] = centerBox(444, 74 + 63 + 34, G.I18n.f('¡Nivel {x}!', level), T('Tu elección'));
        cardList([{ ...c, evo: c.type === 'evo', chips: levelChips(c), key: '' }], 0, x + 14, y + 66, 416, false);   // (key: la del juego, «up …», no la tecla)
        text(waitText || T('Esperando a los demás…'), W / 2, y + 66 + 63 + 6, 11, C.gold, 'center', true);
      },
      input() {},
    });
  }

  function showItemChoice(cur, next, cb) {
    // Modo dev: cualquier objeto del juego (el que llevas, el que has cogido y luego todos los demás).
    const ids = Dev.on() ? [cur, next].concat(Object.keys(G.Items.BY).filter(id => id !== cur && id !== next)) : [cur, next];
    const list = ids.map((id, i) => {
      const it = G.Items.BY[id];
      return { id, icon: id, title: T(i ? 'Cambiar a' : 'Quedarme con') + ' ' + T(it.name), desc: T(it.desc), color: '#ffd23f', evo: i === 1, key: String(i + 1) };
    });
    let sel = 0, top = 0, since = ps.now();
    G.UI.show('scr-item');
    open({ id: 'scr-item',
      key: now => sel + '|' + (now - since < GUARD),
      draw(now) {
        const vis = Math.min(list.length, CARDS_VIS);
        top = cardTop(sel, top, list.length);
        const [x, y] = centerBox(444, 74 + vis * 63, T('¡Un objeto!'), T('Sólo puedes llevar uno ·').replace(/\s*·$/, '') + (list.length > vis ? '  ·  ' + (sel + 1) + ' / ' + list.length : ''));
        cardList(list.slice(top, top + vis).map((c, i) => ({ ...c, key: String(top + i + 1) })), sel - top, x + 14, y + 66, 416, now - since < GUARD);
        hints([['ud', 'Mover'], ['x', 'Elegir']]);
      },
      input(ev, now) {
        if (ev.dy) { sel = (sel + ev.dy + list.length) % list.length; G.Audio.sfx('select'); }
        if (ev.a && now - since >= GUARD) { close(); G.UI.hide('scr-item'); cb(list[sel].id); }
      },
    });
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
    G.UI.show('scr-bond');
    open({ id: 'scr-bond',
      key: now => sel + '|' + (first ? first.id : '') + '|' + (now - since < GUARD),
      draw(now) {
        const step2 = opt.mode === 'pair' && first, l = list();
        const sub = opt.mode === 'add' ? G.I18n.f('Elige qué movimiento se une a {x}', names(opt.group))
          : step2 ? G.I18n.f('¿Con cuál unes {x}?', T(first.name, 'move')) : T('Elige el primer movimiento que vas a unir');
        const h = 98 + l.length * 63;
        const [x, y] = centerBox(444, h, T('¡Vínculo!'), T('Los movimientos unidos se lanzan a la vez y ocupan un solo hueco'));
        text(sub, W / 2, y + 62, 11, C.muted, 'center');
        cardList(l.map((m, i) => ({
          icon: 'move:' + m.id, title: T(m.name, 'move'), color: G.U.TYPE_COLOR[m.type], bond: opt.mode === 'add' || step2, key: String(i + 1),
          chips: [['Nv.' + m.lvl, G.U.TYPE_COLOR[m.type]]],
          desc: opt.mode === 'add' ? G.I18n.f('Se lanzará a la vez que {x}.', names(opt.group))
            : step2 ? G.I18n.f('Se lanzará a la vez que {x}. Queda un hueco libre.', T(first.name, 'move')) : strip(m.desc || ''),
        })), sel, x + 14, y + 86, 416, now - since < GUARD);
        const hh = [['ud', 'Mover'], ['x', 'Elegir']];
        if (step2) hh.push(['o', 'Atrás']);
        hints(hh);
      },
      input(ev) {
        const n = list().length;
        if (ev.dy && n) { sel = (sel + ev.dy + n) % n; G.Audio.sfx('select'); }
        if (ev.a) pick(sel);
        else if (ev.b && first) { first = null; sel = 0; G.Audio.sfx('select'); }
      },
    });
  }
  function pickBond(i) { if (bondPick) bondPick(i); }
  function bondBack() { /* ○ en la pantalla */ }

  let onResume = () => {}, onQuit = () => {};
  function wirePause(resume, quit) { onResume = resume; onQuit = quit; }

  // Como #scr-pause: Continuar / Abandonar y el resumen de la partida (pauseSummary de la web), desplazable.
  function showPause() {
    const pl = G.Game.player;
    let sel = 0, confirm = false, yes = false, scroll = 0, maxScroll = 0;   // yes: en la confirmación, el cursor en "Sí"
    const opts = [['Continuar', 'gold', () => { close(); onResume(); }], ['Ajustes', 'blue', () => { close(); settingsScreen(showPause); }], ['Abandonar run', 'blue', () => { confirm = true; yes = false; }]];
    G.UI.show('scr-pause');
    const BW2 = 538, X = (W - BW2) / 2, Y = 10, BH2 = H - 50;
    open({ id: 'scr-pause',
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
        opts.forEach(([l, kind], i) => { btn(bx, y, ws[i], 30, T(l), kind, i === sel, 12); bx += ws[i] + 10; });
        y += 46;
        if (pl) {
          const t = G.Game.st.time, n = v => Math.round(v).toLocaleString('es-ES');
          const k2 = v => '×' + v.toFixed(2).replace('.', ','), pct = v => Math.round(v * 100) + ' %';
          const L = X + 18, RW2 = BW2 - 36;
          const h3g = t2 => { text(T(t2), L, y, 11, C.gold, 'left', true); y += 18; };
          h3g('Tus ataques');
          text(T('Daño'), L + RW2 - 110, y, 8.5, C.muted, 'right'); text(T('Por segundo'), L + RW2, y, 8.5, C.muted, 'right'); y += 13;
          for (const m of pl.moves) {
            const secs = Math.max(5, t - (m.since || 0));
            icon('move:' + m.id, L, y - 2, 14);
            const nm = T(m.name, 'move'); text(nm, L + 18, y, 10, '#fff'); font(10); text('Nv.' + m.lvl, L + 22 + ctx.measureText(nm).width, y + 1, 8.5, C.muted);
            if (m.cat) { font(8, true); const cw = ctx.measureText(T(G.Stats.NAME[m.cat])).width + 10; rr(L + 210, y - 1, cw, 13, 4); ctx.fillStyle = G.U.TYPE_COLOR[m.type]; ctx.fill(); text(T(G.Stats.NAME[m.cat]), L + 215, y + 1.5, 8, '#10131a', 'left', true, null); }
            else text(T('Mejora'), L + 210, y, 9, C.muted);
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
                      ['Regeneración', pl.regen.toFixed(1).replace('.', ',') + ' /s']];
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
          btn(W / 2 - 150, 270, 140, 30, T('Sí, abandonar'), 'blue', yes, 12);
          btn(W / 2 + 10, 270, 140, 30, T('No'), 'gold', !yes, 12);
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
        if (ev.dy) scroll = Math.max(0, Math.min(maxScroll, scroll + ev.dy * 50));
        if (ev.a && opts[sel][2]) opts[sel][2]();
        else if (ev.b || ev.start) { close(); onResume(); }
      },
    });
  }

  // Como #scr-over: el título y las cifras en tarjetas (.stats), y "Volver al menú".
  // Cooperativo local: el 1 elige por todos (✕ otra partida con los mismos, □ a la sala a cambiar de Pokémon) y las
  // pantallas de los demás se cierran solas (localcoop.js → psBackToRoom).
  let overBack = null;
  globalThis.psBackToRoom = () => {
    const b = overBack;
    if (b) return b();
    if (top) close();
    G.UI.hideAll(); mainMenu();
  };
  function showOver(r, onBack) {
    let since = ps.now();
    const local = !ps.PLAYER && globalThis.psLocalRun && psLocalRun();
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
      full.push([r.judge.gengar ? 'Daño a Gengar' : 'Daño a Arceus', (r.judge.dmg || 0).toLocaleString('es-ES'), C.gold]);
    }
    full.push(['Pokémonedas ganadas', '+' + r.coins, C.gold, 'coin', strip(r.breakdown || '')]);
    // Tickets y movimientos van con sus iconos, como en la web: listas de [icono, texto].
    if (r.candy) full.push(['Caramelos de Halloween', [['candy', '+' + r.candy]], C.gold]);
    if (r.t1 || r.t10) full.push(['Tickets del gacha', [r.t1 && ['ticket', '+' + r.t1], r.t10 && ['ticket10', '+' + r.t10 + ' ×10']].filter(Boolean), '#fff']);
    const mv = (r.moves || []).map(m => ['move:' + m.id, T(m.name, 'move') + ' Nv.' + m.lvl]);
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
    const nf = v => Math.round(v).toLocaleString('es-ES');
    const team = (r.team || []).map(p => {
      const sm = p.sum;
      let total = 0;
      const rows = sm.mv.map(([id, lvl, dealt, since0, evo]) => {
        const m = G.Moves.instance(id, lvl);
        if (evo) G.Moves.evolve(m);
        if (m.cat) total += dealt;
        return { id, lvl, name: T(m.name, 'move'), dmg: m.cat ? nf(dealt) : '—', dps: m.cat ? nf(dealt / Math.max(5, sm.t - since0)) + '/s' : '—' };
      });
      return { tab: p.me ? T('Tú') : p.name, sh: sm.sh, line: G.I18n.f('{x} · Nv. {x} · {x} de daño en total', T((G.DEX_BY[sm.dex] || {}).name || ''), sm.lv, nf(total)),
        rows, item: sm.it && G.Items.BY[sm.it] ? sm.it : null };
    });
    const caught = r.caught || [];
    let ask = false;
    if (G.Funding && G.Funding.url) {
      const runs = (G.DB.save && G.DB.save.stats && G.DB.save.stats.runs) || 0, today = new Date().toISOString().slice(0, 10);
      if (runs >= 2 && (r.record || runs % 10 === 0)) try { if (localStorage.getItem('ps.ask') !== today) { localStorage.setItem('ps.ask', today); ask = true; } } catch (e) { /* nada */ }
    }
    let tab = 0, osel = 0;   // osel: el botón (cooperativo local: Reintentar · Cambiar Pokémon · Volver al menú)
    const BW2 = team.length ? 736 : 360, LW = 340, rowH = 46;
    const leftH = () => 2 * (rowH + 6) + full.reduce((a, f) => a + cellH(f, rowH, LW) + 6, 0);
    const rightH = () => {
      if (!team.length) return 0;
      const t = team[tab];
      return 16 + (team.length > 1 ? 26 : 0) + 18 + 16 + t.rows.length * 20 + 34 + (caught.length ? 104 : 0) + (ask ? 70 : 0);
    };
    open({ id: 'scr-over',
      key: now => (now - since > 1000) + '|' + tab + '|' + osel,
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
            team.forEach((p, i) => { cx += chip(cx, ry, p.tab, i === tab) + 4; });
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
            font(11, true); text('Nv.' + m.lvl, rx + 32 + ctx.measureText(m.name).width, ry + 2, 8.5, C.muted);
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
          if (ask) {
            rr(rx + 4, ry, RW - 8, 62, 7); ctx.strokeStyle = C.gold; ctx.lineWidth = 1.5; ctx.stroke();
            wrap(T('¿Te está gustando PokéSurvivor Classic? Lo hago yo solo y los servidores cuestan dinero. Si quieres, puedes ayudarme a mantenerlo en línea.'), RW - 28, 9.5)
              .slice(0, 3).forEach((l, i) => text(l, rx + 14, ry + 6 + i * 12, 9.5, '#fff'));
            icon('heart', rx + 14, ry + 44, 12); text(G.Funding.url.replace(/^https:\/\//, ''), rx + 30, ry + 44, 10, C.gold, 'left', true);
            ry += 70;
          }
          bottom = Math.max(bottom, ry);
        }
        y = bottom;
        if (r.record) { text(T('¡Nuevo récord de tiempo!'), W / 2, y + 2, 11, C.gold, 'center', true); y += 22; }
        const hs = team.length > 1 ? [[local ? 'l1' : 'lr', 'Jugador']] : [];
        if (local) {   // (←→ los botones; L1/R1 la pestaña del jugador)
          const on = now - since > 1000;
          ['Reintentar', 'Cambiar Pokémon', 'Volver al menú'].forEach((l, i) => btn(W / 2 - 225 + i * 155, y + 6, 140, 30, T(l), i ? 'ghost' : 'gold', on && osel === i, 12));
          if (on) hs.push(['lr', 'Mover'], ['x', 'Elegir']);
        } else {
          btn(W / 2 - 70, y + 6, 140, 30, T('Volver al menú'), 'gold', now - since > 1000, 12);
          if (now - since > 1000) hs.push(['x', 'Volver al menú']);
        }
        if (hs.length) hints(hs);
      },
      live(now) {
        if (!caught.length || this.caughtY == null) return;
        caught.slice(0, 5).forEach((c, i) => monIn(c.dex, this.caughtX + i * 68, this.caughtY, 64, 60, 2, now, { shiny: true }));
      },
      input(ev, now) {
        const b = psPadRaw().buttons, sh = local ? (b[4] && !this._l ? -1 : b[5] && !this._r ? 1 : 0) : ev.dx;
        if (local) { this._l = b[4]; this._r = b[5]; }
        if (sh && team.length > 1) { tab = (tab + sh + team.length) % team.length; G.Audio.sfx('select'); }
        if (now - since <= 1000) return;
        if (local && ev.dx) { osel = (osel + ev.dx + 3) % 3; G.Audio.sfx('select'); }
        if (local && ev.a) {
          G.Audio.sfx('confirm');
          psLocal.toRoom(osel === 0);   // (a los demás: que salgan; con Reintentar, la partida empieza en cuanto estén)
          overBack();
          if (osel < 2) localLobbyScreen();
        } else if (ev.a) overBack();
      },
    });
    preIdle(caught.map(c => c.dex), true);
  }

  // ---------------- en la partida: los botones del mando junto al HUD ----------------
  // El HUD de la web pone las teclas (1-4 ataques, 5-8 esferas). Con mando: L1/R1 cambian de ataque
  // (gamepad.js), □ usa la esfera elegida (la dorada) y △ cambia de esfera. Misma geometría que hud.js.
  function hudHints() {
    const pl = G.Game.player;
    if (!pl || G.Game.state !== 'playing' || !G.Pad.name) return;
    const LW = psLogical.w, LH = psLogical.h, k = W / LW;   // el HUD dibuja en píxeles lógicos (browser.js)
    const S = 54, GAP = 9, n = Math.max(1, pl.slots.length), totalW = n * S + (n - 1) * GAP;
    const sx = (LW - totalW) / 2, sy = LH - S - 18;
    const hc = globalThis.psHudCv && psHudCv();   // cooperativo local: con la barra, en su esquina (main.c)
    ctx = hc ? hc.getContext('2d') : screen;
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
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
    ctx.drawImage(sh.img, f * a.w, row * a.h, a.w, a.h, Math.round(x - a.ax * k), Math.round(y - a.ay * k), a.w * k, a.h * k);
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
      ctx.globalAlpha = 0.55;
      ctx.drawImage(c, Math.round(fx - a.ax * k), Math.round(fy - a.ay * k), a.w * k, a.h * k);
      ctx.globalAlpha = 1;
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
  const TH_BIN = ps.ROOT + '/thumbs.bin', TH_JSON = ps.ROOT + '/thumbs.json';
  const thKey = () => (ps.readFile(ps.ROOT + '/game/version.json') || '').trim() + '|' + thumbs.list.length + '|' + thumbs.cv.height;
  function thumbsSave() {
    try {
      const img = thumbs.cv.getContext('2d').getImageData(0, 0, 2048, thumbs.cv.height);
      if (ps.writeFile(TH_BIN, img.data.buffer))
        ps.writeFile(TH_JSON, JSON.stringify({ key: thKey(), ok: thumbs.list.filter(d => thumbs.pos.get(d).ok) }));
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
    const Q = G.PERSONALITY_TEST, scores = {};
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
          idx++; sel = 0;
          if (idx >= Q.length) { close(); testResult(G.personalityResult(scores), scores); }
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
        btn(W / 2 - 150, ty + 30, 145, 30, T('¡Vamos juntos!'), 'gold', sel === 0, 12);
        btn(W / 2 + 5, ty + 30, 145, 30, T('Elegir otro'), 'blue', sel === 1, 12);
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
    open({
      key: () => sel + '|' + scroll,
      draw() {
        dim(); box(BX, BY, BW, BH);
        text(T('Elige a tu compañero'), BX + 18, BY + 16, 20, '#fff', 'left', true);
        text(T('Los iniciales de todas las regiones, y dos amigos más.'), BX + 18, BY + 42, 11, C.muted);
        for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
          const i = (scroll + r) * COLS + c;
          if (i >= list.length) continue;
          const x = GX + c * CW, y = GY + r * CH, on = i === sel;
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
        text(moveName(st.start) + ' · ' + st.traits.map(t => T(t)).join(', '), ix, fy + 7, 10, C.muted);
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
    let sel = 0, top = 0, ver = 0;
    const BW2 = 600, X = (W - BW2) / 2, Y = 40, BH2 = H - 80, COLS = 2, RH = 34, CWd = (BW2 - 48 - 8) / 2;
    open({
      key: () => sel + '|' + ver,
      draw() {
        dim(); box(X, Y, BW2, BH2);
        text(T(title), X + 18, Y + 16, 19.5, '#fff', 'left', true);
        btn(X + BW2 - 72, Y + 14, 56, 22, T('Volver'), 'ghost', false, 10);
        const subL = sub ? wrap(typeof sub === 'function' ? sub() : sub, BW2 - 40, 10.5).slice(0, 3) : [];
        subL.forEach((l, i) => text(l, X + 18, Y + 46 + i * 14, 10.5, C.muted));
        const items = getItems(), gy = Y + 54 + subL.length * 14, vis = Math.floor((Y + BH2 - 14 - gy) / RH);
        const row = Math.floor(sel / COLS);
        if (row < top) top = row; else if (row >= top + vis) top = row - vis + 1;
        panel(X + 14, gy - 6, BW2 - 28, vis * RH + 8);
        for (let i = top * COLS; i < Math.min(items.length, (top + vis) * COLS); i++) {
          const it = items[i], on = i === sel, x = X + 24 + (i % COLS) * (CWd + 8), y = gy + (Math.floor(i / COLS) - top) * RH;
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
        if ((ev.dx || ev.dy) && n) { sel = Math.max(0, Math.min(n - 1, sel + ev.dx + ev.dy * COLS)); G.Audio.sfx('select'); }
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
    let sel = 0, top = 0, ver = 0;
    const banList = () => { s.pban = s.pban || {}; return s.pban[upgDex] || (s.pban[upgDex] = []); };

    const pickers = {
      ban(lvl) {
        movePicker('Veto', () => T('Los movimientos que no quieres que te salgan en las cartas') + ' (' + banList().length + '/' + lvl + ')',
          () => {
            const start = G.startMoveOf(upgDex), start2 = G.startMove2Of(upgDex), l = banList();
            return G.Moves.poolFor(G.DEX_BY[upgDex]).filter(id => id !== start && id !== start2).sort(byName)
              .map(id => ({ id, label: moveName(id), icon: 'move:' + id, on: l.includes(id), sub: l.includes(id) ? T('vetado') : '' }));
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
          () => G.startChoices(upgDex).sort(byName).map(id => ({ id, label: moveName(id), icon: 'move:' + id, on: id === G.startMoveOf(upgDex), sub: id === base ? T('de serie') : '' })),
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
            .map(id => ({ id, label: moveName(id), icon: 'move:' + id, on: id === G.startMove2Of(upgDex) }))),
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
        const ids = G.Moves.poolFor(G.DEX_BY[upgDex]).concat([G.startMoveOf(upgDex)]).filter((v, i, a) => a.indexOf(v) === i).sort(byName);
        const slots = () => { const l = (s.pbind[upgDex] || [null, null, null, null]).slice(0, 4); while (l.length < 4) l.push(null); return l; };
        movePicker('Atajos de movimientos', 'Qué movimiento va siempre en cada hueco, para la memoria muscular.',
          () => slots().map((id, i) => ({ id: String(i), label: T('Hueco') + ' ' + (i + 1) + ': ' + (id ? moveName(id) : T('Libre')), icon: id ? 'move:' + id : null })),
          slot => {
            const i = +slot;
            movePicker(T('Hueco') + ' ' + (i + 1), null,
              () => [{ id: '', label: T('Libre'), on: !slots()[i] }].concat(ids.map(id => ({ id, label: moveName(id), icon: 'move:' + id, on: slots()[i] === id }))),
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
    open({
      key: () => sel + '|' + upgDex + '|' + ver + '|' + s.coins,
      draw() {
        modal('Mejoras');
        const mon = G.DEX_BY[upgDex], levels = G.DB.upgradesOf(upgDex);
        const shiny = upgDex === s.partner && !!s.partnerShiny && G.DB.ownsShiny(upgDex);
        stage(BX + 18, BY + 48, 90, 72, shiny ? '#9ae6ff' : G.U.TYPE_COLOR[mon.types[0]], shiny);
        text(T('Cada Pokémon tiene sus propias mejoras: sólo cuentan cuando juegas con él.'), BX + 122, BY + 56, 11, '#fff');
        text(T('Pokémon'), BX + 122, BY + 86, 10, C.muted);
        if (mons.length > 1) padIcon('l1', BX + 186, BY + 92);
        rr(BX + 204, BY + 80, 220, 24, 7); ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fill(); ctx.strokeStyle = 'rgba(244,248,255,0.3)'; ctx.lineWidth = 1.5; ctx.stroke();
        text(mon.name + (upgDex === s.partner ? ' (' + T('compañero') + ')' : ''), BX + 214, BY + 86, 11, '#fff', 'left', true);
        if (mons.length > 1) padIcon('r1', BX + 444, BY + 92);
        top = Math.max(0, Math.min(top, Math.floor(sel / COLS)), Math.floor(sel / COLS) - VIS + 1);
        for (let i = top * COLS; i < Math.min(rows.length, (top + VIS) * COLS); i++) {
          const id = rows[i], x = GX + (i % COLS) * (CW + 8), y = GY + (Math.floor(i / COLS) - top) * (CH + 8), on = i === sel;
          panel(x, y, CW, CH);
          if (on) { rr(x, y, CW, CH, 8); ctx.strokeStyle = C.gold; ctx.lineWidth = 2; ctx.stroke(); }
          if (id === 'bind') {
            icon('cards', x + 10, y + CH / 2 - 12, 24);
            text(T('Atajos'), x + 44, y + 14, 12, '#fff', 'left', true);
            wrap(T('Qué movimiento va siempre en cada hueco'), CW - 120, 9).slice(0, 2).forEach((l, k) => text(l, x + 44, y + 31 + k * 12, 9, C.muted));
            btn(x + CW - 70, y + CH / 2 - 11, 60, 22, T('Elegir'), 'blue', false, 10);
            continue;
          }
          const u = G.Upgrades.BY[id], lvl = levels[u.id] || 0, maxed = lvl >= u.max, locked = !maxed && u.needs && !levels[u.needs];
          const cost = maxed ? 0 : G.Upgrades.cost(u.id, lvl), canBuy = !maxed && !locked && s.coins >= cost;
          icon(u.icon, x + 10, y + CH / 2 - 12, 24);
          const bw = 64, tw = CW - 44 - bw - 16;
          let ty = y + 10;
          text(T(u.name), x + 44, ty, 11, '#fff', 'left', true);
          wrap(T(u.unit), tw, 9).slice(0, 2).forEach(l => { ty += 13; text(l, x + 44, ty, 9, C.muted); });
          const pw = Math.min(10, (tw - 2) / u.max - 2);
          for (let k = 0; k < u.max; k++) { rr(x + 44 + k * (pw + 2), y + CH - 12, pw, 4, 1); ctx.fillStyle = k < lvl ? C.gold : 'rgba(0,0,0,0.35)'; ctx.fill(); }
          if (maxed) btn(x + CW - bw - 10, y + CH / 2 - 13, bw, 26, T('Máx.'), 'blue', false, 10);
          else if (locked) btn(x + CW - bw - 10, y + CH / 2 - 13, bw, 26, T('Bloqueado'), 'off', false, 9);
          else btn(x + CW - bw - 10, y + CH / 2 - 13, bw, 26, String(cost), canBuy ? 'gold' : 'off', false, 11, 'coin');
          if (['ban', 'start', 'start2'].includes(id) && lvl > 0) { padIcon('t', x + CW - bw - 24, y + CH / 2, 7); }
        }
        const rowsN = Math.ceil(rows.length / COLS);
        if (rowsN > VIS) {
          const hh = VIS * (CH + 8) - 8, bh = hh * VIS / rowsN;
          rr(BX + BW - 12, GY, 4, hh, 2); ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fill();
          rr(BX + BW - 12, GY + (hh - bh) * top / (rowsN - VIS), 4, bh, 2); ctx.fillStyle = C.muted; ctx.fill();
        }
        const cur = rows[sel], lvl = cur !== 'bind' ? (levels[cur] || 0) : 1;
        const h = [['lr', 'Mover'], ['x', cur === 'bind' ? 'Elegir' : 'Comprar']];
        if (['ban', 'start', 'start2'].includes(cur) && lvl > 0) h.push(['t', 'Elegir movimientos']);
        h.push(['s', 'Cambiar Pokémon'], ['o', 'Volver']);
        hints(h);
      },
      live(now) {
        const shiny = upgDex === s.partner && !!s.partnerShiny && G.DB.ownsShiny(upgDex);
        monIn(upgDex, BX + 18, BY + 48, 90, 72, 2, now, { shiny });
      },
      input(ev) {
        const p = psPadRaw().buttons, b4 = p[4] && !prevL1, b5 = p[5] && !prevR1;
        prevL1 = p[4]; prevR1 = p[5];
        if ((b4 || b5) && mons.length > 1) {
          upgDex = mons[(mons.indexOf(upgDex) + (b5 ? 1 : -1) + mons.length) % mons.length];
          preIdle([upgDex]);
          G.Audio.sfx('select'); ver++;
        }
        if (ev.dx || ev.dy) { sel = Math.max(0, Math.min(rows.length - 1, sel + ev.dx + ev.dy * COLS)); G.Audio.sfx('select'); }
        const cur = rows[sel], lvl = (G.DB.upgradesOf(upgDex)[cur] || 0);
        if (ev.a) { if (cur === 'bind') { close(); pickers.bind(); } else buy(G.Upgrades.BY[cur]); }
        else if (ev.y && lvl > 0 && pickers[cur]) { close(); pickers[cur](lvl); }
        else if (ev.x) { G.Audio.sfx('select'); close(); dexScreen(upgDex, d => { if (d) upgDex = d; again(); }); }   // □: elegir en la Pokédex
        else if (ev.b) { G.Audio.sfx('select'); close(); back(); }
      },
    });
    let prevL1 = true, prevR1 = true;   // lo que estuviera pulsado al abrir no cuenta
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
        tabs().forEach(b => {
          const on = b.gen === gachaGen, w = b.event ? 84 : 54;
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
          btn(x, PY, PW, 40, null, ok ? 'gold' : 'off', i === sel);
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
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
        if (phase === 'slot') { btn(W / 2 - 27, 420, 54, 24, T('Saltar'), 'ghost', false, 10); return; }
        if (n === 100) {
          const news = res.filter(r => r.isNew).length, shn = res.filter(r => r.shiny).length, coins = res.reduce((a, r) => a + r.refund, 0);
          text(G.I18n.f('Nuevos: {x}', news) + ' · ' + G.I18n.f('Shiny: {x}', shn) + ' · +' + coins.toLocaleString('es-ES'), W / 2, 22, 13, C.gold, 'center', true);
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
          btn(W / 2 - 112, H - 58, 104, 28, T('Siguientes'), 'gold', bsel === 0, 11);
          btn(W / 2 + 8, H - 58, 104, 28, T('Saltar'), 'ghost', bsel === 1, 11);
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
  function shoulders() {
    let p4 = true, p5 = true;
    return () => { const b = psPadRaw().buttons, l = b[4] && !p4, r = b[5] && !p5; p4 = b[4]; p5 = b[5]; return l ? -1 : r ? 1 : 0; };
  }

  // ---------------- Colección (como js/ui/menu.js openDex / showDetail) ----------------
  const GEN_NAMES = ['Kanto', 'Johto', 'Hoenn', 'Sinnoh', 'Teselia', 'Kalos', 'Alola', 'Galar', 'Paldea'];
  const STAT = { pa: 'Ataque', sa: 'At. Esp.', df: 'Defensa', sd: 'Def. Esp.', spd: 'Velocidad' };
  const natLine = n => n.up ? '+' + T(STAT[n.up]) + ' −' + T(STAT[n.down]) : T('neutra');
  // Región (0: todas) y los filtros de la colección como en la web (menu.js, dexF): tengo / me faltan, shiny,
  // favoritos, rarezas (varias), tipo y orden. Duran mientras no se cierra el juego.
  let dexGen = 0;
  const DEX0 = () => ({ status: 'all', rar: new Set(), shiny: false, fav: false, type: '', sort: 'num' });
  let dexF = DEX0();
  const DEX_SORTS = [['num', 'Nº'], ['name', 'Nombre'], ['rar', 'Rareza'], ['new', 'Recién conseguidos'], ['used', 'Más usados']];
  const DEX_STATUS = [['all', 'Todos'], ['own', 'Tengo'], ['miss', 'Me faltan']];
  /** La lista con la región, los filtros y el orden de ahora (dexList de la web, sin la búsqueda). */
  function dexList() {
    const s = G.DB.save, f = dexF;
    const list = G.DEX.filter(p => {
      const own = !!s.owned[p.dex];
      if ((dexGen && p.gen !== dexGen) || !G.SPRITE_META[p.dex]) return false;
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
    const s = G.DB.save, COLS = 5, CW = 88, CH = 96, GX = BX + 18, GY = BY + 128, ROWS = 3, DX = BX + 482, DW = BW - 500;
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
    open({
      key: () => sel + '|' + scroll + '|' + dexGen + '|' + ver,
      draw() {
        const owned = Object.keys(s.owned).filter(d => G.DEX_BY[d]).length;
        modal('Pokémon', owned + ' / ' + G.DEX.length);
        // Pestañas: Todas + 9 regiones, con cuántos tienes de cada una.
        let tx = BX + 18;
        padIcon('l1', tx + 10, BY + 62); tx += 26;
        ['Todas'].concat(GEN_NAMES).forEach((g, i) => {
          const all = G.DEX.filter(p => !i || p.gen === i), have = all.filter(p => s.owned[p.dex]).length, on = i === dexGen;
          rr(tx, BY + 48, 58, 30, 6); ctx.fillStyle = on ? vgrad(BY + 48, 30, '#ffe37a', '#f0a31e') : 'rgba(0,0,0,0.25)'; ctx.fill();
          ctx.strokeStyle = on ? '#fff7d6' : 'rgba(244,248,255,0.25)'; ctx.lineWidth = 1.5; ctx.stroke();
          text(T(g), tx + 29, BY + 52, 10, on ? '#3a2300' : '#fff', 'center', true, on ? null : C.navy);
          text(have + '/' + all.length, tx + 29, BY + 65, 8, on ? '#5a3a00' : C.muted, 'center', false, null);
          tx += 62;
        });
        padIcon('r1', tx + 10, BY + 62);
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
          cx += chip(cx, BY + 89, l, !first, ico) + 5;
        }
        text(list.length + ' Pokémon', DX - 14, BY + 94, 10, C.muted, 'right');
        // Rejilla
        for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
          const i = (scroll + r) * COLS + c;
          if (i >= list.length) continue;
          const d = list[i], x = GX + c * CW, y = GY + r * CH, on = i === sel, own = s.owned[d], p = G.DEX_BY[d];
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
          font(9.5); const rw = ctx.measureText(T(G.Gacha.RARITY_NAME[p.rarity])).width + 16;
          icon(G.Icons.RARITY_BALL[p.rarity] || 'ball', mx - rw / 2, BY + 262, 12);
          text(T(G.Gacha.RARITY_NAME[p.rarity]), mx - rw / 2 + 16, BY + 263, 9.5, G.Gacha.RARITY_COLOR[p.rarity]);
          if (own) {
            typeChips(p.types, mx, BY + 279, true);
            const n = G.Mons.natureOf(d), q = G.Mons.monFor(d), mood = k => n.up === k ? 1 : n.down === k ? -1 : 0;
            [['Vida', q.hp / 183, q.hp, ''], ['Ataque', q.pa / 1.55, '×' + q.pa.toFixed(2), 'pa'], ['At. Esp.', q.sa / 1.55, '×' + q.sa.toFixed(2), 'sa'],
             ['Defensa', q.df / 160, Math.round(q.df), 'df'], ['Def. Esp.', q.sd / 160, Math.round(q.sd), 'sd'], ['Velocidad', q.spd / 137, Math.round(q.spd), 'spd']]
              .forEach(([l, f, v, k], i) => statBar(DX + 12, BY + 300 + i * 15, DW - 24, l, f, v, mood(k)));
            text(T('Empieza con') + ' ' + moveName(G.startMoveOf(d)), mx, BY + 395, 9.5, C.gold, 'center');
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
        if (ev.a && list[sel] && onPick && !s.owned[list[sel]]) G.Audio.sfx('error');
        else if (ev.a && list[sel]) { G.Audio.sfx('select'); const d = list[sel]; close(); onPick ? onPick(d) : monCard(d); }
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
        () => tms.map(id => ({ id, label: moveName(id), icon: 'move:' + id, sub: '×' + G.Shop.tmCount(id) })),
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
          if (a) btn(x, y, w, h, a.label, a.fn ? kind : 'off', focus === id, px, a.ico);
          return !!a;
        };
        // Izquierda: el Pokémon (los dos botones abajo, con aire entre ellos y hasta el borde de la caja)
        stage(L + 25, BY + 48, 200, 130, !own ? C.edgeIn : viewShiny ? '#9ae6ff' : G.U.TYPE_COLOR[p.types[0]], own && viewShiny);
        if (hasSh) { btn(mx - 62, BY + 184, 60, 20, T('Normal'), 'ghost', !viewShiny, 10); btn(mx + 2, BY + 184, 60, 20, 'Shiny', 'ghost', viewShiny, 10, 'shiny'); }
        text(own ? p.name : '???', mx, BY + 210, 16, '#fff', 'center', true);
        if (own) {
          const fav = G.DB.isFav(dex);
          const fl = acts.find(q => q.id === 'fav').label; font(10); const fw = ctx.measureText(fl).width + 30;
          chip(mx - fw / 2, BY + 232, fl, fav, fav ? 'star' : 'starDim');
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
        if (hasSh && (ev.y || (ev.dx && viewShiny !== ev.dx > 0))) { viewShiny = ev.y ? !viewShiny : ev.dx > 0; preIdle([dex], viewShiny); G.Audio.sfx('select'); ver++; }
        if (ev.a && a[sel] && a[sel].fn) a[sel].fn();
        else if (ev.b) { G.Audio.sfx('back'); close(); dexScreen(dex); }
      },
    });
    preIdle([dex], viewShiny);
  }

  // ---------------- Tienda Kecleon y Mochila (#scr-shop / #scr-bag; la lógica es G.Shop) ----------------
  // Una tarjeta .upg-item: icono, título (con extra dorado), descripción y, a la derecha, el botón o el número.
  const UG = 8, UW = Math.floor((BW - 36 - 2 * UG) / 3);   // 3 columnas dentro de la caja (con 233 la 3ª se salía)
  function upgCard(x, y, h, { ico, dimIco, title, extra, chips, desc, descCol, price, right, rightDim, on }) {
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
    if (price != null) btn(x + UW - 72, y + h / 2 - 12, 62, 24, price.toLocaleString('es-ES'), G.DB.save.coins >= price ? 'gold' : 'off', on, 10, 'coin');
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
    let sel = 0, scroll = 0;
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
    open({
      id: 'scr-shop',
      key: () => sel + '|' + scroll + '|' + s.coins + '|' + sum(s.bag) + '|' + sum(s.tms) + '|' + G.Halloween.on + '|' + Object.keys(s.skins || {}).length + '|' + (G.Halloween.on && skinReady()),
      draw() {
        dim();
        box(BX, BY, BW, BH);
        const pos = layout(), k = keys(), top = BY + SH + 4;
        const cy = pos[sel].y - scroll;
        if (cy + SH + 4 < SH + 4 + 30) scroll = Math.max(0, pos[sel].y - 60);
        if (cy + IH > BH - 10 - SH) scroll = pos[sel].y + IH - (BH - 10 - SH);
        scroll = Math.max(0, Math.min(scroll, Math.max(0, pos.end - (BH - SH - 6))));
        // El contenido, recortado a la caja (debajo del puesto)
        ctx.save();
        rr(BX + 3, top, BW - 6, BH - SH - 7, 6); ctx.clip();
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
            icon('candy', BX + 18, ty - 2, 12); text(G.I18n.f('Tienes {x} caramelos', have.toLocaleString('es-ES')), BX + 34, ty, 9.5, C.gold, 'left', true);
          }
        }
        const partner = s.partner;
        k.forEach((key, i) => {
          const { x, y } = pos[i], on = i === sel;
          if (Y(y) > BY + BH || Y(y) + IH < top) return;
          if (key.startsWith('skin:')) {
            const id = key.slice(5), sk = G.Skins.SKINS[id], got = G.Skins.owns(s, id), name = nameOf(sk.dex), P = G.Halloween.SKIN_PRICE;
            const have = (s.bag && s.bag.candy) || 0;
            const desc = !got ? G.I18n.f(sk.dex === 94 ? 'Sombrero y capa de bruja para {x}.' : 'Sombrero de bruja para {x}.', name)
              : G.DB.owns(sk.dex) ? T('Comprada. Póntela o quítatela en la ficha del Pokémon.') : G.I18n.f('Comprada. Se pone cuando tengas a {x}.', name);
            upgCard(x, Y(y), IH, { ico: 'witch', title: T(sk.name), on, desc, right: got ? T('Comprada') : null });
            // El Pokémon con su disfraz (canvas data-skin-pv de la web), encima del icono.
            rr(x + 4, Y(y) + 4, 36, IH - 8, 6); ctx.fillStyle = '#141b33'; ctx.fill();
            monBox(sk.dex, x + 4, Y(y) + 4, 36, IH - 8, 1, 0, false, 0, id);
            if (!got) btn(x + UW - 72, Y(y) + IH / 2 - 12, 62, 24, String(P), have >= P ? 'gold' : 'off', on, 10, 'candy');
          } else if (key.startsWith('tm:')) {
            const id = key.slice(3), m = G.Moves.BY_ID[id], fits = partner && G.Mons.canLearn(partner, id);
            const cat = G.Stats.NAME[m.cat || (m.stat === 'patk' ? 'physical' : m.stat === 'satk' ? 'special' : '')];
            const chips = [[G.U.TYPE_NAME[m.type], G.U.TYPE_COLOR[m.type]]];
            if (cat) chips.push([T(cat), 'rgba(0,0,0,0.35)', '#fff']);
            upgCard(x, Y(y), IH, { ico: 'move:' + id, title: T('MT') + ' ' + moveName(id), chips, on,
              extra: G.Shop.tmCount(id) ? '· ' + G.I18n.f('tienes {x}', G.Shop.tmCount(id)) : '',
              desc: fits ? G.I18n.f('{x} la puede aprender', nameOf(partner)) : partner && G.Mons.taught(partner).includes(id) ? G.I18n.f('{x} ya la sabe', nameOf(partner)) : T(m.desc),
              descCol: fits ? C.gold : null, price: G.Shop.tmPrice(id) });
          } else {
            const it = G.Shop.ITEMS[key];
            upgCard(x, Y(y), IH, { ico: it.icon, title: T(it.name), on, extra: G.Shop.count(key) ? '· ' + G.I18n.f('tienes {x}', G.Shop.count(key)) : '',
              desc: T(it.desc), price: it.price });
          }
        });
        ctx.restore();
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
          sel = Math.max(0, Math.min(k.length - 1, i)); G.Audio.sfx('select');
        }
        if (ev.a && k[sel].startsWith('skin:')) {
          const r = G.Shop.buySkin(k[sel].slice(5));
          if (!r.ok) { G.Audio.sfx('error'); if (r.error) G.UI.toast(T(r.error)); }
          else { G.Audio.sfx('buy'); G.UI.toast(T('¡Feliz Halloween! Póntela en la ficha del Pokémon.')); try { G.ShopUI.render(); } catch (e) {} }
        } else if (ev.a) {
          const res = G.Shop.buy(k[sel]);
          if (!res.ok) { G.Audio.sfx('error'); if (res.error) G.UI.toast(T(res.error)); }
          else { G.Audio.sfx('buy'); try { G.ShopUI.render(); } catch (e) {} }
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
    open({
      key: () => String(scroll),
      draw() {
        modal('Mochila');
        const top = BY + 44;
        ctx.save(); rr(BX + 3, top, BW - 6, BH - 47, 6); ctx.clip();
        let y = top + 6 - scroll;
        const cards = [];
        if (empty()) {
          text(T('Tu Mochila está vacía.'), BX + BW / 2, y + 12, 11, C.muted, 'center');
          btn(BX + BW / 2 - 100, y + 36, 200, 28, T('Ir a la Tienda Kecleon'), 'gold', true, 11, 'shop');
          y += 82;
        } else {
          const l = wrap(T('Para usarlo, abre la colección, elige un Pokémon y pulsa Menta, Cápsula o Enseñar MT en su ficha.'), BW - 210, 10);
          l.forEach((t, i) => text(t, BX + 18, y + i * 13, 10, C.muted));
          btn(BX + BW - 178, y, 160, 24, T('Ir a la colección'), 'blue', true, 10, 'book');
          y += Math.max(l.length * 13, 28) + 8;
          for (const id of items()) { const it = G.Shop.ITEMS[id]; cards.push({ ico: it.icon, title: T(it.name), desc: T(it.desc), right: '×' + G.Shop.count(id) }); }
          for (const id of tms()) {
            const n = Object.keys(s.owned).filter(d => G.DEX_BY[d] && G.Mons.canLearn(+d, id)).length;
            cards.push({ ico: 'move:' + id, title: T('MT') + ' ' + moveName(id), desc: n ? G.I18n.f('La pueden aprender {x} de tus Pokémon', n) : T('Ninguno de tus Pokémon la puede aprender'), right: '×' + s.tms[id] });
          }
          cards.forEach((c, i) => upgCard(BX + 18 + (i % 3) * (UW + UG), y + Math.floor(i / 3) * (IH + UG), IH, c));
          y += Math.ceil(cards.length / 3) * (IH + UG) + 6;
        }
        h3('Amuletos Iris', BX + 18, y);
        y += 20;
        const sub = wrap(T('Completa la Pokédex de una región (legendarios incluidos) y te dan su Amuleto Iris: en su banner, los shiny salen el doble (del 1 % al 2 %).'), BW - 40, 9);
        sub.forEach((t, i) => text(t, BX + 18, y + i * 12, 9, C.muted));
        y += sub.length * 12 + 6;
        G.Gacha.BANNERS.forEach((b, i) => {
          const d = G.Gacha.dexOf(s, b.gen), on = d.have >= d.total, name = T(b.name);
          const right = on ? '2 %' : d.have + ' / ' + d.total;
          upgCard(BX + 18 + (i % 3) * (UW + UG), y + Math.floor(i / 3) * (IH + UG), IH, { ico: 'iris', dimIco: !on, title: G.I18n.f('Amuleto Iris de {x}', name),
            desc: on ? G.I18n.f('Shiny al 2 % en el banner de {x}', name) : G.I18n.f('Completa la Pokédex de {x}', name), right, rightDim: !on });
        });
        y += 3 * (IH + UG);
        ctx.restore();
        maxScroll = Math.max(0, y + scroll - (BY + BH - 6));
        hints([['ud', 'Desplazar'], ['x', empty() ? 'Ir a la Tienda Kecleon' : 'Ir a la colección'], ['o', 'Volver']]);
      },
      input(ev) {
        if (ev.dy) scroll = Math.max(0, Math.min(maxScroll, scroll + ev.dy * 60));
        if (ev.a) { G.Audio.sfx('select'); close(); if (empty()) shopScreen(); else dexScreen(s.partner); }
        else if (ev.b) { G.Audio.sfx('back'); close(); back(); }
      },
    });
  }

  // Lo que aún no está hecho para mando sale apagado.
  // El menú de la web (#scr-menu): mismo orden, iconos y subtítulos. fn null: aún no está para mando.
  const sum = o => Object.values(o || {}).reduce((a, b) => a + (+b || 0), 0);
  const MENU = [
    ['Jugar', 'ball', () => (G.Social.room ? 'Ir a la sala' : 'Entra en la mazmorra'), () => {
      if (G.Social.room) return lobbyScreen();
      // El jugador 2 (cooperativo local) no empieza solo: la partida la abre el 1 y le llega a él (localcoop.js).
      if (ps.PLAYER) { G.UI.toast(T('Espera a que el jugador 1 pulse Jugar')); return mainMenu(); }
      if (globalThis.psLocal && ps.lc_peer && ps.lc_peer()) return localLobbyScreen();   // con más mandos: la sala local
      G.UI.hideAll(); G.Game.startRun();
    }],
    ['Pokémon', 'book', () => {
      const s = G.DB.save, owned = Object.keys(s.owned).filter(d => G.DEX_BY[d]).length, sh = Object.keys(s.shiny || {}).length;
      return owned + ' / ' + G.DEX.length + (sh ? ' · ' + sh + ' shiny' : '');
    }, () => dexScreen(G.DB.save.partner)],
    ['Mejoras', 'up', () => 'Haz más fuerte cada run', upgradesScreen],
    ['Multijugador', 'friends', () => {
      const req = G.DB.online && G.Social.started ? G.Social.friends.filter(f => f.status === 'in').length : 0;
      return req ? G.I18n.f('{x} solicitudes de amistad', req) : 'Juega en grupo, hasta 4';
    }, () => friendsScreen()],
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
      ops.push([y, 'd', fmt(v.d)]); y += 16;
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
    open({
      key: () => String(scroll),
      draw() {
        build(scroll + BH2 + 200);
        const total = done < NEWS.length ? y * NEWS.length / done : y;   // aproximado mientras falte
        dim(); box(X, Y, BW2, BH2);
        text(T('Novedades'), X + 18, Y + 16, 19.5, '#fff', 'left', true);
        btn(X + BW2 - 72, Y + 14, 56, 22, T('Cerrar'), 'ghost', false, 10);
        const top = Y + 46, vh = BH2 - 52;
        ctx.save(); rr(X + 3, top, BW2 - 6, vh, 4); ctx.clip();
        for (const [oy, kind, t, col] of ops) {
          const yy = top + oy - scroll;
          if (yy < top - 20 || yy > top + vh) continue;
          if (kind === 'h') text(t, X + 18, yy, 13.5, C.gold, 'left', true);
          else if (kind === 'd') text(t, X + 18, yy, 9.75, C.muted);
          else if (kind === 'tag') { font(9, true); const w = ctx.measureText(t).width + 12; rr(X + 18, yy, w, 14, 3); ctx.fillStyle = col; ctx.fill(); text(t, X + 24, yy + 2.5, 9, '#0b1020', 'left', true, null); }
          else if (kind === 'hr') { ctx.fillStyle = 'rgba(255,255,255,0.1)'; ctx.fillRect(X + 18, yy, TW + 24, 1); }
          else { if (kind === 'li0') { ctx.fillStyle = '#fff'; ctx.fillRect(X + 22, yy + 5, 3, 3); } text(t, X + 32, yy, 11, '#fff'); }
        }
        ctx.restore();
        if (total > vh) {
          const bh = Math.max(20, vh * vh / total);
          rr(X + BW2 - 10, top, 4, vh, 2); ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fill();
          rr(X + BW2 - 10, top + (vh - bh) * scroll / (total - vh), 4, bh, 2); ctx.fillStyle = C.muted; ctx.fill();
        }
        topbar('news');
        hints([['ud', 'Desplazar'], ['o', 'Cerrar']]);
      },
      input(ev) {
        const vh = BH2 - 52;
        build(scroll + vh + 260);
        const max = Math.max(0, y - vh);
        if (ev.dy) scroll = Math.max(0, Math.min(max, scroll + ev.dy * 60));
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
    if (r.coins) parts.push(['coin', String(r.coins)]);
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
    const profileRows = () => [0, 1, 2].map(i => ({ fav: i })).concat([{ title: true }, { preview: true }]);
    const rowsN = () => goalsTab === 0 ? missionRows().length : goalsTab === 2 ? profileRows().length : 0;
    if (goalsTab === 1) thumbsPump();
    open({
      key: () => goalsTab + '|' + sel + '|' + scroll + '|' + achCat + '|' + ver + '|' + (goalsTab === 1 && !thumbs.done ? thumbs.loaded : ''),
      draw() {
        modal('Misiones');
        // Pestañas (.tabs)
        const tw = (RW - 60) / 3;
        padIcon('l1', L + 12, BY + 58);
        TABS.forEach((t, i) => {
          const x = L + 28 + i * (tw + 4), on = i === goalsTab;
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
          for (const [title, list, weekly] of [['Diarias', s.missions.daily, false], ['Semanales', s.missions.weekly, true]]) {
            text(T(title), L, y, 13.5, '#fff', 'left', true);
            text(G.I18n.f('Se renuevan en {x}', untilText(weekly)), L + RW, y + 3, 9.5, C.muted, 'right');
            y += 22;
            list.forEach((m, i) => {
              const d = G.MissionDefs.BY[m.id], done = G.Progress.done(m), on = k === sel, h = 50;
              ctx.globalAlpha = m.claimed ? 0.55 : 1;
              rr(L, y, RW, h, 7); ctx.fillStyle = done && !m.claimed ? 'rgba(255,210,63,0.1)' : 'rgba(0,0,0,0.22)'; ctx.fill();
              ctx.strokeStyle = on ? C.gold : done && !m.claimed ? C.gold : 'rgba(244,248,255,0.14)'; ctx.lineWidth = on ? 2.5 : 1.5; ctx.stroke();
              text(T(strip(G.Progress.text(m))), L + 10, y + 7, 11, '#fff', 'left', true);
              rr(L + 10, y + 25, RW - 280, 5, 3); ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fill();
              rr(L + 10, y + 25, Math.max(3, (RW - 280) * Math.min(1, m.prog / m.goal)), 5, 3); ctx.fillStyle = C.gold; ctx.fill();
              text(Math.min(m.prog, m.goal).toLocaleString('es-ES') + ' / ' + m.goal.toLocaleString('es-ES'), L + 10, y + 34, 9, C.muted);
              rewardAt(d.reward, L + RW - 100, y + 19);
              const [lbl, kind] = m.claimed ? ['Recogido', 'off'] : done ? ['Recoger', 'gold'] : !weekly && !s.missions.rerolled ? ['Cambiar', 'ghost'] : ['En curso', 'off'];
              btn(L + RW - 88, y + 13, 78, 24, T(lbl), kind, on && kind !== 'off' && kind !== 'ghost', 10);
              if (on && kind === 'ghost') { rr(L + RW - 91, y + 10, 84, 30, 9); ctx.strokeStyle = C.gold; ctx.lineWidth = 2; ctx.stroke(); }
              ctx.globalAlpha = 1;
              y += h + 6; k++;
            });
            y += 8;
          }
          const r = missionRows()[sel];
          if (r && !r.m.claimed && G.Progress.done(r.m)) hh.push(['x', 'Recoger']);
          else if (r && !r.weekly && !s.missions.rerolled && !r.m.claimed) hh.push(['x', 'Cambiar']);
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
            cx += chip(cx, y, t, i === achCat) + 5;
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
            const st = ok ? T('¡Conseguido!') : v.toLocaleString('es-ES') + ' / ' + a.goal.toLocaleString('es-ES');
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
          if (titles.length < 2) text(T('Consigue logros para desbloquear títulos.'), L + w + 12, y + 8, 9.5, C.muted);
          y += 40;
          btn(L, y, 200, 30, T('Ver mi perfil público'), 'gold', sel === 4, 11);
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
        if (goalsTab === 1) {
          if (ev.dy) scroll = Math.max(0, Math.min(maxScroll, scroll + ev.dy * 60));
          if (ev.x) { achCat = (achCat + 1) % G.AchDefs.CATS.length; scroll = 0; G.Audio.sfx('select'); }
          return;
        }
        const n = rowsN();
        if (ev.dy && n) {
          sel = (sel + ev.dy + n) % n; G.Audio.sfx('select');
          // que se vea lo elegido (las misiones: 56 por fila más los títulos)
          if (goalsTab === 0) { const yy = sel * 56 + (sel >= s.missions.daily.length ? 52 : 22); if (yy < scroll) scroll = yy; else if (yy + 60 > scroll + BH - 90) scroll = yy + 60 - (BH - 90); }
        }
        if (goalsTab === 0) {
          const r = missionRows()[sel];
          if (ev.a && r) {
            if (!r.m.claimed && G.Progress.done(r.m)) { if (G.Progress.claim(r.m, r.weekly)) { G.Audio.sfx('buy'); G.UI.toast(T('¡Premio recogido!')); ver++; } }
            else if (!r.weekly && !s.missions.rerolled && !r.m.claimed) { if (G.Progress.reroll(r.i)) { G.Audio.sfx('select'); ver++; } }
          }
        } else {
          const P = s.profile;
          if (sel === 3 && ev.dx) {
            const titles = [''].concat(G.Progress.titles()), i = titles.indexOf(P.title || '');
            P.title = titles[(i + ev.dx + titles.length) % titles.length]; G.DB.commit(); G.Audio.sfx('select'); ver++;
          }
          if (ev.a && sel < 3) { G.Audio.sfx('select'); close(); favPicker(sel); }
          else if (ev.a && sel === 4) { G.Audio.sfx('select'); close(); publicProfile(G.Social.profileData(), () => goalsScreen(2)); }
        }
      },
    });
  }

  // Elegir un favorito del perfil: tus Pokémon (△ normal / shiny si lo tienes).
  function favPicker(slot) {
    if (!thumbs.done) return thumbsLoading(() => favPicker(slot));
    const s = G.DB.save, P = s.profile, mine = Object.keys(s.owned).map(Number).filter(d => G.DEX_BY[d] && G.SPRITE_META[d]).sort((a, b) => a - b);
    const COLS = 8, CW = 88, CH = 92, ROWS = 4, GX = BX + (BW - COLS * CW) / 2, GY = BY + 50;
    let sel = 0, scroll = 0, shiny = false;
    const back = () => goalsScreen(2);
    open({
      key: () => sel + '|' + scroll + '|' + shiny,
      draw() {
        modal(G.I18n.f('Elige el favorito {x}', slot + 1));
        for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
          const i = (scroll + r) * COLS + c;
          if (i >= mine.length) continue;
          const x = GX + c * CW, y = GY + r * CH, on = i === sel;
          rr(x + 3, y + 3, CW - 6, CH - 6, 8); ctx.fillStyle = on ? 'rgba(255,210,63,0.14)' : 'rgba(0,0,0,0.2)'; ctx.fill();
          ctx.strokeStyle = on ? C.gold : 'rgba(244,248,255,0.18)'; ctx.lineWidth = 1.5; ctx.stroke();
          let nm = (on && shiny ? '★ ' : '') + nameOf(mine[i]); font(9.5, true); while (nm.length > 3 && ctx.measureText(nm).width > CW - 12) nm = nm.slice(0, -2) + '…';
          text(nm, x + CW / 2, y + CH - 20, 9.5, '#fff', 'center', true);
        }
        const h = [['lr', 'Mover'], ['x', 'Elegir']];
        if (G.DB.ownsShiny(mine[sel])) h.push(['t', 'Normal / shiny']);
        h.push(['o', 'Volver']);
        hints(h);
      },
      live(now) {
        for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
          const i = (scroll + r) * COLS + c;
          if (i >= mine.length) continue;
          const x = GX + c * CW + 3, y = GY + r * CH + 4;
          if (i === sel && G.Sprites.sheet(mine[i], G.SPRITE_META[mine[i]].a.Idle ? 'Idle' : 'Walk', shiny).ready) monIn(mine[i], x, y, CW - 6, CH - 30, 2, now, { shiny });
          else thumbIn(mine[i], x, y, CW - 6, CH - 30, 2, false);
        }
      },
      input(ev) {
        if (ev.dx || ev.dy) {
          sel = Math.max(0, Math.min(mine.length - 1, sel + ev.dx + ev.dy * COLS)); shiny = false;
          const row = Math.floor(sel / COLS);
          if (row < scroll) scroll = row; else if (row >= scroll + ROWS) scroll = row - ROWS + 1;
          G.Audio.sfx('select');
        }
        if (ev.y && G.DB.ownsShiny(mine[sel])) { shiny = !shiny; preIdle([mine[sel]], shiny); }
        if (ev.a && mine[sel]) {
          P.favs = (P.favs || []).slice(); P.favs[slot] = { dex: mine[sel], shiny };
          P.favs = P.favs.filter(Boolean).slice(0, 3);
          G.DB.commit(); G.Audio.sfx('confirm'); close(); back();
        } else if (ev.b) { G.Audio.sfx('back'); close(); back(); }
      },
    });
  }

  // El perfil público (#scr-profile, G.ProfileUI.showData): nombre, título, favoritos, marcas y medallas.
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
                       ['Jefes', (b.bosses || 0).toLocaleString('es-ES')], ['Legendarios', b.legends || 0], ['Derrotados', (b.kills || 0).toLocaleString('es-ES')]];
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
  const LEGAL_MAIL = 'contactopokesurvivor@gmail.com', LEGAL_REPO = 'github.com/JPTER78/pokesurvivor';
  function legalBlocks() {
    let h = '';
    try {
      if (ps.readFile) { const f = ps.readFile(ps.ROOT + '/game/index.html') || ps.readFile(ps.ROOT + '/game/dev.html') || ''; const a = f.indexOf('id="scr-legal"'); h = a < 0 ? '' : f.slice(a, f.indexOf('</section>', a)); }
      if (!h) h = (document.getElementById('scr-legal') || {}).innerHTML || '';
    } catch (e) { h = ''; }
    h = h.replace(/<a id="legal-mail"[^>]*><\/a>/, LEGAL_MAIL).replace(/<a id="legal-repo"[^>]*><\/a>/, LEGAL_REPO);
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
    open({
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
        if (ev.dy) scroll = Math.max(0, Math.min(max, scroll + ev.dy * 50));
        if (ev.b || ev.a) { G.Audio.sfx('back'); close(); back(); }
      },
    });
  }

  // ---------------- teclado en pantalla ----------------
  // Para nombre y contraseña con el mando. ✕ escribe, □ borra, △ mayúsculas/minúsculas, OPTIONS acepta,
  // ○ cancela. done(texto) o done(null) si se cancela.
  let showPass = false;   // panel táctil (scePad no da Create): ver u ocultar la contraseña, en el teclado y al entrar
  const KB_ROWS = ['1234567890', 'qwertyuiop', 'asdfghjklñ', 'zxcvbnm_.-', '!@#$%&*?+='];
  function keyboard(title, value, { mask = false, max = 64, back } = {}, done) {
    let row = 1, col = 0, upper = false, txt = String(value || '');
    const keys = () => KB_ROWS.map(r => [...r].map(c => (upper ? c.toUpperCase() : c))).concat([['⇧', '⌫', 'OK']]);
    open({
      key: () => row + '|' + col + '|' + upper + '|' + txt + '|' + showPass,
      draw() {
        const BW2 = 520, X = (W - BW2) / 2, Y = 70;
        dim(); box(X, Y, BW2, 380);
        text(T(title), X + 18, Y + 16, 19.5, '#fff', 'left', true);
        rr(X + 18, Y + 50, BW2 - 36, 34, 7); ctx.fillStyle = '#0f1f4a'; ctx.fill(); ctx.strokeStyle = C.edgeIn; ctx.lineWidth = 2; ctx.stroke();
        const shown = mask && !showPass ? '*'.repeat(txt.length) : txt;
        text(shown + '_', X + 30, Y + 59, 15, '#fff');
        text(txt.length + ' / ' + max, X + BW2 - 28, Y + 61, 10, C.muted, 'right');
        const ks = keys();
        ks.forEach((r, ri) => {
          const kw = ri === ks.length - 1 ? 150 : 44, gap = 4, rowW = r.length * (kw + gap) - gap, x0 = X + (BW2 - rowW) / 2;
          r.forEach((k, ci) => {
            const x = x0 + ci * (kw + gap), y = Y + 100 + ri * 42, on = ri === row && ci === col;
            const kind = k === 'OK' ? 'gold' : on ? 'blue' : 'ghost';
            btn(x, y, kw, 34, k === '⇧' ? T(upper ? 'minúsculas' : 'MAYÚSCULAS') : k === '⌫' ? T('Borrar') : k === 'OK' ? T('Aceptar') : k, kind, on, k.length > 1 ? 11 : 14);
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
  // recarga como la web en pokesurvivor.com (net.js) y db.js usa Firebase: misma cuenta, misma partida.
  const Cloud = {
    on: () => { try { return localStorage.getItem('ps5.cloud') === '1'; } catch (e) { return false; } },
    set(v) { try { localStorage.setItem('ps5.cloud', v ? '1' : '0'); } catch (e) { /* nada */ } location.reload(); },
    // La partida de la cuenta de la consola, para juntarla con la online (una vez por cuenta).
    localSave() { try { return JSON.parse(localStorage.getItem('ps.save.entrenador') || 'null'); } catch (e) { return null; } },
    imported: uid => { try { return localStorage.getItem('ps5.imported.' + uid) === '1'; } catch (e) { return true; } },
    markImported(uid) { try { localStorage.setItem('ps5.imported.' + uid, '1'); } catch (e) { /* nada */ } },
  };

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
      key: () => tab + '|' + sel + '|' + name + '|' + pass.length + '|' + busy + '|' + msg + '|' + showPass,
      draw() {
        const BW2 = 420, X = (W - BW2) / 2, Y = 40, BH2 = H - 80;
        dim(); box(X, Y, BW2, BH2);
        text('PokéSurvivor Classic', W / 2 + 2, Y + 18 + 2, 30, C.navy, 'center', true, null);
        text('PokéSurvivor Classic', W / 2, Y + 18, 30, C.gold, 'center', true, null);
        text(T('La misma cuenta y la misma partida que en pokesurvivor.com'), W / 2, Y + 58, 10, C.muted, 'center');
        ['Entrar', 'Crear cuenta'].forEach((t, i) => {
          const x = X + 18 + i * ((BW2 - 40) / 2 + 4), w = (BW2 - 40) / 2;
          rr(x, Y + 80, w, 28, 7); ctx.fillStyle = i === tab ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.2)'; ctx.fill();
          ctx.strokeStyle = i === tab ? C.edge : 'transparent'; ctx.lineWidth = 1.5; ctx.stroke();
          text(T(t), x + w / 2, Y + 87, 12, '#fff', 'center', true);
        });
        padIcon('l1', X + 8, Y + 94); padIcon('r1', X + BW2 - 8, Y + 94);
        const field = (i, label, val, y) => {
          text(T(label), X + 18, y, 10, C.muted);
          rr(X + 18, y + 14, BW2 - 36, 30, 7); ctx.fillStyle = '#0f1f4a'; ctx.fill();
          ctx.strokeStyle = sel === i ? C.gold : C.edgeIn; ctx.lineWidth = sel === i ? 2.5 : 2; ctx.stroke();
          text(val, X + 28, y + 22, 13, '#fff');
        };
        field(0, 'Nombre', name, Y + 120);
        field(1, 'Contraseña', showPass ? pass : '*'.repeat(pass.length), Y + 170);
        text(msg, W / 2, Y + 222, 10.5, busy ? C.muted : '#ffb0b8', 'center');
        btn(X + 18, Y + 244, BW2 - 36, 32, T(tab ? 'Crear cuenta' : 'Entrar'), busy ? 'off' : 'gold', sel === 2, 13);
        btn(X + 18, Y + 290, BW2 - 36, 30, T('Entrar con Google') + ' (QR) · ' + T('Próximamente en PS5'), 'off', sel === 3, 11);
        btn(X + 18, Y + 334, BW2 - 36, 28, T('Usar la cuenta de la consola'), 'ghost', sel === 4, 11);
        if (sel === 4) { rr(X + 15, Y + 331, BW2 - 30, 34, 10); ctx.strokeStyle = C.gold; ctx.lineWidth = 2; ctx.stroke(); }
        text(T('Si guardas en la web (botón Guardar), aquí verás tu progreso.'), W / 2, Y + 378, 9.5, C.muted, 'center');
        hints([['ud', 'Mover'], ['x', 'Elegir'], ['sel', showPass ? 'Ocultar' : 'Mostrar'], ['l1', 'Entrar / Crear cuenta']]);
      },
      input(ev) {
        if (busy) return;
        const b = psPadRaw().buttons;
        if ((b[4] && !this._l) || (b[5] && !this._r)) { tab = 1 - tab; msg = ''; G.Audio.sfx('select'); }
        this._l = b[4]; this._r = b[5];
        if (ev.dy) { sel = (sel + ev.dy + 5) % 5; G.Audio.sfx('select'); }
        if (ev.sel) { showPass = !showPass; G.Audio.sfx('select'); }
        if (!ev.a && !ev.start) return;
        const r = rows()[sel];
        if (ev.start || r === 'go') submit();
        else if (r === 'name') { close(); keyboard('Nombre', name, { max: 16 }, v => { if (v != null) name = v.trim(); reopen(); }); }
        else if (r === 'pass') { close(); keyboard('Contraseña', pass, { mask: true, max: 64 }, v => { if (v != null) pass = v; reopen(); }); }
        else if (r === 'google') G.Audio.sfx('error');
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
        btn(x + 20, y + 150, 200, 32, T('Sí, juntarlas'), 'gold', sel === 0, 12);
        btn(x + 240, y + 150, 200, 32, T('No, gracias'), 'blue', sel === 1, 12);
        hints([['lr', 'Mover'], ['x', 'Elegir']]);
      },
      input(ev) {
        if (ev.dx) { sel = 1 - sel; G.Audio.sfx('select'); }
        if (!ev.a) return;
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
        text(nick || T('3-16 letras, números o _'), x + 30, y + 104, 13, nick ? '#fff' : C.muted);
        text(msg, W / 2, y + 134, 10.5, busy ? C.muted : '#ffb0b8', 'center');
        btn(x + 20, y + 156, 400, 30, T('Guardar apodo'), busy ? 'off' : 'gold', sel === 1, 12);
        btn(x + 20, y + 200, 400, 26, T('Ahora no'), 'ghost', sel === 2, 11);
        if (sel === 2) { rr(x + 17, y + 197, 406, 32, 10); ctx.strokeStyle = C.gold; ctx.lineWidth = 2; ctx.stroke(); }
        hints([['ud', 'Mover'], ['x', 'Elegir']]);
      },
      input(ev) {
        if (busy) return;
        if (ev.dy) { sel = (sel + ev.dy + 3) % 3; G.Audio.sfx('select'); }
        if (!ev.a) return;
        if (sel === 0) { close(); keyboard('Elige tu apodo', nick, { max: 16 }, v => { if (v != null) nick = v.trim(); open(me); }); }
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
  function rankScreen() {
    if (!needOnline()) return;
    if (!G.Social.started) G.Social.start();
    const fmtT = t => (t >= 3600 ? Math.floor(t / 3600) + ':' + G.U.mmss(t % 3600).padStart(5, '0') : G.U.mmss(t));
    const num = n => (n || 0).toLocaleString('es-ES');
    let rows = null, dmg = null, me = null, err = '', token = 0, col = 1, sel = 0, scroll = [0, 0], ver = 0;
    const load = async () => {
      const my = ++token;
      rows = dmg = me = null; err = ''; sel = 0; scroll = [0, 0]; ver++;
      try {
        const r = await Promise.all([G.Ranking.top(rkMode, rkPeriod, null, rkScope === 'friends'),
          G.Social.me ? G.Ranking.myRank(rkMode, rkPeriod, null) : Promise.resolve(null),
          G.Ranking.topDmg(rkMode, rkPeriod, rkScope === 'friends')]);
        if (my !== token) return;
        [rows, me, dmg] = r;
      } catch (e) { if (my === token) err = T('No se pudo cargar el ranking') + ' (' + (e.code || e.message) + ').'; }
      ver++;
    };
    load();
    const lists = () => [dmg ? dmg.rows : [], rows || []];
    const L = BX + 18, CW2 = (BW - 46) / 2, RH = 34, TOP = BY + 104, VIS = 9;
    open({
      key: () => [rkMode, rkPeriod, rkScope, col, sel, scroll.join(','), ver].join('|'),
      draw() {
        modal('Ranking');
        // Solo / Grupo
        [['s', 'Solo', 'user'], ['g', 'Grupo', 'friends']].forEach(([k, t, ic], i) => {
          const x = L + 28 + i * 110, on = k === rkMode;
          rr(x, BY + 46, 104, 24, 7); ctx.fillStyle = on ? 'rgba(255,210,63,0.15)' : 'rgba(0,0,0,0.25)'; ctx.fill();
          ctx.strokeStyle = on ? C.gold : 'rgba(244,248,255,0.22)'; ctx.lineWidth = 1.5; ctx.stroke();
          icon(ic, x + 10, BY + 50, 14); text(T(t), x + 30, BY + 52, 11, on ? C.gold : '#fff', 'left', true);
        });
        padIcon('l1', L + 12, BY + 58); padIcon('r1', L + 28 + 2 * 110 + 8, BY + 58);
        // Periodo (□) y alcance (△)
        let cx = L + 290;
        padIcon('s', cx, BY + 58, 7); cx += 12;
        for (const [k, t] of G.Ranking.PERIODS) cx += chip(cx, BY + 48, T(t), k === rkPeriod) + 4;
        cx += 8; padIcon('t', cx, BY + 58, 7); cx += 12;
        for (const [k, t] of [['all', 'Todos'], ['friends', 'Sólo amigos']]) cx += chip(cx, BY + 48, T(t), k === rkScope) + 4;
        // Las dos columnas
        const L2 = lists();
        ['Daño a Arceus', 'Tiempo aguantado'].forEach((h, c) => {
          const x = L + c * (CW2 + 10);
          text(T(h), x, BY + 80, 13.5, c === col ? C.gold : '#fff', 'left', true);
          panel(x, TOP - 4, CW2, VIS * RH + 6);
          if (err) { if (c === 0) wrap(err, CW2 * 2, 10).forEach((l, i) => text(l, x + 10, TOP + 6 + i * 13, 10, '#ffb0b8')); return; }
          if (!rows) { text(T('Cargando…'), x + 10, TOP + 6, 10, C.muted); return; }
          const list = L2[c];
          if (!list.length) wrap(T(c ? 'Todavía no hay marcas aquí. ¡Sé el primero!' : 'Todavía nadie le ha hecho daño a Arceus aquí. ¡Llega al minuto 30 y pégale!'), CW2 - 20, 10)
            .forEach((l, i) => text(l, x + 10, TOP + 6 + i * 13, 10, C.muted));
          for (let i = scroll[c]; i < Math.min(list.length, scroll[c] + VIS); i++) {
            const r = list[i], y = TOP + (i - scroll[c]) * RH, on = c === col && i === sel, mine = r.uids.includes(G.Social.uid);
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
        if ((b[4] && !this._l) || (b[5] && !this._r)) { rkMode = rkMode === 's' ? 'g' : 's'; G.Audio.sfx('select'); load(); }
        this._l = b[4]; this._r = b[5];
        if (ev.x) { const ps2 = G.Ranking.PERIODS.map(p => p[0]); rkPeriod = ps2[(ps2.indexOf(rkPeriod) + 1) % ps2.length]; G.Audio.sfx('select'); load(); }
        if (ev.y) { rkScope = rkScope === 'all' ? 'friends' : 'all'; G.Audio.sfx('select'); load(); }
        if (ev.dx) { col = 1 - col; sel = Math.min(sel, Math.max(0, lists()[col].length - 1)); G.Audio.sfx('select'); }
        if (ev.dy) {
          const n = lists()[col].length;
          if (n) { sel = Math.max(0, Math.min(n - 1, sel + ev.dy)); if (sel < scroll[col]) scroll[col] = sel; else if (sel >= scroll[col] + VIS) scroll[col] = sel - VIS + 1; G.Audio.sfx('select'); }
        }
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
      G.Social.on(onChange);
      G.Social.ensureFriends().then(onChange);
      const me = { social: true,
        key: () => [sel, act, msg, ver, G.Social.friends.length, socVer, !!G.Social.room].join('|'),
        draw() {
          modal('Multijugador');
          spans([[T('Tu apodo') + ': ', C.muted], [G.Social.me ? G.Social.me.name : '', C.gold, true], [' · ' + T('dáselo a tus amigos para que te añadan.'), C.muted]], BX + 18, BY + 48, 10.5);
          btn(BX + 18, BY + 68, 200, 28, T('Añadir amigo'), 'gold', sel === 0 && act === 0, 12);
          // Al lado: volver a la sala online (como #fr-room de la web) o, sin ella, crear la sala local (los mandos de esta PS5).
          const mx = BX + 232 + 168;
          btn(BX + 232, BY + 68, 156, 28, T(G.Social.room ? 'Ir a la sala' : 'Crear sala'), 'blue', sel === 0 && act === 1, 12);
          if (sel === 0 && act === 1) { rr(BX + 229, BY + 65, 162, 34, 10); ctx.strokeStyle = C.gold; ctx.lineWidth = 2; ctx.stroke(); }
          text(msg, mx, BY + 76, 10.5, bad ? '#ffb0b8' : C.muted);
          const fl = list();
          if (!fl.length) text(T('Aún no tienes amigos añadidos. Pulsa Añadir amigo y escribe su apodo.'), BX + 18, BY + 112, 10.5, C.muted);
          fl.slice(0, 9).forEach((f, i) => {
            const y = BY + 108 + i * 38, on = sel === i + 1;
            rr(BX + 18, y, BW - 36, 32, 7); ctx.fillStyle = on ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.2)'; ctx.fill();
            ctx.beginPath(); ctx.arc(BX + 32, y + 16, 4, 0, 6.2832); ctx.fillStyle = f.status === 'ok' ? '#5fe08a' : C.gold; ctx.fill();
            text(f.name, BX + 44, y + 9, 12, '#fff', 'left', true);
            text(T(f.status === 'in' ? 'Quiere ser tu amigo' : f.status === 'out' ? 'Solicitud enviada' : inRoom(f) ? 'En tu sala' : ''), BX + 220, y + 10, 10, C.muted);
            let bx = BX + BW - 26;
            actions(f).slice().reverse().forEach(([t, kind], k, arr) => {
              const idx = arr.length - 1 - k; font(10, true); const w = ctx.measureText(T(t)).width + 26; bx -= w;
              btn(bx, y + 5, w, 22, T(t), kind, on && act === idx, 10);
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
          if (ev.dx && sel === 0) { act = 1 - act; G.Audio.sfx('select'); }
          if (ev.a) {
            if (sel === 0 && act === 1) { G.Social.off(onChange); G.Audio.sfx('select'); close(); if (G.Social.room) lobbyScreen(); else localLobbyScreen(); }
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
      const md = mode(m);
      return md === 'direct' ? 'Conectado' : md === 'failed' ? 'No se pudo conectar (reintentando…)' : 'Conectando…';
    };
    const CW = (BW - 36 - 30) / 4, CY = BY + 70, CH = 150;
    const start = () => {
      const r = room();
      const cfg = { k: 'start', seed: Math.floor(Math.random() * 1e6), host: r.host,
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
          text(T(t), x + CW / 2, CY + 128, 9, t === 'Conectando…' ? C.gold : '#5fe08a', 'center');
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
            btn(BX + BW - 104, y + 3, 80, 20, T('Invitar'), 'gold', on, 10);
            y += 30;
          }
        });
        const by = BY + BH - 78, bi = k => it.findIndex(x => x[0] === k);
        if (r.isHost) btn(BX + 18, by, BW - 36 - 280, 32, G.I18n.f('Empezar partida ({x})', ms.length + '/' + G.Social.MAX_PLAYERS), canStart() ? 'gold' : 'ghost', sel === bi('start'), 13);
        btn(BX + BW - 270, by, 120, 32, T('Menú'), 'ghost', sel === bi('menu'), 12);
        btn(BX + BW - 142, by, 124, 32, T('Salir de la sala'), 'ghost', sel === bi('leave'), 12);
        for (const k of ['menu', 'leave']) if (sel === bi(k)) { const x = k === 'menu' ? BX + BW - 270 : BX + BW - 142, w = k === 'menu' ? 120 : 124; rr(x - 3, by - 3, w + 6, 38, 10); ctx.strokeStyle = C.gold; ctx.lineWidth = 2; ctx.stroke(); }
        const note = !r.isHost ? 'Cuando el anfitrión empiece, entraréis todos a la vez.'
          : ms.length < 2 ? 'Necesitas al menos un amigo en la sala.'
          : failed() ? 'No se puede conectar con algún amigo: su red (o la tuya) no deja jugar en grupo. Probad con otra wifi o datos móviles; se reintenta solo.'
          : connecting() ? 'Conectando con tus amigos…' : 'La partida empieza para todos a la vez.';
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
        else if (k === 'start') { if (canStart()) { G.Audio.sfx('confirm'); start(); } else G.Audio.sfx('error'); }
        else if (k === 'menu') { G.Audio.sfx('back'); close(); mainMenu(); }
        else if (k === 'leave') { G.Audio.sfx('back'); close(); G.Social.leaveRoom().then(() => G.Net.close()); mainMenu(); }
      },
    };
    preIdle(room().members.map(m => m.dex));
    open(me);
  }

  // Texto centrado en cx con iconos del mando: [X] [O] [T] [S] [LR] [UD] (como las pistas de abajo).
  function withIcons(str, cx, y, px, color) {
    const parts = String(str).split(/\[(X|O|T|S|LR|UD|L1|R1)\]/), r = px * 0.75, wOf = (p, i) => {
      if (i % 2) return padIcon(p.toLowerCase(), 0, -100, r);   // (sólo para medir: fuera de la pantalla)
      font(px); return ctx.measureText(p).width;
    };
    let x = cx - parts.reduce((a, p, i) => a + wOf(p, i), 0) / 2;
    parts.forEach((p, i) => {
      const w = wOf(p, i);
      if (i % 2) padIcon(p.toLowerCase(), x + w / 2, y + px / 2, r); else if (p) text(p, x, y, px, color);
      x += w;
    });
  }
  // Sala local (cooperativo local, localcoop.js), a pantalla completa: una carta por mando de esta PS5. Cada uno elige con
  // su mando (en su copia; la sala la pinta el 1 con lo que le cuenta cada uno): ←→ de uno en uno, L1/R1 de diez en diez,
  // ↑↓ todos / favoritos, △ shiny, □ su Pokédex dentro de su carta (3 x 5). El 1 igual, y además ✕ empieza, ○ vuelve.
  const RX = 20, RGAP = 12, RCW = (W - 2 * RX - 3 * RGAP) / 4, RCY = 62, RCH = H - RCY - 64;
  // Lo de cada uno en la sala (el 1 lo hace en la suya; los demás, en su copia): true si lo usó.
  function lobbyKeys(ev, self) {
    const b = psPadRaw().buttons, sh = b[4] && !self._l ? -1 : b[5] && !self._r ? 1 : 0;
    self._l = b[4]; self._r = b[5];
    const ok = r => { G.Audio.sfx(r ? 'select' : 'error'); return true; };
    if (psLocal.dexOn()) {
      if (ev.b) { psLocal.dexClose(); G.Audio.sfx('back'); return true; }
      if (ev.a) { if (psLocal.dexPick()) G.Audio.sfx('confirm'); return true; }
      if (ev.dx) return ok(psLocal.dexMove(ev.dx));
      if (ev.dy) return ok(psLocal.dexMove(ev.dy * 3));
      if (sh) return ok(psLocal.dexMove(sh * 15));
      if (ev.y) return ok(psLocal.dexType());
      return false;
    }
    if (ev.dx || sh) return ok(psLocal.cycle(ev.dx || sh * 10));
    if (ev.dy) return ok(psLocal.filter());
    if (ev.y) return ok(psLocal.shiny());
    if (ev.x) return ok(psLocal.dexOpen());
    return false;
  }
  function lobbyCard(m, i, now, live) {
    const x = RX + i * (RCW + RGAP), y = RCY, cx = x + RCW / 2, col = G.Coop.COLORS[i];
    if (!live) {
      rr(x, y, RCW, RCH, 12); ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.fill();
      ctx.strokeStyle = m ? col : 'rgba(244,248,255,0.18)'; ctx.lineWidth = m ? 3 : 1.5; ctx.stroke();
      if (!m) { withIcons(T('Pulsa [X] para entrar'), cx, y + RCH / 2 - 8, 13, C.muted); return; }
      text('P' + (i + 1) + ' · ' + m.name, cx, y + 14, 14, col, 'center', true);
    }
    if (!m) return;
    const d = m.dx;
    if (d) {   // su Pokédex: 3 x 5 de los suyos, por número; el elegido con su nombre debajo
      const gx = x + 10, gy = y + 60, cw = (RCW - 20) / 3, ch = 50;
      if (!live) {
        text(T('Pokédex') + ' · ' + (d.type ? T(G.U.TYPE_NAME[d.type] || d.type) : T('Todos')) + ' · ' + d.page + '/' + d.pages, cx, y + 38, 11, C.muted, 'center');
        d.cells.forEach((dx, k) => {
          const qx = gx + (k % 3) * cw, qy = gy + Math.floor(k / 3) * ch;
          rr(qx + 2, qy + 2, cw - 4, ch - 4, 6); ctx.fillStyle = k === d.sel ? 'rgba(255,210,63,0.18)' : 'rgba(0,0,0,0.22)'; ctx.fill();
          if (k === d.sel) { ctx.strokeStyle = C.gold; ctx.lineWidth = 2; ctx.stroke(); }
        });
        const sd = d.cells[d.sel];
        if (sd) text('#' + String(sd).padStart(3, '0') + ' ' + nameOf(sd), cx, gy + 5 * ch + 6, 12, '#fff', 'center', true);
        ['[X] ' + T('Elegir'), '[O] ' + T('Volver'), '[T] ' + T('Tipo'), '[L1] [R1] ' + T('Página')].forEach((k, j) =>
          withIcons(k, x + (j % 2 ? RCW * 0.74 : RCW * 0.28), gy + 5 * ch + 30 + Math.floor(j / 2) * 22, 11, C.muted));
        return;
      }
      if (thumbs.done) d.cells.forEach((dx, k) => thumbIn(dx, gx + (k % 3) * cw + 2, gy + Math.floor(k / 3) * ch + 2, cw - 4, ch - 4, 1.4));
      else { thumbsLayout(); thumbsPump(); d.cells.forEach((dx, k) => monIn(dx, gx + (k % 3) * cw + 2, gy + Math.floor(k / 3) * ch + 2, cw - 4, ch - 4, 1, now)); }
      return;
    }
    if (live) {   // su Pokémon, grande; los de al lado del carrusel, pequeños (así ya están cargados al llegar)
      monIn(m.dex, x + 10, y + 40, RCW - 20, 150, 3, now, { shiny: !!m.shiny });
      if (m.near && m.near.length === 2) { ctx.globalAlpha = 0.45; monIn(m.near[0], x + 4, y + 90, 44, 60, 1.5, now); monIn(m.near[1], x + RCW - 48, y + 90, 44, 60, 1.5, now); ctx.globalAlpha = 1; }
      return;
    }
    text(nameOf(m.dex) + (m.shiny ? ' ★' : ''), cx, y + 200, 14, m.shiny ? C.gold : '#fff', 'center', true);
    if (m.n > 1) text('‹ ' + (m.i + 1) + ' / ' + m.n + ' ›' + (m.f ? ' · ' + T(m.f === 'all' ? 'Todos' : 'Favoritos') : ''), cx, y + 222, 11, C.muted, 'center');
    const keys = m.dexOk ? ['[LR] ' + T('cambiar'), '[L1] [R1] ×10', '[UD] ' + T('filtro'), '[T] shiny', '[S] Pokédex', i ? '[O] ' + T('salir') : '']
      : ['[LR] ' + T('cambiar'), '[O] ' + T('salir')];
    keys.forEach((k, j) => k && withIcons(k, x + (j % 2 ? RCW * 0.74 : RCW * 0.28), y + 256 + Math.floor(j / 2) * 26, 11.5, C.muted));
    if (!i) text(T('Anfitrión'), cx, y + RCH - 22, 11, '#5fe08a', 'center', true);
  }
  function localLobbyScreen() {
    if (!globalThis.psLocal) return mainMenu();
    const pl = () => psLocal.players(), at = i => pl().find(p => p.idx === i);
    open({
      key: () => pl().map(p => JSON.stringify([p.uid, p.dex, p.shiny, p.i, p.n, p.f, p.dexOk, p.dx])).join(),
      draw(now) {
        dim();
        text(T('Sala'), RX, 18, 20, '#fff', 'left', true);
        text(T('Hasta 4 jugadores: enciende otro mando y elige su usuario. Cada uno entra, cambia de Pokémon o sale con su mando.'), RX + 70, 24, 10.5, C.muted);
        for (let i = 0; i < 4; i++) lobbyCard(at(i), i, now, false);
        const n = pl().length;
        text(T(n > 1 ? 'La partida empieza para todos a la vez.' : 'Esperando a otro mando…'), RX, H - 46, 11, C.muted);
        hints(psLocal.dexOn() ? [['x', 'Elegir'], ['o', 'Volver']] : [['x', G.I18n.f('Empezar partida ({x})', n + '/4')], ['o', 'Volver']]);
      },
      live(now) { for (let i = 0; i < 4; i++) lobbyCard(at(i), i, now, true); },
      input(ev) {
        if (lobbyKeys(ev, this)) return;
        if (ev.b) { G.Audio.sfx('back'); close(); mainMenu(); return; }
        if (ev.a) { if (psLocal.ready()) { G.Audio.sfx('confirm'); close(); psLocal.start(); } else G.Audio.sfx('error'); }
      },
    });
  }
  // Jugadores 2-4: su copia no se ve en los menús (sólo la del 1); aquí sólo escuchan su mando para cambiar de Pokémon.
  // Mientras, su juego duerme (browser.js): con 4 jugadores, tres menús animados por detrás que nadie ve costaban de más.
  globalThis.psDormant = () => !!(top && top.guest);
  globalThis.psTopInfo = () => (top ? (top.id || (top.guest ? 'sala' : 'sin id')) : 'ninguna') + (winOn ? ' (en su ventana)' : '') + (booting ? ', cargando' : '') + (waitText ? ', «' + waitText + '»' : '');   // (diagnóstico, localcoop.js)
  function guestScreen() {
    if (G.Game.state !== 'ui') { const t = ps.now(); G.Game.toUI(); console.log('[menu] salir de la partida (toUI): ' + Math.round(ps.now() - t) + ' ms'); }
    G.UI.hideAll();
    // Lo mismo que el 1 en su carta (lobbyKeys): la sala la pinta el 1 con lo que cuenta esta copia.
    open({ guest: true,
      key: () => String(psLocal && psLocal.myDex()),
      draw() { text('P' + (ps.PLAYER + 1) + ' · ' + nameOf(psLocal && psLocal.myDex()), W / 2, H / 2, 16, '#fff', 'center', true); },
      input(ev) {
        if (!globalThis.psLocal) return;
        if (!psLocal.dexOn()) {
          if (ev.b) { if (psLocal.leave()) G.Audio.sfx('back'); return; }
          if (ev.a) { if (psLocal.join()) G.Audio.sfx('confirm'); return; }
        }
        if (psLocal.joined()) lobbyKeys(ev, this);
      },
    });
  }

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
        btn(x + 14, y + 44, 160, 26, T('Unirme'), 'gold', sel === 0, 11);
        btn(x + 182, y + 44, w - 196, 26, T('No, gracias'), 'ghost', sel === 1, 11);
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
    if (G.Game.state !== 'ui' || !G.Social.room) return;
    if (top) close();
    G.UI.hideAll();
    return startCoop.call(this, cfg);
  };

  // ---------------- modo dev (sólo PS5) ----------------
  // Para probar: todos los Pokémon, todas las mejoras al máximo y el contador de FPS. Al encenderlo se guarda
  // una copia de toda la partida y al apagarlo vuelve tal cual (lo que pase mientras, se pierde).
  const Dev = (() => {
    const KEY = 'ps5.dev', BACKUP = 'ps5.dev.backup';
    const get = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
    const on = () => PS5_DEV && get(KEY) === '1';   // (rama ps5: nunca)
    let maxed = null;
    const upgradesOf = G.DB.upgradesOf, offer = G.LevelUp.offer;
    G.LevelUp.offer = (pl, n) => offer(pl, on() ? 999 : n);   // modo dev: todas las cartas posibles
    G.DB.upgradesOf = dex => {
      if (!on()) return upgradesOf(dex);
      return maxed || (maxed = Object.fromEntries(G.Upgrades.LIST.map(u => [u.id, u.max])));
    };
    // El movimiento inicial (y el segundo) que eliges con esas mejoras: el juego sólo lo respeta si la mejora está comprada de
    // verdad (save.pupg); con el modo dev, como si lo estuviera. Sin esto, en Mejoras se elegía y la partida empezaba con el de serie.
    globalThis.psDevOn = on;   // net.js: con el modo dev, la partida no sale a la nube
    const startOf = G.startMoveOf, start2Of = G.startMove2Of;
    G.startMoveOf = dex => { const sv = G.DB.save, id = on() && sv && sv.pstart && sv.pstart[dex]; return id && G.startChoices(dex).includes(id) ? id : startOf(dex); };
    G.startMove2Of = dex => { const sv = G.DB.save, id = on() && sv && sv.pstart2 && sv.pstart2[dex];
      return id && id !== G.startMoveOf(dex) && G.startChoices(dex).includes(id) ? id : start2Of(dex); };
    function set(v) {
      const s = G.DB.save;
      if (!s || v === on()) return;
      try {
        if (v) {
          localStorage.setItem(BACKUP, JSON.stringify(s));
          // Todos los Pokémon y sus shiny (los que tienen sprite shiny), y monedas y tickets de sobra.
          s.shiny = s.shiny || {};
          for (const p of G.DEX) {
            const m = G.SPRITE_META[p.dex];
            if (!m) continue;
            if (!s.owned[p.dex]) s.owned[p.dex] = { at: Date.now(), from: 'dev' };
            if (m.sh && !s.shiny[p.dex]) s.shiny[p.dex] = { at: Date.now(), from: 'dev' };
          }
          s.coins = 9999999;
          s.tickets = Object.assign(s.tickets || {}, { t1: 9999, t10: 9999 });
          localStorage.setItem(KEY, '1');
        } else {
          const b = get(BACKUP);
          if (b) { const old = JSON.parse(b); for (const k of Object.keys(s)) delete s[k]; Object.assign(s, old); }
          localStorage.removeItem(BACKUP);
          localStorage.setItem(KEY, '0');
        }
      } catch (e) { console.error('[dev] ' + e.message); return; }
      G.DB.commit(true);
    }
    // Modo estrés (sólo con el modo dev, en solitario): para medir el final de la partida sin jugar 30 min. Empiezas
    // con tus Atajos (o el movimiento inicial) al nivel máximo y unidos en un vínculo, no pierdes vida, y los
    // enemigos salen como si el reloj fuera ×STRESS_SPEED (tramos, ritmo y jefes del minuto 15 a los ~2 min).
    const STRESS = 'ps5.stress', STRESS_SPEED = 8;
    const stress = () => on() && get(STRESS) === '1';
    let stressRun = false;
    const startRun = G.Game.startRun;
    G.Game.startRun = function (coop) {
      const r = startRun.apply(this, arguments);
      stressRun = !coop && stress();
      const pl = G.Game.player, s = G.DB.save;
      if (stressRun && pl) {
        const dex = pl.mon ? pl.mon.dex : s.partner;
        let ids = ((s.pbind && s.pbind[dex]) || []).filter(Boolean);
        if (!ids.length) ids = [G.startMoveOf(dex)];
        pl.moves = []; pl.slots = []; pl.active = 0;   // sólo los Atajos (los de las mejoras no caben con 4)
        for (const id of ids) pl.addMove(id);
        for (const m of pl.moves) while (G.Moves.levelUp(m)) { /* hasta el máximo */ }
        const loose = pl.slots.filter(g => g.length === 1).map(g => g[0]).slice(0, G.Player.BOND_MAX || 4);
        if (loose.length >= 2) { pl.bonds = 1; pl.fuse(loose); }
        pl.hurt = () => {};
        console.log('[dev] modo estrés: ' + pl.moves.map(m => m.id + ' Nv.' + m.lvl).join(', '));
      }
      return r;
    };
    const spawnerUpdate = G.Spawner.update;
    G.Spawner.update = function (dt, who, t) {
      if (!stressRun) return spawnerUpdate.call(this, dt, who, t);
      const r = spawnerUpdate.call(this, dt, who, t * STRESS_SPEED);
      // Y siempre el máximo de enemigos que admite el juego (CAP + 10 con burst), del tramo del reloj ×8.
      const need = G.Spawner.CAP + 10 - G.EnemyMgr.count;
      if (need > 0 && !G.Rift.inArena && !G.Judgment.active) {
        const st = G.Game.st;
        G.Game.st = { time: t * STRESS_SPEED };   // burst() mira G.Game.st.time para elegir qué sale
        try { G.Spawner.burst(need); } finally { G.Game.st = st; }
      }
      return r;
    };
    function setStress(v) { try { localStorage.setItem(STRESS, v ? '1' : '0'); } catch (e) { /* nada */ } }

    // Partidas con todo al máximo: sin marcas en el ranking (las vería todo el mundo).
    for (const k of ['submitSolo', 'submitGroup']) {
      const orig = G.Ranking[k];
      G.Ranking[k] = (...a) => (on() ? (console.log('[dev] sin marca en el ranking'), null) : orig.apply(G.Ranking, a));
    }
    return { on, set, stress, setStress };
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
    let hwPick = (() => { try { return localStorage.getItem('ps5.halloween') || ''; } catch (e) { return ''; } })();
    const TABS = [
      ['Sonido', () => [
        { kind: 'slider', label: 'Música', get: () => A.settings.music, set: v => A.setVolume('music', v) },
        { kind: 'slider', label: 'Efectos', get: () => A.settings.sfx, set: v => { A.setVolume('sfx', v); A.sfx('click'); } },
        { kind: 'toggle', label: 'Silenciar todo', get: () => !!A.settings.muted, set: () => A.toggleMute() },
        // Cooperativo local (localcoop.js → ps.au_route): con varios jugadores, por dónde suena.
        { kind: 'choice', label: 'Sonido con varios jugadores', desc: T('Mandos: cada uno oye su partida por el altavoz de su mando. Tele: sólo la del jugador 1.'),
          opts: [['pads', T('Mandos')], ['tv', T('Tele')]],
          get: () => { try { return localStorage.getItem('ps5.mpAudio') || 'pads'; } catch (e) { return 'pads'; } },
          set: v => { try { localStorage.setItem('ps5.mpAudio', v); } catch (e) { /* nada */ } } },
      ]],
      ['Gráficos', () => [
        // ←→ elige, ✕ aplica: el juego vuelve a empezar en ese idioma (location.reload, main.c). Los nombres en
        // chino, en letras latinas: la fuente no tiene sus caracteres.
        { kind: 'choice', label: 'Idioma', desc: langPick !== G.I18n.lang ? T('Pulsa ✕ para cambiar: el juego se reinicia.') : '',
          opts: G.I18n.choices.map(([v, l]) => [v, { 'zh-Hans': 'Zhongwen (jianti)', 'zh-Hant': 'Zhongwen (fanti)' }[v] || l]),
          get: () => langPick, set: v => { langPick = v; }, apply: () => {
            if (langPick === G.I18n.lang) return;
            try { localStorage.setItem('ps.lang', langPick); } catch (e) { /* nada */ }
            location.reload();
            G.UI.toast(T('Se aplica al volver a abrir el juego.'), 4000);   // sólo se ve si no se pudo reiniciar
          } },
        choice('quality', 'Calidad', 'Cuántos efectos y partículas se dibujan.', [['auto', 'Auto'], ['high', 'Alta'], ['mid', 'Media'], ['low', 'Baja']]),
        toggle('dmgNumbers', 'Números de daño', 'Los números que salen al golpear y al recibir daño.'),
        toggle('calm', 'Menos sacudidas y destellos', 'La cámara tiembla menos y los fogonazos son suaves.'),
      ]],
      ['Controles', () => [
        toggle('padRumble', 'Vibración', 'El mando vibra al recibir daño (si el mando y el navegador lo permiten).'),
        info('Stick izq. / Cruceta', 'moverse · elegir en los menús'),
        info('L1 / R1', 'ataque anterior / siguiente'),
        info('□ / △', T('usar') + ' / ' + T('cambiar') + ' · ' + T('Tus esferas')),
        info('OPTIONS', 'pausa'),
        info('✕ / ○', T('Elegir') + ' / ' + T('Volver')),
      ]],
      ['Accesibilidad', () => [
        toggle('aimManual', 'Apuntar a mano', 'Tus ataques van hacia donde empujes el stick derecho del mando en vez de al enemigo más cercano.'),
      ]],
      ['Cuenta', () => {
        const btnRow = (label, go, stay) => ({ kind: 'button', label, go, stay });
        if (G.DB.mode === 'cloud' && !G.DB.guest) return [
          info(T('Cuenta') + ': ' + (G.DB.user || ''), T({ ok: 'Guardado en la nube', syncing: 'Guardando…', pending: 'Sin guardar en la nube: pulsa Guardar',
            offline: 'Sin conexión: pulsa Guardar cuando vuelva' }[G.DB.syncState] || '')),
          btnRow('Guardar en la nube', () => { cloudSave().then(() => { ver++; }); }, true),
          btnRow('Cerrar sesión', () => { G.DB.logout().then(() => loginScreen()); }),
          btnRow('Usar la cuenta de la consola', () => Cloud.set(false)),
        ];
        if (Cloud.on()) return [   // pedida la nube, pero no arrancó (sin red, sin el SDK...)
          info('Sin conexión con la nube', T('La cuenta online no se pudo abrir') + ' (' + (G.DB.localReason || '?') + ').'),
          btnRow('Reintentar', () => location.reload()),
          btnRow('Usar la cuenta de la consola', () => Cloud.set(false)),
        ];
        return [
          info('Cuenta de la consola', 'Tu partida se guarda sólo en esta PS5.'),
          btnRow('Usar una cuenta online', () => Cloud.set(true)),
          info('', 'La misma cuenta y la misma partida que en pokesurvivor.com. La primera vez puedes juntar tu partida de la consola con la online.'),
        ];
      }],
      ...(PS5_DEV ? [['Desarrollador', () => [
        { kind: 'toggle', label: 'Modo dev', desc: T('Todos los Pokémon, shiny y mejoras, monedas y tickets de sobra, y el contador de FPS. Al apagarlo vuelves a tu partida de antes (con la cuenta online, lo que ya se subió a la nube se queda). Sin marcas en el ranking.'),
          get: Dev.on, set: v => Dev.set(v) },
        { kind: 'toggle', label: 'Modo estrés', desc: T('Con el modo dev, en solitario: empiezas con tus Atajos al nivel máximo y en un vínculo, no pierdes vida, siempre hay el máximo de enemigos y salen como si el reloj fuera 8 veces más rápido. Para probar el final de la partida.'),
          get: () => Dev.on() && Dev.stress(), set: v => { if (!Dev.on() && v) { G.UI.toast(T('Primero enciende el modo dev.')); G.Audio.sfx('error'); return; } Dev.setStress(v); } },
        // Eventos: forzar uno encendido o apagado para probarlo (boot.js); ✕ aplica y el juego se reinicia.
        // ponytail: textos sólo en español (la edición Dev no se publica).
        // Núcleo en C (CORE.md, fase 2): jugadores y enemigos los mueve el C; ✕ en otro mando, otro jugador.
        ...(globalThis.psCore ? [{ kind: 'button', label: 'Núcleo en C (prueba)', go: () => { G.UI.hideAll(); psCore.start(); } },
          { kind: 'toggle', label: 'Jugar con el núcleo', desc: 'Las partidas de Jugar las mueve el núcleo en C (✕ en otro mando: otro jugador en la misma pantalla). El cooperativo online sigue igual.',
            get: () => psCore.always, set: v => psCore.setAlways(v) }] : []),
        info('Eventos', ''),
        { kind: 'choice', label: 'Halloween', desc: T('Forzar el evento (mapa, caramelos, skins, banner). Pulsa ✕ para aplicar: el juego se reinicia.'),
          opts: [['', 'Según la fecha'], ['1', 'Siempre'], ['0', 'Nunca']],
          get: () => hwPick, set: v => { hwPick = v; },
          apply: () => { try { if (hwPick) localStorage.setItem('ps5.halloween', hwPick); else localStorage.removeItem('ps5.halloween'); } catch (e) { return; } location.reload(); } },
      ]]] : []),
      ['Acerca de', () => [
        info('PokéSurvivor Classic', 'Juego de fans gratuito y sin ánimo de lucro: sin anuncios ni compras. Pokémon y sus personajes son propiedad de Nintendo, Creatures y GAME FREAK; este proyecto no está afiliado a ellos.'),
        info('Sprites', 'PMD SpriteCollab y sus artistas (CC BY-NC 4.0).'),
        info('Datos de los Pokémon', 'PokéAPI.'),
        info('Música y sonidos', 'originales, generados por el propio juego.'),
        info('Fuente', 'Pixelify Sans (OFL).'),
        info('PS5', 'QuickJS, PlutoVG y SDL2 · GPL-3.0'),
        { kind: 'button', label: 'Aviso legal y privacidad', go: () => legalScreen(() => settingsScreen(back)) },
      ]],
    ];
    const BW2 = 520, X = (W - BW2) / 2, Y = 48, BH2 = H - Y - 40, RW = BW2 - 36;
    const sh = shoulders();
    let sel = 0, scroll = 0, ver = 0;
    const rows = () => TABS[setTab][1]();
    const rowH = r => 24 + (r.desc ? wrap(T(r.desc), r.kind === 'info' ? RW - 140 : RW - 150, 9).length * 12 : 0);
    open({
      key: () => setTab + '|' + sel + '|' + scroll + '|' + ver,
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
        if (selY < scroll) scroll = selY; else if (selY + selH + PAD * 2 > scroll + vh) scroll = selY + selH + PAD * 2 - vh;
        ctx.save(); rr(X + 3, top, BW2 - 6, vh, 4); ctx.clip();
        y = top + PAD - scroll;
        list.forEach((r, i) => {
          const h = rowH(r), on = i === sel;   // también en las de sólo texto: así se ve que se baja
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
          }
          y += h + 8;
          ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fillRect(X + 18, y - 5, BW2 - 36, 1);
        });
        ctx.restore();
        topbar('gear');
        const cur = list[sel], hh = [['ud', 'Mover']];
        if (cur && cur.kind === 'toggle') hh.push(['x', 'Cambiar']);
        if (cur && cur.kind === 'button') hh.push(['x', 'Abrir']);
        if (cur && (cur.kind === 'slider' || cur.kind === 'choice')) hh.push(['lr', 'Cambiar']);
        if (cur && cur.apply && (cur.label !== 'Idioma' || langPick !== G.I18n.lang)) hh.push(['x', 'Aplicar']);
        hh.push(['o', 'Cerrar']);
        hints(hh);
      },
      input(ev) {
        const g = sh(), list = rows();
        if (g) { setTab = (setTab + g + TABS.length) % TABS.length; sel = 0; scroll = 0; G.Audio.sfx('select'); }
        if (ev.dy) {
          // las filas de sólo texto no se eligen, pero se pasa por ellas para poder leerlas
          sel = Math.max(0, Math.min(list.length - 1, sel + ev.dy)); G.Audio.sfx('select');
        }
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
  const MX = 694, MY = 48, MW = 247, LX = 338;
  const hms = ms => { const t = Math.floor(ms / 1000); return [Math.floor(t / 3600) % 24, Math.floor(t / 60) % 60, t % 60].map(v => String(v).padStart(2, '0')).join(':'); };
  const hwLeft = ms => { const d = Math.floor(ms / 864e5); return d ? G.I18n.f('{x} d {x}', d, hms(ms)) : hms(ms); };
  function hwText() {
    const c = G.Halloween.countdown();
    return G.Halloween.on ? (c && c.on ? G.I18n.f('¡Halloween! Termina en {x}', hwLeft(c.ms)) : T('¡Halloween!'))
      : c && !c.on ? G.I18n.f('Halloween empieza en {x}', hwLeft(c.ms)) : '';
  }   // panel del menú; centro de la columna izquierda
  // La barra de arriba, de izquierda a derecha (como #topbar): Guardar y Salir sólo con la cuenta en la nube (con la
  // de la consola, salir sería volver a entrar en la misma); Apoyar si hay Ko-fi.
  function barList() {
    const cloud = G.DB.mode === 'cloud';
    return [...(G.Funding && G.Funding.url ? ['support'] : []),
      'user', ...(cloud && !G.DB.guest ? ['save'] : []), 'news', 'sound', 'gear', ...(cloud ? ['logout'] : [])];
  }

  // QR centrado en cx, de QS px como mucho: blanco con 4 módulos de margen, como pide el estándar.
  function qrAt(qr, cx, y, QS) {
    const k = Math.floor(QS / (qr.size + 8)), side = k * (qr.size + 8), qx = Math.round(cx - side / 2);
    ctx.fillStyle = '#fff'; ctx.fillRect(qx, y, side, side);
    ctx.fillStyle = '#000';
    for (let my = 0; my < qr.size; my++) for (let mx = 0; mx < qr.size; mx++)
      if (qr.dark(mx, my)) ctx.fillRect(qx + (mx + 4) * k, y + (my + 4) * k, k, k);
  }
  // Apoyar: dos Ko-fi, el del autor del juego y el del port a PS5, cada uno con su QR.
  const KOFI_PS5 = 'https://ko-fi.com/DevVeda';
  function kofiScreen() {
    const cols = [[G.Funding.url, T('Autor original')], [KOFI_PS5, T('Versión de PS5')]].map(([url, who]) => [url, who, globalThis.psQR ? psQR(url) : null]);
    open({
      key: () => 'kofi',
      draw() {
        const [x, y] = centerBox(560, 330, T('Apoyar'));
        wrap(T('PokéSurvivor Classic es gratis, sin anuncios ni compras. Si quieres ayudar a pagar los servidores, puedes donar en Ko-fi (escanéalo con el móvil):'), 520, 11)
          .forEach((l, i) => text(l, W / 2, y + 46 + i * 15, 11, C.muted, 'center'));
        cols.forEach(([url, who, qr], i) => {
          const cx = x + 140 + i * 280;
          text(who, cx, y + 92, 13, C.gold, 'center', true);
          if (qr) qrAt(qr, cx, y + 114, 150);
          text(url.replace(/^https:\/\//, ''), cx, y + 276, 11, '#fff', 'center', true);
        });
        hints([['o', 'Volver']]);
      },
      input(ev) { if (ev.b || ev.a) { G.Audio.sfx('back'); close(); mainMenu(); } },
    });
  }
  // Arriba a la izquierda del menú: Apoyar (Ko-fi), sólo con su icono. Sin el banner de la web (Discord y el último vídeo)
  // ni el botón de YouTube: el dueño los quitó el 05-11.
  function sideCol(focus) {
    const x = 12, y = 10;
    if (G.Funding && G.Funding.url) { btn(x, y, 30, 26, null, 'gold', false); icon('heart', x + 7, y + 5, 16); if (focus === 'support') ring(x, y, 30, 26, 7); }
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
  globalThis.open = url => { const back = top; if (top) close(); linkScreen('Abrir en el móvil', String(url), 'Escanéalo con el móvil o escribe la dirección en el navegador:', back ? () => open(back) : mainMenu); return null; };

  function logoutScreen() {
    let yes = false;
    open({
      key: () => String(yes),
      draw() {
        const [x, y] = centerBox(400, 130, T('¿Cerrar sesión?'));
        text(T('Lo de esta cuenta queda guardado en la nube.'), W / 2, y + 46, 11, C.muted, 'center');
        btn(x + 50, y + 80, 140, 30, T('Salir'), 'blue', yes, 12);
        btn(x + 210, y + 80, 140, 30, T('No'), 'gold', !yes, 12);
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
    if (ps.PLAYER) return guestScreen();   // jugadores 2-4 (cooperativo local): su copia no tiene menú, sólo su plaza
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
    if (ps.PAD !== 'node' && !booting && (fromRun || (globalThis.psPreBusy && psPreBusy()))) { booting = true; bootT0 = 0; bootCalm = 0; }
    if (fromRun) bootCalm = -10;   // (la preparación llega en el fotograma siguiente: que no se quite antes)
    G.UI.hideAll();
    G.Audio.music('village');
    socialOnMenu();
    const s = G.DB.save;
    const shinyOn = () => !!s.partnerShiny && G.DB.ownsShiny(s.partner);
    open({ isMenu: true,
      key: () => sel + '|' + bar + '|' + hwText() + '|' + G.Halloween.on + '|' + G.DB.syncState + '|' + G.Audio.settings.muted + '|' + s.partner + '|' + s.coins + '|' + shinyOn() + '|' + sum(s.bag) + '|' + sum(s.tms) + '|' + s.tickets.t1 + '|' + s.tickets.t10,
      draw() {
        // Columna derecha: degradado oscuro (.menu-right)
        const g = ctx.createLinearGradient(MX - 19, 0, W, 0);
        g.addColorStop(0, 'rgba(5,10,25,0)'); g.addColorStop(0.3, 'rgba(5,10,25,0.65)'); g.addColorStop(1, 'rgba(5,10,25,0.65)');
        ctx.fillStyle = g; ctx.fillRect(MX - 19, 0, W - MX + 19, H);
        // Logo
        text('PokéSurvivor', LX + 4.5, 104.5, 48, C.navy, 'center', true, null);
        text('PokéSurvivor', LX + 2.25, 102.25, 48, '#a55f00', 'center', true, null);
        text('PokéSurvivor', LX, 100, 48, C.gold, 'center', true, null);
        spaced(('Classic · ' + T('Mundo Misterioso')).toUpperCase(), LX, 158, 13, 2.5);
        // Halloween: cuenta atrás bajo el título (hwLine de la web): 14 días antes, cuánto falta; durante, cuánto queda.
        const hw = hwText();
        if (hw) { font(11, true); const hw2 = ctx.measureText(hw).width + 18; icon('pumpkin', LX - hw2 / 2, 175, 14); text(hw, LX - hw2 / 2 + 18, 176, 11, '#ffb347', 'left', true); }
        // Frase de broma torcida en la esquina del título, como las de Minecraft (.splash de la web: la misma de
        // dev.html, amarilla, -14°, hasta 14em de ancho). ponytail: sin el latido de la web, el menú sólo se repinta al cambiar.
        font(48, true);
        const tR = LX + ctx.measureText('PokéSurvivor').width / 2, sl = wrap(T('Folagor, Sekiam, PokeAlex: ¿un hueco?'), 182, 13, true);
        ctx.save(); ctx.translate(tR + 40, 150); ctx.rotate(-14 * Math.PI / 180);
        sl.forEach((l, i) => text(l, 0, (i - sl.length / 2) * 15, 13, '#ffff40', 'center', true, '#3f3f00'));
        ctx.restore();
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
        }
        // Panel del menú
        box(MX, MY, MW, 404);
        let y = MY + 10;
        MENU.forEach(([label, ico, sub, fn], i) => {
          const play = i === 0, h = play ? 44 : 38, on = i === sel && bar < 0;
          if (on) { rr(MX + 8, y, MW - 16, h - 2, 5); ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fill(); icon('cursor', MX + 11, y + h / 2 - 9, 14); }
          icon(ico, MX + 28, y + h / 2 - 10, 20);
          const px = play ? 18 : 13, col = !fn ? '#7f8db0' : play ? C.gold : '#fff';
          text(T(label), MX + 54, y + (play ? 6 : 5), px, col, 'left', true);
          let st = T(sub());
          font(8.5); while (st.length > 4 && ctx.measureText(st).width > MW - 70) st = st.slice(0, -2) + '…';
          text(fn ? st : T('Próximamente en PS5'), MX + 54, y + h - 15, 8.5, C.muted, 'left');
          y += h;
        });
        // Estadísticas (#menu-stats)
        box(MX, 466, MW, 56);
        const st = s.stats, b = v => [String(v), '#fff', true], m = t => [t, C.muted];
        spans([m('Runs '), b(st.runs), m(' · ' + T('Mejor tiempo') + ' '), b(G.U.mmss(st.bestTime))], MX + 14, 480, 10.5);
        spans([m(T('Mejor nivel') + ' '), b(st.bestLevel), m(' · ' + T('Derrotados') + ' '), b(st.totalKills.toLocaleString('es-ES'))], MX + 14, 498, 10.5);
        topbar(barList()[bar]);
        sideCol(barList()[bar]);
        text(T('Proyecto de fan sin ánimo de lucro · Sprites: SpriteCollab (CC BY-NC 4.0) · Pokémon © Nintendo/Creatures/GAME FREAK'), 10, H - 14, 8, 'rgba(185,203,240,0.7)', 'left', false, '#000');
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
            if (BAR[bar] === 'news') { G.Audio.sfx('select'); close(); newsScreen(); }
            else if (BAR[bar] === 'gear') { G.Audio.sfx('select'); close(); settingsScreen(); }
            else if (BAR[bar] === 'user') { G.Audio.sfx('select'); close(); goalsScreen(2); }
            else if (BAR[bar] === 'save') { G.Audio.sfx('select'); cloudSave(); }
            else if (BAR[bar] === 'support') { G.Audio.sfx('select'); close(); kofiScreen(); }
            else if (BAR[bar] === 'sound') { G.Audio.toggleMute(); G.Audio.sfx('select'); }
            else if (BAR[bar] === 'logout') { G.Audio.sfx('select'); close(); logoutScreen(); }
          }
          return;
        }
        if (ev.dy < 0 && sel === 0) { bar = barList().indexOf('news'); G.Audio.sfx('select'); return; }
        if (ev.dy) { sel = (sel + ev.dy + MENU.length) % MENU.length; G.Audio.sfx('select'); }
        // △ o ←→: los botones Normal / Shiny de debajo del compañero.
        if (G.DB.ownsShiny(s.partner) && (ev.y || (ev.dx && shinyOn() !== ev.dx > 0))) {
          s.partnerShiny = ev.y ? !shinyOn() : ev.dx > 0; G.DB.commit(); G.Audio.sfx('confirm');
          preIdle([s.partner], s.partnerShiny);
        }
        if (ev.a && MENU[sel][3]) { G.Audio.sfx(sel ? 'select' : 'confirm'); menuSel = sel; menuBar = -1; const fn = MENU[sel][3]; close(); fn(); }
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
    afterLogin() { if (!G.DB.save.partner && !ps.PLAYER) personalityTest(); else this.goMenu(); },   // (jugadores 2-4: a su plaza)
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
        wrap(T('Firebase no contesta. Puedes reintentarlo o seguir con la cuenta de la consola (tu partida de esta PS5).'), 420, 10.5)
          .forEach((l, i) => text(l, x + 20, y + 52 + i * 14, 10.5, '#fff'));
        btn(x + 20, y + 130, 200, 32, T('Reintentar'), 'blue', sel === 0, 12);
        btn(x + 240, y + 130, 200, 32, T('Usar la cuenta de la consola'), 'gold', sel === 1, 11);
        hints([['lr', 'Mover'], ['x', 'Elegir']]);
      },
      input(ev) {
        if (ev.dx) { sel = 1 - sel; G.Audio.sfx('select'); }
        if (ev.a) { G.Audio.sfx('confirm'); if (sel) Cloud.set(false); else location.reload(); }
      },
    });
  }

  const draw0 = globalThis.psOverlay;
  // FPS arriba a la derecha: la media de cada medio segundo y el fotograma más lento de ese rato (ms).
  let fpsT = 0, fpsN = 0, fpsLast = 0, fpsWorst = 0, fpsTxt = '';
  function fpsCounter(now) {
    if (fpsLast) fpsWorst = Math.max(fpsWorst, now - fpsLast);
    fpsLast = now; fpsN++;
    if (now - fpsT >= 500) { fpsTxt = Math.round(fpsN * 1000 / (now - fpsT)) + ' FPS · ' + Math.round(fpsWorst) + ' ms'; fpsT = now; fpsN = 0; fpsWorst = 0; }
    screen.setTransform(1, 0, 0, 1, 0, 0);
    screen.font = 'bold 12px ' + FONT; screen.textAlign = 'right'; screen.textBaseline = 'top';
    screen.fillStyle = 'rgba(0,0,0,0.55)'; screen.fillRect(W - 112, 14, 110, 18);
    screen.fillStyle = '#9fffa0'; screen.fillText(fpsTxt, W - 6, 17);
  }
  // ---------------- avisos ----------------
  // G.UI.toast (.toast: abajo en el centro) y el aviso de logros de js/systems/progress.js (.ach-pop: arriba),
  // que escribe en el elemento #ach-pop: aquí se lee y se pinta encima de todo.
  let toastMsg = '', toastUntil = 0;
  G.UI.toast = (msg, ms = 2200) => { toastMsg = T(strip(msg)); toastUntil = ps.now() + ms; };
  function notices(now) {
    ctx = screen;
    screen.save(); screen.setTransform(1, 0, 0, 1, 0, 0);
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
    bootCalm = top && !loading() ? bootCalm + 1 : 0;
    // Diagnóstico (la vuelta al menú tras el cooperativo local tardaba mucho): cada segundo, qué la tiene puesta.
    if (now - bootLog >= 1000) {
      bootLog = now;
      const pre = globalThis.psPreBusy && psPreBusy();
      console.log('[carga] ' + ((now - bootT0) / 1000).toFixed(1) + ' s: ' + (!top ? 'sin pantalla · ' : '') + 'red ' + (globalThis.psNetPending ? psNetPending() : 0) +
                  ' · imágenes ' + (globalThis.psImgsPending ? psImgsPending() : 0) + (pre ? ' · ' + (globalThis.psPreWhy || 'terreno') : '') + ' · estado ' + G.Game.state);
    }
    if (bootCalm >= 20 || now - bootT0 > 20000) { console.log('[carga] lista en ' + ((now - bootT0) / 1000).toFixed(1) + ' s' + (bootCalm < 20 ? ' (por tiempo: algo seguía cargando)' : '')); booting = false; lastKey = null; return; }
    screen.save();
    screen.setTransform(1, 0, 0, 1, 0, 0);
    screen.globalAlpha = 1;
    screen.fillStyle = '#0a1430'; screen.fillRect(0, 0, W, H);
    screen.restore();
    spin(W / 2, H / 2, now, 8);
  }
  // (Si la partida ya ha empezado —Reintentar del cooperativo local, desde la carga del menú—, la carga se quita: tapaba la
  // partida hasta 20 s mientras seguía cargando el terreno.)
  let slowUi = 0;
  const draw0t = now => {   // (diagnóstico: qué pantalla tarda, si la UI se lleva más de 30 ms)
    const t = ps.now(); draw0(now); const d = ps.now() - t;
    if (d > 30 && ps.now() - slowUi > 2000) { slowUi = ps.now(); console.log('[ui] ' + Math.round(d) + ' ms: ' + (top ? (top.id || (top.guest ? 'sala (invitado)' : 'sin id')) : 'ninguna') + (winOn ? ', en su ventana' : '') + ', booting ' + booting); }
  };
  globalThis.psOverlay = now => { draw0t(now); if (booting && G.Game.state !== 'ui') { booting = false; console.log('[carga] la partida ya empezó: se quita'); } if (booting) return bootCover(now); if (!top) hudHints(); notices(now); if (Dev.on()) fpsCounter(now); };

  Object.assign(G.RunUI, { showLevelUp, setWaiting, showItemChoice, showPause, wirePause, showOver, showBond, pickBond, bondBack,
                           closeLevelUp() { close(); G.UI.hide('scr-levelup'); } });
})();
