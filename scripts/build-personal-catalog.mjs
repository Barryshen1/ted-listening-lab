#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_SOURCE = "https://www.youtube.com/@TED/videos";

function usage() {
  console.log(`Build a personal subtitle catalog for Talk Listening Lab.

Requires yt-dlp in PATH.

Examples:
  npm run build:personal-catalog -- --source https://www.youtube.com/@TED/videos --limit 50 --out public/data/catalog.json
  npm run build:personal-catalog -- --source https://www.youtube.com/watch?v=iG9CE55wbtY --out ken.json

Options:
  --source   YouTube channel, playlist, or video URL. Can be repeated.
  --limit    Max videos per source. Omit for all entries found by yt-dlp.
  --out      Output JSON path. Default: public/data/catalog.json
  --topic    Topic label to apply when metadata has none.
  --level    Beginner, Intermediate, or Advanced. Default: Intermediate
  --auto     Allow auto-generated English captions when human captions are unavailable.
`);
}

function parseArgs() {
  const args = {
    sources: [],
    out: "public/data/catalog.json",
    topic: "TED",
    level: "Intermediate",
    auto: false,
    limit: undefined,
  };

  for (let i = 2; i < process.argv.length; i += 1) {
    const key = process.argv[i];
    const value = process.argv[i + 1];
    if (key === "--help" || key === "-h") {
      usage();
      process.exit(0);
    }
    if (key === "--source" && value) {
      args.sources.push(value);
      i += 1;
    } else if (key === "--out" && value) {
      args.out = value;
      i += 1;
    } else if (key === "--topic" && value) {
      args.topic = value;
      i += 1;
    } else if (key === "--level" && value) {
      args.level = value;
      i += 1;
    } else if (key === "--limit" && value) {
      args.limit = Number(value);
      i += 1;
    } else if (key === "--auto") {
      args.auto = true;
    } else {
      throw new Error(`Unknown option: ${key}`);
    }
  }

  if (args.sources.length === 0) args.sources.push(DEFAULT_SOURCE);
  return args;
}

function ytdlpJson(extraArgs) {
  const output = execFileSync("yt-dlp", extraArgs, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 1024 * 1024 * 60,
  });
  return JSON.parse(output);
}

function parseTimestamp(value) {
  const parts = value.trim().replace(",", ".").split(":").map(Number);
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return 0;
}

function mergeCuesIntoSentences(cues) {
  const sentences = [];
  let current = null;
  for (const cue of cues) {
    if (!current) {
      current = { ...cue, text: cue.text.trim() };
    } else {
      current = {
        ...current,
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

function parseVtt(input) {
  const cleaned = input.replace(/\r/g, "").replace(/^WEBVTT.*?\n\n/s, "");
  const cues = cleaned
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .flatMap((block, index) => {
      const lines = block
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      const timeIndex = lines.findIndex((line) => line.includes("-->"));
      if (timeIndex === -1) return [];
      const [startRaw, endRaw] = lines[timeIndex].split("-->").map((part) => part.trim());
      const text = lines
        .slice(timeIndex + 1)
        .join(" ")
        .replace(/<[^>]+>/g, "")
        .replace(/\s+/g, " ")
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

function formatDuration(totalSeconds = 0) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 90);
}

function pickSubtitle(subtitles, preferredLanguages) {
  if (!subtitles) return undefined;
  for (const language of preferredLanguages) {
    if (subtitles[language]?.length) {
      return subtitles[language].find((item) => item.ext === "vtt") || subtitles[language][0];
    }
  }

  const fuzzyKey = Object.keys(subtitles).find((key) =>
    preferredLanguages.some((language) => key.toLowerCase().startsWith(language.toLowerCase())),
  );
  if (!fuzzyKey) return undefined;
  return subtitles[fuzzyKey].find((item) => item.ext === "vtt") || subtitles[fuzzyKey][0];
}

async function fetchSubtitle(subtitle) {
  if (!subtitle?.url) return [];
  const response = await fetch(subtitle.url);
  if (!response.ok) return [];
  return parseVtt(await response.text());
}

function extractTedUrl(metadata) {
  const source = `${metadata.description || ""}\n${metadata.webpage_url || ""}`;
  return source.match(/https?:\/\/(?:www\.)?ted\.com\/talks\/[^\s)]+/)?.[0] || metadata.webpage_url;
}

function collectVideoRefs(source, limit) {
  const playlist = ytdlpJson(["--flat-playlist", "--dump-single-json", source]);
  const entries = Array.isArray(playlist.entries) ? playlist.entries : [];
  if (entries.length === 0) return [source];
  return entries
    .filter((entry) => entry?.id || entry?.url)
    .slice(0, limit || entries.length)
    .map((entry) => entry.url || entry.id);
}

async function buildTalk(videoRef, options) {
  const metadata = ytdlpJson([
    "--dump-single-json",
    "--skip-download",
    "--write-subs",
    "--sub-langs",
    "en.*,zh-Hans,zh-Hant,zh.*,zh-CN,zh-TW",
    "--sub-format",
    "vtt",
    ...(options.auto ? ["--write-auto-subs"] : []),
    videoRef,
  ]);

  const englishSubtitle =
    pickSubtitle(metadata.subtitles, ["en", "en-US", "en-GB"]) ||
    (options.auto ? pickSubtitle(metadata.automatic_captions, ["en", "en-US", "en-GB"]) : undefined);
  const chineseSubtitle =
    pickSubtitle(metadata.subtitles, ["zh-Hans", "zh-CN", "zh-Hant", "zh-TW", "zh"]) ||
    (options.auto
      ? pickSubtitle(metadata.automatic_captions, ["zh-Hans", "zh-CN", "zh-Hant", "zh-TW", "zh"])
      : undefined);

  const english = await fetchSubtitle(englishSubtitle);
  if (english.length === 0) {
    console.warn(`Skipped ${metadata.title || videoRef}: no English captions found`);
    return undefined;
  }

  const chinese = await fetchSubtitle(chineseSubtitle);
  const id = slugify(`${metadata.uploader || "ted"}-${metadata.title || metadata.id}`);

  return {
    id,
    title: metadata.title || "Untitled talk",
    speaker: metadata.channel || metadata.uploader || "TED",
    year: metadata.upload_date ? Number(String(metadata.upload_date).slice(0, 4)) : new Date().getFullYear(),
    duration: formatDuration(metadata.duration),
    level: options.level,
    topic: options.topic,
    tedUrl: extractTedUrl(metadata),
    youtubeId: metadata.id,
    attribution:
      "Personal study data generated from captions available with the linked public video. Keep this catalog private unless you have redistribution rights.",
    notice:
      "Generated for personal listening practice. Verify captions against the official transcript before relying on exact wording.",
    segments: english.map((segment, index) => ({
      ...segment,
      id: `${id}-${index + 1}`,
      translation: chinese[index]?.text || "",
    })),
  };
}

async function main() {
  const args = parseArgs();
  const videoRefs = args.sources.flatMap((source) => collectVideoRefs(source, args.limit));
  const talks = [];

  for (const [index, videoRef] of videoRefs.entries()) {
    console.log(`[${index + 1}/${videoRefs.length}] ${videoRef}`);
    try {
      const talk = await buildTalk(videoRef, args);
      if (talk) talks.push(talk);
    } catch (error) {
      console.warn(`Skipped ${videoRef}: ${error.message}`);
    }
  }

  const outPath = path.resolve(args.out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(
    outPath,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        sources: args.sources,
        talks,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`Wrote ${talks.length} talks to ${outPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
