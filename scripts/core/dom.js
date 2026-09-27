// Shared element lookups. Modules load after the page is parsed, so these all exist.

export const $ = (sel) => document.querySelector(sel);

export const el = {
    searchForm: $("#search-form"), searchInput: $("#search-input"), searchKind: $("#search-kind"),
    searchStatus: $("#search-status"), results: $("#results"),
    showSection: $("#show-section"), showCover: $("#show-cover"),
    showNative: $("#show-native"), showRomaji: $("#show-romaji"), showMeta: $("#show-meta"),
    folderSelect: $("#folder-select"), folderFilter: $("#folder-filter"), folderList: $("#folder-list"),
    fileFilter: $("#file-filter"), filesStatus: $("#files-status"), fileList: $("#file-list"),
    videoFile: $("#video-file"), urlForm: $("#url-form"), videoUrl: $("#video-url"),
    subFile: $("#sub-file"), nowPlaying: $("#now-playing"),
    video: $("#video"), overlay: $("#sub-overlay"), stageEmpty: $("#stage-empty"),
    prevLine: $("#prev-line"), replayLine: $("#replay-line"), nextLine: $("#next-line"),
    autoPause: $("#auto-pause"), hoverPause: $("#hover-pause"), blurSubs: $("#blur-subs"), hideSubs: $("#hide-subs"),
    offsetMinus: $("#offset-minus"), offsetPlus: $("#offset-plus"), offsetValue: $("#offset-value"),
    syncHere: $("#sync-here"), subSize: $("#sub-size"),
    furigana: $("#furigana-mode"), colorWords: $("#color-words"),
    transcript: $("#transcript"), follow: $("#follow"),
    wordStats: $("#word-stats"), compBadge: $("#comp-badge"),
    mined: $("#mined"), minedCount: $("#mined-count"),
    exportCsv: $("#export-csv"), clearMined: $("#clear-mined"),
    popup: $("#popup"),
};
