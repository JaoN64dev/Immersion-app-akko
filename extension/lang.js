// akko companion in akko's interface language: English, 日本語, Português or Español. The language
// is akko's own (akkoUi, sent by akko's pages through akko's server: background.js), else your
// language in akko (native), else the browser's.
//
// Like akko's scripts/i18n.js: the extension is written in English, and akkoLang.watch(root) swaps
// every text and title / placeholder / aria-label that has a row below for its translation,
// including what's added later (a MutationObserver watches root: the toolbar popup, the options
// page, the overlay's shadow root). {n}, {name}… stand for any text. Content is never touched:
// anything inside an element with lang="…" (subtitles) or translate="no" (dictionary meanings).
// Elements with data-l="key" get the html rows as a whole (text with links or keys inside).

(() => {
    if (globalThis.akkoLang) return;

    // [English, 日本語, Português, Español]
    const ROWS = [
        // ---------- the toolbar popup ----------
        ["looking for akko…", "akko を探しています…", "procurando o akko…", "buscando akko…"],
        ["🎙 Recording is on for this Netflix tab: cards get the line's audio and a picture.", "🎙 この Netflix のタブは録音できます: カードにセリフの音声と画像が入ります。", "🎙 A gravação está ligada nesta aba da Netflix: os cartões ganham o áudio da fala e uma imagem.", "🎙 La grabación está activada en esta pestaña de Netflix: las tarjetas llevan el audio de la línea y una imagen."],
        ["▶ Use akko on this page", "▶ このページで akko を使う", "▶ Usar o akko nesta página", "▶ Usar akko en esta página"],
        ["Any other site with a video (Crunchyroll, Disney+…): then drop a subtitle file on the video.", "動画のあるほかのサイト（Crunchyroll、Disney+…）: そのあと字幕ファイルを動画の上にドロップします。", "Qualquer outro site com vídeo (Crunchyroll, Disney+…): depois solte um arquivo de legenda sobre o vídeo.", "Cualquier otro sitio con vídeo (Crunchyroll, Disney+…): luego suelta un archivo de subtítulos sobre el vídeo."],
        ["I'm learning", "学んでいる言語", "Estou aprendendo", "Estoy aprendiendo"],
        ["what akko is learning ({lang})", "akko と同じ（{lang}）", "o que o akko está aprendendo ({lang})", "lo que akko está aprendiendo ({lang})"],
        ["Japanese", "日本語", "Japonês", "Japonés"],
        ["English", "英語", "Inglês", "Inglés"],
        ["Japanese and English", "日本語と英語", "Japonês e inglês", "Japonés e inglés"],
        ["on YouTube", "YouTube で使う", "no YouTube", "en YouTube"],
        ["on Netflix", "Netflix で使う", "na Netflix", "en Netflix"],
        ["(experimental)", "（試験的）", "(experimental)", "(experimental)"],
        ["open akko ↗", "akko を開く ↗", "abrir o akko ↗", "abrir akko ↗"],
        ["options", "オプション", "opções", "opciones"],
        ["report a problem", "問題を報告", "relatar um problema", "informar un problema"],
        ["akko can't run on this page (Chrome's own pages and the Web Store are off-limits).", "このページでは akko を使えません（Chrome 自身のページとウェブストアは対象外です）。", "o akko não pode rodar nesta página (as páginas do próprio Chrome e a Web Store são proibidas).", "akko no puede funcionar en esta página (las páginas del propio Chrome y la Web Store están vedadas)."],
        ["✓ akko is on: drop a subtitle file in the language you learn on the video (another language for the translation).", "✓ akko がオンになりました: 学んでいる言語の字幕ファイルを動画の上にドロップしてください（ほかの言語は翻訳になります）。", "✓ o akko está ligado: solte sobre o vídeo um arquivo de legenda no idioma que você aprende (outro idioma vira a tradução).", "✓ akko está activado: suelta sobre el vídeo un archivo de subtítulos en el idioma que aprendes (otro idioma será la traducción)."],
        ["The video is inside a frame from {hosts}. akko needs your permission to work there.", "動画は {hosts} のフレームの中にあります。そこで動くには akko に許可が必要です。", "O vídeo está dentro de um quadro de {hosts}. O akko precisa da sua permissão para funcionar ali.", "El vídeo está dentro de un marco de {hosts}. akko necesita tu permiso para funcionar ahí."],
        ["Allow akko on {hosts}", "{hosts} で akko を許可", "Permitir o akko em {hosts}", "Permitir akko en {hosts}"],
        ["Not allowed: akko can't reach that video.", "許可されませんでした: akko はその動画に届きません。", "Não permitido: o akko não alcança esse vídeo.", "No permitido: akko no llega a ese vídeo."],
        ["No video found on this page. Start the video, then try again.", "このページに動画が見つかりません。動画を再生してから、もう一度試してください。", "Nenhum vídeo nesta página. Comece o vídeo e tente de novo.", "No hay ningún vídeo en esta página. Inicia el vídeo y vuelve a intentarlo."],
        ["Japanese: {known} known · {learning} learning", "日本語: 既知 {known} · 学習中 {learning}", "Japonês: {known} conhecidas · {learning} aprendendo", "Japonés: {known} conocidas · {learning} aprendiendo"],
        ["English: {known} known · {learning} learning", "英語: 既知 {known} · 学習中 {learning}", "Inglês: {known} conhecidas · {learning} aprendendo", "Inglés: {known} conocidas · {learning} aprendiendo"],
        ["{lists} (from akko)", "{lists}（akko から）", "{lists} (do akko)", "{lists} (de akko)"],
        ["{lists} (from akko) · {n} changes waiting for akko", "{lists}（akko から）· akko 待ちの変更 {n} 件", "{lists} (do akko) · {n} mudanças esperando o akko", "{lists} (de akko) · {n} cambios esperando a akko"],
        ["{lists} (from akko) · 1 change waiting for akko", "{lists}（akko から）· akko 待ちの変更 1 件", "{lists} (do akko) · 1 mudança esperando o akko", "{lists} (de akko) · 1 cambio esperando a akko"],
        ["no word list yet: open akko on this computer", "まだ単語リストがありません: このパソコンで akko を開いてください", "ainda sem lista de palavras: abra o akko neste computador", "todavía no hay lista de palabras: abre akko en este ordenador"],
        ["Anki: not set up yet (see options)", "Anki: まだ設定されていません（オプションを見てください）", "Anki: ainda não configurado (veja as opções)", "Anki: todavía sin configurar (mira las opciones)"],
        ["✓ akko {version} at {url}", "✓ akko {version}（{url}）", "✓ akko {version} em {url}", "✓ akko {version} en {url}"],
        ["✗ akko isn't running: open akko on this computer", "✗ akko が起動していません: このパソコンで akko を開いてください", "✗ o akko não está aberto: abra o akko neste computador", "✗ akko no está abierto: abre akko en este ordenador"],

        // ---------- the options page ----------
        ["akko companion: options", "akko companion: オプション", "akko companion: opções", "akko companion: opciones"],
        ["The extension uses akko, running on this computer, for the dictionary, splitting words and sending cards to Anki.", "この拡張機能は、このパソコンで動いている akko を使って、辞書、単語の区切り、Anki へのカード送信をします。", "A extensão usa o akko, rodando neste computador, para o dicionário, para separar as palavras e para mandar cartões ao Anki.", "La extensión usa akko, que funciona en este ordenador, para el diccionario, separar las palabras y enviar tarjetas a Anki."],
        ["looking…", "探しています…", "procurando…", "buscando…"],
        ["akko's address", "akko のアドレス", "endereço do akko", "dirección de akko"],
        ["found by itself, e.g. http://127.0.0.1:3417", "自動で見つかります。例: http://127.0.0.1:3417", "encontrado sozinho, ex.: http://127.0.0.1:3417", "se encuentra solo, p. ej. http://127.0.0.1:3417"],
        ["find akko", "akko を探す", "encontrar o akko", "buscar akko"],
        ["Your words", "あなたの単語", "Suas palavras", "Tus palabras"],
        ["or import them from an akko backup file", "または akko のバックアップファイルから取り込む", "ou importe de um arquivo de backup do akko", "o impórtalas de un archivo de copia de akko"],
        ["load decks from Anki", "Anki からデッキを読み込む", "carregar baralhos do Anki", "cargar mazos de Anki"],
        ["deck", "デッキ", "baralho", "mazo"],
        ["note type", "ノートタイプ", "tipo de nota", "tipo de nota"],
        ["tags", "タグ", "etiquetas", "etiquetas"],
        ["record the line's audio", "セリフの音声を録音する", "gravar o áudio da fala", "grabar el audio de la línea"],
        ["add the word's pronunciation", "単語の発音を追加する", "adicionar a pronúncia da palavra", "añadir la pronunciación de la palabra"],
        ["add a screenshot", "スクリーンショットを追加する", "adicionar uma captura de tela", "añadir una captura de pantalla"],
        ["Translation", "翻訳", "Tradução", "Traducción"],
        ["translate the subtitles into", "字幕の翻訳先", "traduzir as legendas para", "traducir los subtítulos a"],
        ["Portuguese", "ポルトガル語", "Português", "Portugués"],
        ["Spanish", "スペイン語", "Espanhol", "Español"],
        ["French", "フランス語", "Francês", "Francés"],
        ["German", "ドイツ語", "Alemão", "Alemán"],
        ["Italian", "イタリア語", "Italiano", "Italiano"],
        ["Korean", "韓国語", "Coreano", "Coreano"],
        ["Chinese (simplified)", "中国語（簡体字）", "Chinês (simplificado)", "Chino (simplificado)"],
        ["Russian", "ロシア語", "Russo", "Ruso"],
        ["Indonesian", "インドネシア語", "Indonésio", "Indonesio"],
        ["Vietnamese", "ベトナム語", "Vietnamita", "Vietnamita"],
        ["Thai", "タイ語", "Tailandês", "Tailandés"],
        ["On YouTube: the video's own subtitles in that language when it has them, otherwise YouTube's translation.", "YouTube では、その言語の字幕が動画にあればそれを、なければ YouTube の翻訳を使います。", "No YouTube: as legendas do próprio vídeo nesse idioma quando houver, senão a tradução do YouTube.", "En YouTube: los subtítulos del propio vídeo en ese idioma cuando los tiene, si no la traducción de YouTube."],
        ["(leave empty)", "（空のまま）", "(deixar vazio)", "(dejar vacío)"],
        ["word", "単語", "palavra", "palabra"],
        ["reading", "読み", "leitura", "lectura"],
        ["word[reading]", "単語[読み]", "palavra[leitura]", "palabra[lectura]"],
        ["meaning", "意味", "significado", "significado"],
        ["pitch accent (drawn)", "ピッチアクセント（図）", "acento tonal (desenhado)", "acento tonal (dibujado)"],
        ["pitch accent (text)", "ピッチアクセント（文字）", "acento tonal (texto)", "acento tonal (texto)"],
        ["sentence", "文", "frase", "oración"],
        ["sentence, word in bold", "文（単語を太字）", "frase, palavra em negrito", "oración, palabra en negrita"],
        ["sentence translation", "文の翻訳", "tradução da frase", "traducción de la oración"],
        ["line audio", "セリフの音声", "áudio da fala", "audio de la línea"],
        ["word audio", "単語の音声", "áudio da palavra", "audio de la palabra"],
        ["screenshot", "スクリーンショット", "captura de tela", "captura de pantalla"],
        ["video and time (link)", "動画と時間（リンク）", "vídeo e tempo (link)", "vídeo y tiempo (enlace)"],
        ["Anki field", "Anki のフィールド", "campo do Anki", "campo de Anki"],
        ["what goes in it", "入れるもの", "o que vai nele", "qué va en él"],
        ["{known} known · {learning} learning · {ignored} ignored", "既知 {known} · 学習中 {learning} · 無視 {ignored}", "{known} conhecidas · {learning} aprendendo · {ignored} ignoradas", "{known} conocidas · {learning} aprendiendo · {ignored} ignoradas"],
        ["no word list yet", "まだ単語リストがありません", "ainda sem lista de palavras", "todavía no hay lista de palabras"],
        ["deck {deck} · note type {model}", "デッキ {deck} · ノートタイプ {model}", "baralho {deck} · tipo de nota {model}", "mazo {deck} · tipo de nota {model}"],
        ["not set up yet", "まだ設定されていません", "ainda não configurado", "todavía sin configurar"],
        ["couldn't reach Anki through akko: {error}", "akko 経由で Anki に接続できませんでした: {error}", "não foi possível chegar ao Anki pelo akko: {error}", "no se pudo llegar a Anki a través de akko: {error}"],
        ["saved ✓", "保存しました ✓", "salvo ✓", "guardado ✓"],
        ["imported {n} words ✓", "{n} 語を取り込みました ✓", "{n} palavras importadas ✓", "{n} palabras importadas ✓"],
        ["that isn't an akko backup file", "akko のバックアップファイルではありません", "isso não é um arquivo de backup do akko", "eso no es un archivo de copia de akko"],

        // ---------- the overlay: the menu (akko ▾) ----------
        ["all the lines (Shift+T)", "すべてのセリフ (Shift+T)", "todas as falas (Shift+T)", "todas las líneas (Shift+T)"],
        ["Subtitles", "字幕", "Legendas", "Subtítulos"],
        ["Japanese subtitles", "日本語字幕", "Legendas em japonês", "Subtítulos en japonés"],
        ["English subtitles", "英語字幕", "Legendas em inglês", "Subtítulos en inglés"],
        ["none found on this video", "この動画にはありません", "nenhuma neste vídeo", "ninguno en este vídeo"],
        ["translation", "翻訳", "tradução", "traducción"],
        ["none", "なし", "nenhuma", "ninguna"],
        ["show the translation", "翻訳を表示", "mostrar a tradução", "mostrar la traducción"],
        ["when paused", "一時停止中だけ", "quando pausado", "en pausa"],
        ["always", "常に", "sempre", "siempre"],
        ["always, blurred until the mouse is on it", "常に（マウスを乗せるまでぼかす）", "sempre, desfocada até o mouse passar", "siempre, difuminada hasta pasar el ratón"],
        ["never", "表示しない", "nunca", "nunca"],
        ["furigana", "ふりがな", "furigana", "furigana"],
        ["on words I don't know", "知らない単語だけ", "nas palavras que não conheço", "en las palabras que no conozco"],
        ["off", "オフ", "desligado", "apagado"],
        ["★ lines with exactly one new word (the best to mine)", "★ 知らない単語がちょうど1つの行（マイニングに最適）", "★ falas com exatamente uma palavra nova (as melhores para minerar)", "★ líneas con exactamente una palabra nueva (las mejores para minar)"],
        ["timing", "タイミング", "sincronia", "sincronía"],
        ["(when the subtitles are early or late)", "（字幕が早い・遅いとき）", "(quando as legendas estão adiantadas ou atrasadas)", "(cuando los subtítulos van adelantados o atrasados)"],
        ["show the subtitles earlier", "字幕を早く表示", "mostrar as legendas antes", "mostrar los subtítulos antes"],
        ["show the subtitles later", "字幕を遅く表示", "mostrar as legendas depois", "mostrar los subtítulos después"],
        ["Watching", "視聴", "Assistindo", "Viendo"],
        ["pause when the mouse is on the subtitles", "字幕にマウスを乗せたら一時停止", "pausar quando o mouse está nas legendas", "pausar cuando el ratón está sobre los subtítulos"],
        ["pause at the end of every line", "各行の終わりで一時停止", "pausar no fim de cada fala", "pausar al final de cada línea"],
        ["listening practice: blur the Japanese until paused", "リスニング練習: 一時停止するまで日本語をぼかす", "prática de escuta: desfocar o japonês até pausar", "práctica de escucha: difuminar el japonés hasta pausar"],
        ["listening practice: blur the English until paused", "リスニング練習: 一時停止するまで英語をぼかす", "prática de escuta: desfocar o inglês até pausar", "práctica de escucha: difuminar el inglés hasta pausar"],
        ["previous line ([)", "前の行 ([)", "fala anterior ([)", "línea anterior ([)"],
        ["replay the line (P)", "この行をもう一度 (P)", "repetir a fala (P)", "repetir la línea (P)"],
        ["replay the line slowly (Shift+P)", "この行をゆっくりもう一度 (Shift+P)", "repetir a fala devagar (Shift+P)", "repetir la línea despacio (Shift+P)"],
        ["next line (])", "次の行 (])", "próxima fala (])", "línea siguiente (])"],
        ["⏮ line", "⏮ 前の行", "⏮ fala", "⏮ línea"],
        ["line ⏭", "次の行 ⏭", "fala ⏭", "línea ⏭"],
        ["☰ all the lines", "☰ すべてのセリフ", "☰ todas as falas", "☰ todas las líneas"],
        ["Look", "見た目", "Aparência", "Aspecto"],
        ["size", "サイズ", "tamanho", "tamaño"],
        ["height", "高さ", "altura", "altura"],
        ["background", "背景", "fundo", "fondo"],
        ["font", "フォント", "fonte", "fuente"],
        ["gothic (plain)", "ゴシック（標準）", "gótica (simples)", "gótica (sencilla)"],
        ["mincho (book style)", "明朝（本のような）", "mincho (estilo livro)", "mincho (estilo libro)"],
        ["rounded", "丸ゴシック", "arredondada", "redondeada"],
        ["Mining", "マイニング", "Mineração", "Minado"],
        ["For the line's audio and a picture on cards, click the akko companion button in Chrome's toolbar once on this tab (Chrome only lets extensions record a tab after that).", "カードにセリフの音声と画像を入れるには、このタブで一度 Chrome のツールバーの akko companion ボタンを押してください（Chrome はそのあとでしか拡張機能にタブの録音を許しません）。", "Para o áudio da fala e uma imagem nos cartões, clique uma vez no botão do akko companion na barra do Chrome nesta aba (o Chrome só deixa extensões gravarem uma aba depois disso).", "Para el audio de la línea y una imagen en las tarjetas, pulsa una vez el botón de akko companion en la barra de Chrome en esta pestaña (Chrome solo deja grabar una pestaña después de eso)."],
        ["keep the line's audio and a picture in akko too (復習 plays them)", "セリフの音声と画像を akko にも残す（復習で再生）", "guardar o áudio da fala e uma imagem no akko também (o 復習 toca)", "guardar el audio de la línea y una imagen también en akko (復習 los reproduce)"],
        ["“+ mine” sends the card to", "「+ マイニング」の送り先", "“+ minerar” manda o cartão para", "“+ minar” envía la tarjeta a"],
        ["Anki, and akko's mined list", "Anki と akko のマイニング一覧", "Anki, e a lista de mineradas do akko", "Anki, y la lista de minadas de akko"],
        ["only akko's mined list", "akko のマイニング一覧だけ", "só a lista de mineradas do akko", "solo la lista de minadas de akko"],
        ["in step with akko just now ·", "akko と同期: たった今 ·", "sincronizado com o akko agora mesmo ·", "sincronizado con akko justo ahora ·"],
        ["in step with akko {n} min ago ·", "akko と同期: {n} 分前 ·", "sincronizado com o akko há {n} min ·", "sincronizado con akko hace {n} min ·"],
        ["turn akko off on {site}", "{site} で akko をオフにする", "desligar o akko em {site}", "apagar akko en {site}"],
        ["turn off here", "ここでオフにする", "desligar aqui", "apagar aquí"],
        ["⏸ each line", "⏸ 各行", "⏸ cada fala", "⏸ cada línea"],
        ["👂 listening", "👂 リスニング", "👂 escuta", "👂 escucha"],
        ["one new word: a good sentence to mine", "知らない単語が1つ: マイニングにいい文", "uma palavra nova: uma boa frase para minerar", "una palabra nueva: una buena oración para minar"],
        ["{label}: {n} lines", "{label}: {n} 行", "{label}: {n} falas", "{label}: {n} líneas"],
        ["{n} lines", "{n} 行", "{n} falas", "{n} líneas"],
        ["lines with exactly one word you don't know", "知らない単語がちょうど1つの行", "falas com exatamente uma palavra que você não conhece", "líneas con exactamente una palabra que no conoces"],
        ["only ★ ({n})", "★ だけ ({n})", "só ★ ({n})", "solo ★ ({n})"],
        ["close (Shift+T)", "閉じる (Shift+T)", "fechar (Shift+T)", "cerrar (Shift+T)"],
        ["one new word", "知らない単語が1つ", "uma palavra nova", "una palabra nueva"],
        ["{name} (automatic)", "{name}（自動）", "{name} (automática)", "{name} (automática)"],
        ["{name} (YouTube's translation)", "{name}（YouTube の翻訳）", "{name} (tradução do YouTube)", "{name} (traducción de YouTube)"],

        // ---------- the overlay: the dictionary ----------
        ["close (Esc)", "閉じる (Esc)", "fechar (Esc)", "cerrar (Esc)"],
        ["looking up…", "辞書を引いています…", "procurando…", "buscando…"],
        ["couldn't look it up: {error}", "引けませんでした: {error}", "não foi possível consultar: {error}", "no se pudo buscar: {error}"],
        ["1 new", "1 未知", "1 nova", "1 nueva"],
        ["2 learning", "2 学習中", "2 aprendendo", "2 aprendiendo"],
        ["3 known ✓", "3 既知 ✓", "3 conhecida ✓", "3 conocida ✓"],
        ["4 ignore", "4 無視", "4 ignorar", "4 ignorar"],
        ["new", "未知", "nova", "nueva"],
        ["learning", "学習中", "aprendendo", "aprendiendo"],
        ["known ✓", "既知 ✓", "conhecida ✓", "conocida ✓"],
        ["ignore", "無視", "ignorar", "ignorar"],
        ["common", "よく使う", "comum", "común"],
        ["hear it", "聞く", "ouvir", "escuchar"],
        ["pitch accent", "ピッチアクセント", "acento tonal", "acento tonal"],
        ["+ mine", "+ マイニング", "+ minerar", "+ minar"],
        ["no dictionary entry for this", "辞書に見つかりませんでした", "nada no dicionário para isto", "nada en el diccionario para esto"],
        ["idiom · part of", "慣用句 · この単語を含む", "expressão idiomática · parte de", "modismo · parte de"],
        ["phrase · part of", "表現 · この単語を含む", "expressão · parte de", "expresión · parte de"],
        ["{word}: new", "{word}: 未知", "{word}: nova", "{word}: nueva"],
        ["{word}: learning", "{word}: 学習中", "{word}: aprendendo", "{word}: aprendiendo"],
        ["{word}: known", "{word}: 既知", "{word}: conhecida", "{word}: conocida"],
        ["{word}: ignored", "{word}: 無視", "{word}: ignorada", "{word}: ignorada"],

        // ---------- the overlay: mining, keys, messages ----------
        ["adding…", "追加中…", "adicionando…", "añadiendo…"],
        ["recording…", "録音中…", "gravando…", "grabando…"],
        ["added ✓", "追加しました ✓", "adicionado ✓", "añadido ✓"],
        ["saved {word} in akko ✓{more}", "{word} を akko に保存しました ✓{more}", "{word} salva no akko ✓{more}", "{word} guardada en akko ✓{more}"],
        ["added {word} to {deck} ✓{more}", "{word} を {deck} に追加しました ✓{more}", "{word} adicionada a {deck} ✓{more}", "{word} añadida a {deck} ✓{more}"],
        ["subtitles on time", "字幕のずれなし", "legendas no tempo certo", "subtítulos a tiempo"],
        ["subtitles {n} s later", "字幕を {n} 秒遅く", "legendas {n} s depois", "subtítulos {n} s después"],
        ["subtitles {n} s earlier", "字幕を {n} 秒早く", "legendas {n} s antes", "subtítulos {n} s antes"],
        ["translation: when paused", "翻訳: 一時停止中だけ", "tradução: quando pausado", "traducción: en pausa"],
        ["translation: always", "翻訳: 常に", "tradução: sempre", "traducción: siempre"],
        ["translation: blurred until the mouse is on it", "翻訳: マウスを乗せるまでぼかす", "tradução: desfocada até o mouse passar", "traducción: difuminada hasta pasar el ratón"],
        ["translation: never", "翻訳: 表示しない", "tradução: nunca", "traducción: nunca"],
        ["pause at the end of every line: on", "各行の終わりで一時停止: オン", "pausar no fim de cada fala: ligado", "pausar al final de cada línea: activado"],
        ["pause at the end of every line: off", "各行の終わりで一時停止: オフ", "pausar no fim de cada fala: desligado", "pausar al final de cada línea: apagado"],
        ["listening practice: on", "リスニング練習: オン", "prática de escuta: ligada", "práctica de escucha: activada"],
        ["listening practice: off", "リスニング練習: オフ", "prática de escuta: desligada", "práctica de escucha: apagada"],
        ["the extension was updated: reload this page", "拡張機能が更新されました: このページを再読み込みしてください", "a extensão foi atualizada: recarregue esta página", "la extensión se actualizó: recarga esta página"],
        ["pick an Anki deck and note type in the extension's options (or open akko in this browser once: its Anki settings are copied)", "拡張機能のオプションで Anki のデッキとノートタイプを選んでください（またはこのブラウザで一度 akko を開くと、akko の Anki 設定がコピーされます）", "escolha um baralho e um tipo de nota do Anki nas opções da extensão (ou abra o akko neste navegador uma vez: as configurações do Anki dele são copiadas)", "elige un mazo y un tipo de nota de Anki en las opciones de la extensión (o abre akko en este navegador una vez: se copian sus ajustes de Anki)"],
        ["for the line's audio and a picture, click the akko companion button in Chrome's toolbar once on this tab", "セリフの音声と画像のために、このタブで一度 Chrome のツールバーの akko companion ボタンを押してください", "para o áudio da fala e uma imagem, clique uma vez no botão do akko companion na barra do Chrome nesta aba", "para el audio de la línea y una imagen, pulsa una vez el botón de akko companion en la barra de Chrome en esta pestaña"],
        ["these subtitles are empty", "この字幕は空です", "estas legendas estão vazias", "estos subtítulos están vacíos"],
        ["YouTube didn't send the subtitles (try playing the video, then reload)", "YouTube から字幕が届きませんでした（動画を再生してから再読み込みしてください）", "o YouTube não mandou as legendas (toque o vídeo e recarregue)", "YouTube no envió los subtítulos (reproduce el vídeo y recarga)"],
        ["translation: {error}", "翻訳: {error}", "tradução: {error}", "traducción: {error}"],
        ["{name}: no subtitles in it", "{name}: 字幕が入っていません", "{name}: não tem legendas", "{name}: no tiene subtítulos"],
        ["drop a subtitle file on the video (.srt, .vtt, .ass)", "字幕ファイルを動画の上にドロップしてください (.srt, .vtt, .ass)", "solte um arquivo de legenda sobre o vídeo (.srt, .vtt, .ass)", "suelta un archivo de subtítulos sobre el vídeo (.srt, .vtt, .ass)"],
        ["Japanese or English", "日本語か英語", "Japonês ou inglês", "Japonés o inglés"],
        ["for akko's subtitles; another language for the translation", "は akko の字幕に、ほかの言語は翻訳になります", "para as legendas do akko; outro idioma para a tradução", "para los subtítulos de akko; otro idioma para la traducción"],
        ["choose a file…", "ファイルを選ぶ…", "escolher um arquivo…", "elegir un archivo…"],
    ];

    // html rows: [key, English is in the page, 日本語, Português, Español]
    const HTML = {
        "popup-keys": [
            "学んでいる言語の字幕がある動画を開いて、単語をクリック。キー: <kbd>1</kbd>–<kbd>4</kbd> 単語の状態、<kbd>[</kbd> <kbd>]</kbd> 前後の行、<kbd>P</kbd> もう一度（<kbd>Shift</kbd>+<kbd>P</kbd> ゆっくり）、<kbd>Shift</kbd>+<kbd>T</kbd> すべてのセリフ、<kbd>A</kbd> 各行で一時停止、<kbd>R</kbd> 翻訳、<kbd>L</kbd> リスニング練習。",
            "Abra um vídeo com legendas no idioma que você aprende: clique em qualquer palavra. Teclas: <kbd>1</kbd>–<kbd>4</kbd> status da palavra, <kbd>[</kbd> <kbd>]</kbd> falas, <kbd>P</kbd> repetir (<kbd>Shift</kbd>+<kbd>P</kbd> devagar), <kbd>Shift</kbd>+<kbd>T</kbd> todas as falas, <kbd>A</kbd> pausar depois de cada fala, <kbd>R</kbd> tradução, <kbd>L</kbd> prática de escuta.",
            "Abre un vídeo con subtítulos en el idioma que aprendes: haz clic en cualquier palabra. Teclas: <kbd>1</kbd>–<kbd>4</kbd> estado de la palabra, <kbd>[</kbd> <kbd>]</kbd> líneas, <kbd>P</kbd> repetir (<kbd>Shift</kbd>+<kbd>P</kbd> despacio), <kbd>Shift</kbd>+<kbd>T</kbd> todas las líneas, <kbd>A</kbd> pausar tras cada línea, <kbd>R</kbd> traducción, <kbd>L</kbd> práctica de escucha."],
        "options-words": [
            "単語リスト、Anki の設定、言語は、akko（デスクトップアプリまたは <code>npm start</code>）が動いている間、自動で akko から届きます。設定した単語、マイニングしたカード、観た時間は akko に戻り、記録と復習に表示され、今日の記録と連続日数に数えられます。akko が閉じている間は、ここで待って、akko が戻ったら送られます。",
            "Sua lista de palavras, as configurações do Anki e o idioma vêm do akko sozinhos enquanto o akko está rodando (o app de desktop ou <code>npm start</code>). As palavras que você marca, os cartões que minera e o tempo que assiste voltam para o akko: aparecem nas Estatísticas e no 復習, e contam para hoje e para a sua sequência. Se o akko estiver fechado, eles esperam aqui até ele voltar.",
            "Tu lista de palabras, los ajustes de Anki y el idioma llegan solos desde akko mientras akko está abierto (la app de escritorio o <code>npm start</code>). Las palabras que marcas, las tarjetas que minas y el tiempo que ves vuelven a akko: aparecen en Estadísticas y en 復習, y cuentan para hoy y para tu racha. Si akko está cerrado, esperan aquí hasta que vuelva."],
        "options-anki": [
            "カードは akko を通って Anki（AnkiConnect アドオン、2055492159）と akko のマイニング一覧に入ります。この設定は akko 自身の Anki 設定から届きますが、ここで設定することもできます。プレーヤーの akko ▾ メニューで、カードを akko だけに送ることもできます。",
            "Os cartões vão pelo akko até o Anki (com o complemento AnkiConnect, 2055492159) e para a lista de mineradas do akko. Estas configurações vêm das configurações do Anki do próprio akko; você também pode defini-las aqui. No menu akko ▾ do player dá para escolher mandar os cartões só para o akko.",
            "Las tarjetas van a través de akko a Anki (con el complemento AnkiConnect, 2055492159) y a la lista de minadas de akko. Estos ajustes vienen de los ajustes de Anki del propio akko; también puedes ponerlos aquí. En el menú akko ▾ del reproductor puedes elegir enviar las tarjetas solo a akko."],
    };

    const COL = { ja: 1, pt: 2, es: 3 };
    const ATTRS = ["title", "placeholder", "aria-label"];
    let lang = "en";
    const pick = (s) => [s.akkoUi, s.native, (navigator.language || "").slice(0, 2)].find((l) => l === "en" || COL[l]) || "en";

    // the rows for the language shown: exact strings, and patterns for the ones with {…}
    const norm = (s) => s.replace(/\s+/g, " ").trim();
    const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    let exact = new Map(), patterns = [];
    function build() {
        exact = new Map(); patterns = [];
        if (lang === "en") return;
        for (const row of ROWS) {
            const en = norm(row[0]), tr = row[COL[lang]];
            if (!/\{\w+\}/.test(en)) { exact.set(en, tr); continue; }
            const names = [];
            const re = en.split(/(\{\w+\})/).map((part) => {
                const m = part.match(/^\{(\w+)\}$/);
                if (!m) return escapeRe(part);
                names.push(m[1]);
                return "(.*?)";
            }).join("");
            patterns.push({ re: new RegExp(`^${re}$`, "s"), names, tr });
        }
    }
    function t(text) {
        const key = norm(String(text ?? ""));
        if (!key || lang === "en") return text;
        if (exact.has(key)) return exact.get(key);
        for (const p of patterns) {
            const m = key.match(p.re);
            if (m) return p.tr.replace(/\{(\w+)\}/g, (all, name) => (p.names.includes(name) ? t(m[p.names.indexOf(name) + 1]) : all));
        }
        return text;
    }

    // ---------- swapping text in a page / shadow root ----------
    // what each text / attribute was in English, and what it shows: when a script changes it, what
    // it shows no longer matches, and the new text is the English
    const originals = new WeakMap();      // text node -> {en, shown}, element -> {attr: {en, shown}, html: English}
    const skipped = (el) => {
        if (!el) return false;
        const own = el.closest("[lang]");
        return !!el.closest("[translate=no], script, style, textarea, select.tracks, select.trs") || (!!own && own !== document.documentElement);
    };
    const keepSpaces = (original, tr) => original.match(/^\s*/)[0] + tr + original.match(/\s*$/)[0];
    const show = (en) => { const tr = t(en); return tr === en ? en : keepSpaces(en, tr); };

    function swapText(node) {
        if (skipped(node.parentElement)) return;
        let rec = originals.get(node);
        if (!rec || node.data !== rec.shown) { rec = { en: node.data }; originals.set(node, rec); }
        rec.shown = show(rec.en);
        if (node.data !== rec.shown) node.data = rec.shown;
    }
    function swapElement(el) {
        if (skipped(el)) return false;
        let saved = originals.get(el);
        if (!saved) { saved = {}; originals.set(el, saved); }
        for (const a of ATTRS) {
            if (!el.hasAttribute(a)) continue;
            const now = el.getAttribute(a);
            if (!saved[a] || now !== saved[a].shown) saved[a] = { en: now };
            saved[a].shown = t(saved[a].en);
            if (now !== saved[a].shown) el.setAttribute(a, saved[a].shown);
        }
        const key = el.dataset && el.dataset.l;
        if (key && HTML[key]) {
            if (!("html" in saved)) saved.html = el.innerHTML;
            const want = lang === "en" ? saved.html : HTML[key][COL[lang] - 1];
            if (el.innerHTML !== want) el.innerHTML = want;
            return true;
        }
        return false;
    }
    function apply(root) {
        if (root.nodeType === 3) { swapText(root); return; }
        if (root.nodeType === 1 && swapElement(root)) return;
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
            acceptNode: (n) => (n.nodeType === 1 && n.matches("[translate=no], [lang], script, style, textarea") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
        });
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
            if (n.nodeType === 3) swapText(n);
            else if (swapElement(n)) { /* its inside is done */ }
        }
    }

    const roots = new Set();
    function watch(root) {
        roots.add(root);
        ready.then(() => {
            apply(root);
            const observer = new MutationObserver((records) => {
                for (const r of records) {
                    if (r.type === "childList") r.addedNodes.forEach(apply);
                    else if (r.type === "characterData") swapText(r.target);
                    else if (r.type === "attributes") swapElement(r.target);
                }
                observer.takeRecords();      // our own changes
            });
            observer.observe(root, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
        });
    }

    const ready = (chrome.storage ? chrome.storage.local.get(["akkoUi", "native"]) : Promise.resolve({}))
        .then((s) => { lang = pick(s); build(); }).catch(() => {});
    if (chrome.storage) {
        chrome.storage.onChanged.addListener((c) => {
            if (!c.akkoUi && !c.native) return;
            chrome.storage.local.get(["akkoUi", "native"]).then((s) => {
                const l = pick(s);
                if (l === lang) return;
                lang = l;
                build();
                roots.forEach((root) => apply(root));
            });
        });
    }

    globalThis.akkoLang = { ready, t, watch, lang: () => lang, ROWS, HTML };
})();
