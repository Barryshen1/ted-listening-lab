import {
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  EyeOff,
  FileUp,
  Heart,
  Library,
  Link,
  Pause,
  Play,
  Plus,
  Repeat,
  Search,
  Settings2,
  Star,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { seedTalks } from "./data/talks";
import {
  clearImportedTalks,
  deleteImportedTalk,
  getImportedTalks,
  saveImportedTalks,
} from "./storage";
import type { ImportedTalk, Segment, Talk } from "./types";

type YTPlayer = {
  playVideo: () => void;
  pauseVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  getCurrentTime: () => number;
  setPlaybackRate: (rate: number) => void;
  destroy: () => void;
};

declare global {
  interface Window {
    YT?: {
      Player: new (
        element: HTMLElement,
        options: {
          videoId: string;
          playerVars: Record<string, number | string>;
          events: { onReady: () => void };
        },
      ) => YTPlayer;
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

const FAVORITES_KEY = "talk-listening-lab:favorites";
const TALK_FAVORITES_KEY = "talk-listening-lab:talk-favorites";
const CUSTOM_TALKS_KEY = "talk-listening-lab:custom-talks";
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

function loadYouTubeApi() {
  if (window.YT?.Player) return Promise.resolve();

  return new Promise<void>((resolve) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[src="https://www.youtube.com/iframe_api"]',
    );
    window.onYouTubeIframeAPIReady = () => resolve();
    if (!existing) {
      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      document.body.appendChild(script);
    }
  });
}

function formatTime(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function parseTimestamp(value: string) {
  const parts = value.trim().replace(",", ".").split(":").map(Number);
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return 0;
}

function mergeCuesIntoSentences(cues: Segment[]) {
  const sentences: Segment[] = [];
  let current: Segment | null = null;

  for (const cue of cues) {
    if (!current) {
      current = { ...cue, text: cue.text.trim() };
    } else {
      current = {
        id: current.id,
        start: current.start,
        end: cue.end,
        text: `${current.text} ${cue.text}`.replace(/\s+/g, " ").trim(),
      };
    }

    const sentenceEnded = /[.!?。！？]["')\]]?$/.test(cue.text.trim());
    const wordCount = current.text.split(/\s+/).filter(Boolean).length;
    if (sentenceEnded || wordCount >= 36) {
      sentences.push({ ...current, id: `seg-${sentences.length + 1}` });
      current = null;
    }
  }

  if (current) sentences.push({ ...current, id: `seg-${sentences.length + 1}` });
  return sentences;
}

function parseVtt(input: string): Segment[] {
  const blocks = input
    .replace(/\r/g, "")
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean);

  const cues = blocks.flatMap((block, index) => {
    const lines = block.split("\n").filter(Boolean);
    const timeIndex = lines.findIndex((line) => line.includes("-->"));
    if (timeIndex === -1) return [];

    const [startRaw, endRaw] = lines[timeIndex].split("-->");
    const text = lines
      .slice(timeIndex + 1)
      .join(" ")
      .replace(/<[^>]+>/g, "")
      .trim();

    if (!text) return [];

    return {
      id: `seg-${index + 1}`,
      start: parseTimestamp(startRaw),
      end: parseTimestamp(endRaw.split(/\s+/)[0]),
      text,
    };
  });

  return mergeCuesIntoSentences(cues);
}

function readFavorites() {
  try {
    return new Set<string>(JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]"));
  } catch {
    return new Set<string>();
  }
}

function readCustomTalks() {
  try {
    return JSON.parse(localStorage.getItem(CUSTOM_TALKS_KEY) || "[]") as ImportedTalk[];
  } catch {
    return [];
  }
}

function readTalkFavorites() {
  try {
    return new Set<string>(JSON.parse(localStorage.getItem(TALK_FAVORITES_KEY) || "[]"));
  } catch {
    return new Set<string>();
  }
}

async function loadBundledCatalog() {
  const catalogUrl = `${import.meta.env.BASE_URL}data/catalog.json`;
  try {
    const response = await fetch(catalogUrl, { cache: "no-store" });
    if (!response.ok) return [];
    const payload = (await response.json()) as Talk[] | { talks: Talk[] };
    const talks = Array.isArray(payload) ? payload : payload.talks;
    if (!Array.isArray(talks)) return [];
    return talks.map((talk) => ({
      ...talk,
      importedAt: new Date().toISOString(),
    })) as ImportedTalk[];
  } catch {
    return [];
  }
}

function normalizeYoutubeId(value: string) {
  const trimmed = value.trim();
  const match =
    trimmed.match(/[?&]v=([^&]+)/) ||
    trimmed.match(/youtu\.be\/([^?]+)/) ||
    trimmed.match(/embed\/([^?]+)/);
  return match?.[1] || trimmed;
}

function getPlayablePlayer(player: YTPlayer | null) {
  const candidate = player as Partial<YTPlayer> | null;
  if (
    !candidate ||
    typeof candidate.playVideo !== "function" ||
    typeof candidate.pauseVideo !== "function" ||
    typeof candidate.seekTo !== "function" ||
    typeof candidate.getCurrentTime !== "function" ||
    typeof candidate.setPlaybackRate !== "function"
  ) {
    return null;
  }
  return candidate as YTPlayer;
}

export function App() {
  const [query, setQuery] = useState("");
  const [favorites, setFavorites] = useState<Set<string>>(() => readFavorites());
  const [talkFavorites, setTalkFavorites] = useState<Set<string>>(() => readTalkFavorites());
  const [customTalks, setCustomTalks] = useState<ImportedTalk[]>([]);
  const [dataStatus, setDataStatus] = useState("Starter catalog loaded");
  const [selectedTalkId, setSelectedTalkId] = useState(seedTalks[0].id);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [playerReady, setPlayerReady] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [loopCurrent, setLoopCurrent] = useState(true);
  const [autoAdvance, setAutoAdvance] = useState(false);
  const [showEnglish, setShowEnglish] = useState(true);
  const [showChinese, setShowChinese] = useState(true);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [hiddenEnglish, setHiddenEnglish] = useState<Set<string>>(new Set());
  const [hiddenChinese, setHiddenChinese] = useState<Set<string>>(new Set());
  const [importOpen, setImportOpen] = useState(false);
  const [importError, setImportError] = useState("");
  const [isImportingJson, setIsImportingJson] = useState(false);
  const [importForm, setImportForm] = useState({
    title: "",
    speaker: "",
    topic: "",
    year: new Date().getFullYear().toString(),
    duration: "",
    tedUrl: "",
    youtubeId: "",
    englishVtt: "",
    chineseVtt: "",
  });

  const playerHostRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YTPlayer | null>(null);

  const talks = useMemo(() => [...seedTalks, ...customTalks], [customTalks]);
  const selectedTalk = talks.find((talk) => talk.id === selectedTalkId) || talks[0];
  const selectedSegment = selectedTalk.segments[selectedIndex] || selectedTalk.segments[0];

  const filteredTalks = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return talks.filter((talk) => {
      const matches =
        !normalized ||
        [talk.title, talk.speaker, talk.topic, talk.level]
          .join(" ")
          .toLowerCase()
          .includes(normalized);
      const hasFavorite =
        !favoritesOnly ||
        talkFavorites.has(talk.id) ||
        talk.segments.some((segment) => favorites.has(`${talk.id}:${segment.id}`));
      return matches && hasFavorite;
    });
  }, [favorites, favoritesOnly, query, talkFavorites, talks]);

  const visibleSegments = useMemo(() => {
    if (!favoritesOnly) return selectedTalk.segments;
    if (talkFavorites.has(selectedTalk.id)) return selectedTalk.segments;
    return selectedTalk.segments.filter((segment) => favorites.has(`${selectedTalk.id}:${segment.id}`));
  }, [favorites, favoritesOnly, selectedTalk, talkFavorites]);

  useEffect(() => {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify([...favorites]));
  }, [favorites]);

  useEffect(() => {
    localStorage.setItem(TALK_FAVORITES_KEY, JSON.stringify([...talkFavorites]));
  }, [talkFavorites]);

  useEffect(() => {
    async function loadData() {
      const legacyTalks = readCustomTalks();
      const [dbTalks, bundledTalks] = await Promise.all([getImportedTalks(), loadBundledCatalog()]);
      const merged = new Map<string, ImportedTalk>();
      [...bundledTalks, ...legacyTalks, ...dbTalks].forEach((talk) => merged.set(talk.id, talk));
      const mergedTalks = [...merged.values()];

      if (legacyTalks.length > 0 || bundledTalks.length > 0) {
        await saveImportedTalks(mergedTalks);
        localStorage.removeItem(CUSTOM_TALKS_KEY);
      }

      setCustomTalks(mergedTalks);
      setDataStatus(
        mergedTalks.length > 0
          ? `${mergedTalks.length} personal talks loaded from browser storage/data pack`
          : "Starter catalog loaded",
      );
    }

    loadData().catch(() => {
      setDataStatus("Starter catalog loaded; personal data could not be opened");
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    setPlayerReady(false);
    loadYouTubeApi().then(() => {
      if (cancelled || !playerHostRef.current || !window.YT?.Player) return;
      if (typeof playerRef.current?.destroy === "function") playerRef.current.destroy();
      playerRef.current = new window.YT.Player(playerHostRef.current, {
        videoId: selectedTalk.youtubeId,
        playerVars: {
          modestbranding: 1,
          rel: 0,
          playsinline: 1,
          origin: window.location.origin,
        },
        events: {
          onReady: () => {
            setPlayerReady(true);
            getPlayablePlayer(playerRef.current)?.setPlaybackRate(speed);
          },
        },
      });
    });

    return () => {
      cancelled = true;
      setPlayerReady(false);
      if (typeof playerRef.current?.destroy === "function") playerRef.current.destroy();
      playerRef.current = null;
    };
  }, [selectedTalk.id, selectedTalk.youtubeId]);

  useEffect(() => {
    getPlayablePlayer(playerRef.current)?.setPlaybackRate(speed);
  }, [speed]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const player = playerRef.current;
      const playablePlayer = getPlayablePlayer(player);
      if (!playerReady || !playablePlayer || !selectedSegment) return;

      const time = playablePlayer.getCurrentTime();
      setCurrentTime(time);

      const activeIndex = selectedTalk.segments.findIndex(
        (segment) => time >= segment.start && time < segment.end,
      );
      if (activeIndex >= 0 && activeIndex !== selectedIndex && !favoritesOnly) {
        setSelectedIndex(activeIndex);
      }

      if (time >= selectedSegment.end - 0.08) {
        if (loopCurrent) {
          playablePlayer.seekTo(selectedSegment.start, true);
          playablePlayer.playVideo();
        } else if (autoAdvance && selectedIndex < selectedTalk.segments.length - 1) {
          const nextIndex = selectedIndex + 1;
          const next = selectedTalk.segments[nextIndex];
          setSelectedIndex(nextIndex);
          playablePlayer.seekTo(next.start, true);
          playablePlayer.playVideo();
        } else {
          playablePlayer.pauseVideo();
        }
      }
    }, 300);

    return () => window.clearInterval(timer);
  }, [autoAdvance, favoritesOnly, loopCurrent, playerReady, selectedIndex, selectedSegment, selectedTalk]);

  function chooseTalk(talkId: string) {
    setSelectedTalkId(talkId);
    setSelectedIndex(0);
    setCurrentTime(0);
    setHiddenEnglish(new Set());
    setHiddenChinese(new Set());
  }

  function playSegment(index: number) {
    const segment = selectedTalk.segments[index];
    if (!segment) return;
    const player = getPlayablePlayer(playerRef.current);
    if (!player) return;
    setSelectedIndex(index);
    player.seekTo(segment.start, true);
    player.setPlaybackRate(speed);
    player.playVideo();
  }

  function stepSegment(delta: number) {
    const nextIndex = Math.max(0, Math.min(selectedTalk.segments.length - 1, selectedIndex + delta));
    playSegment(nextIndex);
  }

  function toggleFavorite(segment: Segment) {
    const key = `${selectedTalk.id}:${segment.id}`;
    setFavorites((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleTalkFavorite(talkId: string) {
    setTalkFavorites((current) => {
      const next = new Set(current);
      if (next.has(talkId)) next.delete(talkId);
      else next.add(talkId);
      return next;
    });
  }

  function toggleHidden(setter: (value: Set<string>) => void, current: Set<string>, id: string) {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setter(next);
  }

  async function importTalk() {
    setImportError("");
    const english = parseVtt(importForm.englishVtt);
    const chinese = parseVtt(importForm.chineseVtt);

    if (!importForm.title.trim() || !importForm.youtubeId.trim() || english.length === 0) {
      setImportError("Title, YouTube ID/URL, and English VTT/SRT content are required.");
      return;
    }

    const id = `${importForm.title}-${Date.now()}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

    const imported: ImportedTalk = {
      id,
      title: importForm.title.trim(),
      speaker: importForm.speaker.trim() || "Unknown speaker",
      topic: importForm.topic.trim() || "Custom",
      year: Number(importForm.year) || new Date().getFullYear(),
      duration: importForm.duration.trim() || formatTime(english[english.length - 1].end),
      level: "Intermediate",
      tedUrl: importForm.tedUrl.trim() || "https://www.ted.com/talks",
      youtubeId: normalizeYoutubeId(importForm.youtubeId),
      attribution:
        "Imported by the user. Confirm that the transcript/video usage is authorized for your use case.",
      notice:
        "Imported material is stored locally in this browser unless you export it into the project data files.",
      importedAt: new Date().toISOString(),
      segments: english.map((segment, index) => ({
        ...segment,
        id: `${id}-${index + 1}`,
        translation: chinese[index]?.text || "",
      })),
    };

    await saveImportedTalks([imported]);
    const next = [imported, ...customTalks.filter((talk) => talk.id !== imported.id)];
    setCustomTalks(next);
    setDataStatus(`${next.length} personal talks loaded from browser storage/data pack`);
    setSelectedTalkId(imported.id);
    setSelectedIndex(0);
    setImportOpen(false);
  }

  async function importJsonFile(file: File) {
    setImportError("");
    setIsImportingJson(true);
    try {
      const payload = JSON.parse(await file.text()) as Talk | Talk[] | { talks: Talk[] };
      const rawTalks = Array.isArray(payload) ? payload : "talks" in payload ? payload.talks : [payload];
      const imported = rawTalks
        .filter((talk) => talk.id && talk.title && talk.youtubeId && Array.isArray(talk.segments))
        .map((talk) => ({
          ...talk,
          importedAt: new Date().toISOString(),
        })) as ImportedTalk[];

      if (imported.length === 0) {
        setImportError("No valid talks found. Expected a Talk object, an array, or { talks: [...] }.");
        return;
      }

      await saveImportedTalks(imported);
      const merged = new Map<string, ImportedTalk>();
      [...imported, ...customTalks].forEach((talk) => merged.set(talk.id, talk));
      const next = [...merged.values()];
      setCustomTalks(next);
      setSelectedTalkId(imported[0].id);
      setSelectedIndex(0);
      setDataStatus(`${next.length} personal talks loaded from browser storage/data pack`);
    } catch {
      setImportError("Could not parse that JSON file.");
    } finally {
      setIsImportingJson(false);
    }
  }

  async function removeCurrentCustomTalk() {
    const isSeed = seedTalks.some((talk) => talk.id === selectedTalk.id);
    if (isSeed) return;
    await deleteImportedTalk(selectedTalk.id);
    const next = customTalks.filter((talk) => talk.id !== selectedTalk.id);
    setCustomTalks(next);
    setSelectedTalkId(seedTalks[0].id);
    setSelectedIndex(0);
    setDataStatus(
      next.length > 0
        ? `${next.length} personal talks loaded from browser storage/data pack`
        : "Starter catalog loaded",
    );
  }

  async function clearPersonalData() {
    await clearImportedTalks();
    setCustomTalks([]);
    setSelectedTalkId(seedTalks[0].id);
    setSelectedIndex(0);
    setDataStatus("Starter catalog loaded");
  }

  function exportExample() {
    const blob = new Blob([JSON.stringify(selectedTalk, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${selectedTalk.id}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="appShell">
      <aside className="libraryPane" aria-label="Talk library">
        <div className="brandBlock">
          <div className="brandMark" aria-hidden="true">
            <BookOpen size={22} />
          </div>
          <div>
            <h1>Talk Listening Lab</h1>
            <p>Sentence drills for English listening</p>
          </div>
        </div>

        <label className="searchBox">
          <Search size={18} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search talks, speakers, topics"
          />
        </label>

        <div className="sidebarActions">
          <button className="secondaryButton" type="button" onClick={() => setImportOpen(true)}>
            <FileUp size={17} />
            Import data
          </button>
          <button
            className={`iconToggle ${favoritesOnly ? "active" : ""}`}
            type="button"
            onClick={() => setFavoritesOnly((value) => !value)}
            title="Show favorites only"
            aria-label="Show favorites only"
          >
            <Star size={17} />
          </button>
        </div>

        <div className="dataStatus">
          <Upload size={15} />
          <span>{dataStatus}</span>
        </div>

        <div className="talkList">
          {filteredTalks.map((talk) => (
            <button
              key={talk.id}
              className={`talkCard ${talk.id === selectedTalk.id ? "selected" : ""}`}
              type="button"
              onClick={() => chooseTalk(talk.id)}
            >
              <span className="talkTopic">{talk.topic}</span>
              <strong>{talk.title}</strong>
              <span>{talk.speaker}</span>
              <span className="talkMeta">
                {talk.year} · {talk.duration} · {talk.level}
              </span>
            </button>
          ))}
        </div>
      </aside>

      <section className="workspace">
        <header className="topBar">
          <div>
            <span className="eyebrow">Current talk</span>
            <h2>{selectedTalk.title}</h2>
            <p>
              {selectedTalk.speaker} · {selectedTalk.topic} · {selectedTalk.level}
            </p>
          </div>
          <div className="topActions">
            <button
              className={`iconToggle ${talkFavorites.has(selectedTalk.id) ? "active" : ""}`}
              type="button"
              onClick={() => toggleTalkFavorite(selectedTalk.id)}
              title="Favorite this talk"
              aria-label="Favorite this talk"
            >
              <Star size={17} fill={talkFavorites.has(selectedTalk.id) ? "currentColor" : "none"} />
            </button>
            <a className="linkButton" href={selectedTalk.tedUrl} target="_blank" rel="noreferrer">
              <Link size={17} />
              TED page
            </a>
            <button className="secondaryButton" type="button" onClick={exportExample}>
              <Download size={17} />
              Export JSON
            </button>
            {!seedTalks.some((talk) => talk.id === selectedTalk.id) && (
              <button
                className="secondaryButton dangerButton"
                type="button"
                onClick={removeCurrentCustomTalk}
              >
                <Trash2 size={17} />
                Remove
              </button>
            )}
          </div>
        </header>

        <section className="playerBand">
          <div className="playerFrame">
            <div className="playerMount" ref={playerHostRef} />
          </div>

          <div className="controlPanel">
            <div className="sentenceCounter">
              <span>Sentence</span>
              <strong>
                {selectedIndex + 1}/{selectedTalk.segments.length}
              </strong>
              <small>{formatTime(currentTime)}</small>
            </div>

            <div className="transport">
              <button
                className="roundButton"
                type="button"
                onClick={() => stepSegment(-1)}
                title="Previous sentence"
                aria-label="Previous sentence"
              >
                <ChevronLeft />
              </button>
              <button
                className="primaryRound"
                type="button"
                onClick={() => playSegment(selectedIndex)}
                title="Play current sentence"
                aria-label="Play current sentence"
              >
                <Play />
              </button>
              <button
                className="roundButton"
                type="button"
                onClick={() => getPlayablePlayer(playerRef.current)?.pauseVideo()}
                title="Pause"
                aria-label="Pause"
              >
                <Pause />
              </button>
              <button
                className="roundButton"
                type="button"
                onClick={() => stepSegment(1)}
                title="Next sentence"
                aria-label="Next sentence"
              >
                <ChevronRight />
              </button>
            </div>

            <label className="speedControl">
              <Settings2 size={17} />
              <span>{speed.toFixed(2)}x</span>
              <input
                aria-label="Playback speed"
                type="range"
                min="0.5"
                max="2"
                step="0.25"
                value={speed}
                onChange={(event) => setSpeed(Number(event.target.value))}
              />
            </label>

            <div className="speedChips">
              {SPEEDS.map((rate) => (
                <button
                  key={rate}
                  className={rate === speed ? "selectedChip" : ""}
                  type="button"
                  onClick={() => setSpeed(rate)}
                >
                  {rate}x
                </button>
              ))}
            </div>

            <div className="toggles">
              <button
                className={`pillToggle ${loopCurrent ? "active" : ""}`}
                type="button"
                onClick={() => setLoopCurrent((value) => !value)}
              >
                <Repeat size={16} />
                Loop
              </button>
              <button
                className={`pillToggle ${autoAdvance ? "active" : ""}`}
                type="button"
                onClick={() => setAutoAdvance((value) => !value)}
              >
                <Check size={16} />
                Auto
              </button>
              <button
                className={`pillToggle ${showEnglish ? "active" : ""}`}
                type="button"
                onClick={() => setShowEnglish((value) => !value)}
              >
                {showEnglish ? <Eye size={16} /> : <EyeOff size={16} />}
                EN
              </button>
              <button
                className={`pillToggle ${showChinese ? "active" : ""}`}
                type="button"
                onClick={() => setShowChinese((value) => !value)}
              >
                {showChinese ? <Eye size={16} /> : <EyeOff size={16} />}
                中文
              </button>
            </div>

            <p className="noticeText">{selectedTalk.notice}</p>
          </div>
        </section>

        <section className="sentencePanel" aria-label="Sentence list">
          <div className="panelHeader">
            <div>
              <span className="eyebrow">Sentence list</span>
              <h3>Listen, hide, repeat, save</h3>
            </div>
            <span className="attribution">{selectedTalk.attribution}</span>
          </div>

          <div className="sentences">
            {visibleSegments.map((segment) => {
              const originalIndex = selectedTalk.segments.findIndex((item) => item.id === segment.id);
              const isActive = originalIndex === selectedIndex;
              const favoriteKey = `${selectedTalk.id}:${segment.id}`;
              const englishVisible = showEnglish && !hiddenEnglish.has(segment.id);
              const chineseVisible = showChinese && !hiddenChinese.has(segment.id);

              return (
                <article className={`sentenceRow ${isActive ? "active" : ""}`} key={segment.id}>
                  <button
                    className="rowPlay"
                    type="button"
                    onClick={() => playSegment(originalIndex)}
                    title="Play this sentence"
                    aria-label="Play this sentence"
                  >
                    <Play size={18} />
                  </button>
                  <div className="rowBody">
                    <div className="rowMeta">
                      <span>#{originalIndex + 1}</span>
                      <span>
                        {formatTime(segment.start)} - {formatTime(segment.end)}
                      </span>
                    </div>
                    <p className={englishVisible ? "sentenceText" : "maskedText"}>
                      {englishVisible ? segment.text : "English hidden"}
                    </p>
                    <p className={chineseVisible ? "translationText" : "maskedText"}>
                      {chineseVisible ? segment.translation || "No Chinese translation" : "中文已隐藏"}
                    </p>
                  </div>
                  <div className="rowActions">
                    <button
                      className="miniIcon"
                      type="button"
                      onClick={() => toggleFavorite(segment)}
                      title="Favorite"
                      aria-label="Favorite"
                    >
                      <Heart
                        size={18}
                        fill={favorites.has(favoriteKey) ? "currentColor" : "none"}
                      />
                    </button>
                    <button
                      className="miniIcon"
                      type="button"
                      onClick={() => toggleHidden(setHiddenEnglish, hiddenEnglish, segment.id)}
                      title="Toggle English"
                      aria-label="Toggle English"
                    >
                      {hiddenEnglish.has(segment.id) ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                    <button
                      className="miniIcon"
                      type="button"
                      onClick={() => toggleHidden(setHiddenChinese, hiddenChinese, segment.id)}
                      title="Toggle Chinese"
                      aria-label="Toggle Chinese"
                    >
                      {hiddenChinese.has(segment.id) ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      </section>

      {importOpen && (
        <div className="modalLayer" role="dialog" aria-modal="true" aria-label="Import talk">
          <section className="importModal">
            <div className="modalHeader">
              <div>
                <span className="eyebrow">Import</span>
                <h3>Add personal TED study data</h3>
              </div>
              <button
                className="miniIcon"
                type="button"
                onClick={() => setImportOpen(false)}
                title="Close"
                aria-label="Close"
              >
                <X />
              </button>
            </div>

            <label className="jsonDrop">
              <Plus size={18} />
              <span>
                Upload a generated JSON catalog
                <small>Accepts one talk, an array of talks, or {"{ talks: [...] }"}</small>
              </span>
              <input
                type="file"
                accept="application/json,.json"
                disabled={isImportingJson}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void importJsonFile(file);
                  event.currentTarget.value = "";
                }}
              />
            </label>

            <div className="importGrid">
              <label>
                Title
                <input
                  value={importForm.title}
                  onChange={(event) => setImportForm({ ...importForm, title: event.target.value })}
                />
              </label>
              <label>
                Speaker
                <input
                  value={importForm.speaker}
                  onChange={(event) => setImportForm({ ...importForm, speaker: event.target.value })}
                />
              </label>
              <label>
                Topic
                <input
                  value={importForm.topic}
                  onChange={(event) => setImportForm({ ...importForm, topic: event.target.value })}
                />
              </label>
              <label>
                Year
                <input
                  value={importForm.year}
                  onChange={(event) => setImportForm({ ...importForm, year: event.target.value })}
                />
              </label>
              <label>
                TED URL
                <input
                  value={importForm.tedUrl}
                  onChange={(event) => setImportForm({ ...importForm, tedUrl: event.target.value })}
                />
              </label>
              <label>
                YouTube ID or URL
                <input
                  value={importForm.youtubeId}
                  onChange={(event) =>
                    setImportForm({ ...importForm, youtubeId: event.target.value })
                  }
                />
              </label>
            </div>

            <label className="wideLabel">
              English VTT/SRT
              <textarea
                value={importForm.englishVtt}
                onChange={(event) => setImportForm({ ...importForm, englishVtt: event.target.value })}
                placeholder={"00:00:01.000 --> 00:00:04.000\nPaste one caption block here..."}
              />
            </label>

            <label className="wideLabel">
              Chinese VTT/SRT
              <textarea
                value={importForm.chineseVtt}
                onChange={(event) => setImportForm({ ...importForm, chineseVtt: event.target.value })}
                placeholder={"00:00:01.000 --> 00:00:04.000\n在这里粘贴对应中文字幕..."}
              />
            </label>

            {importError && <p className="errorText">{importError}</p>}

            <div className="modalActions">
              <button className="secondaryButton dangerButton" type="button" onClick={clearPersonalData}>
                <Trash2 size={17} />
                Clear personal data
              </button>
              <a className="linkButton" href="https://www.ted.com/talks" target="_blank" rel="noreferrer">
                <Library size={17} />
                TED library
              </a>
              <button className="primaryButton" type="button" onClick={importTalk}>
                <Upload size={17} />
                Import locally
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
