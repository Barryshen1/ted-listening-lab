#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

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
  const cues = input
    .replace(/\r/g, "")
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .flatMap((block, index) => {
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

function usage() {
  console.error(`Usage:
node scripts/import-vtt.mjs \\
  --title "Talk title" \\
  --speaker "Speaker name" \\
  --youtube "YouTube ID or URL" \\
  --ted "https://www.ted.com/talks/..." \\
  --en ./english.vtt \\
  --zh ./chinese.vtt \\
  --out ./public/data/my-talk.json`);
  process.exit(1);
}

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i], process.argv[i + 1]);
}

const required = ["--title", "--speaker", "--youtube", "--en", "--out"];
if (required.some((key) => !args.get(key))) usage();

const enSegments = parseVtt(fs.readFileSync(args.get("--en"), "utf8"));
const zhSegments = args.get("--zh")
  ? parseVtt(fs.readFileSync(args.get("--zh"), "utf8"))
  : [];

const id = args
  .get("--title")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-|-$/g, "");

const talk = {
  id,
  title: args.get("--title"),
  speaker: args.get("--speaker"),
  year: Number(args.get("--year")) || new Date().getFullYear(),
  duration: args.get("--duration") || "",
  level: args.get("--level") || "Intermediate",
  topic: args.get("--topic") || "Custom",
  tedUrl: args.get("--ted") || "https://www.ted.com/talks",
  youtubeId: args.get("--youtube").replace(/^.*(?:v=|youtu\.be\/|embed\/)([^&?]+).*$/, "$1"),
  attribution:
    "Imported from user-provided transcript files. Confirm license and attribution before publishing.",
  notice:
    "This static data file was generated from local transcript files; it is not fetched from TED at runtime.",
  segments: enSegments.map((segment, index) => ({
    ...segment,
    id: `${id}-${index + 1}`,
    translation: zhSegments[index]?.text || "",
  })),
};

const outPath = path.resolve(args.get("--out"));
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(talk, null, 2)}\n`);
console.log(`Wrote ${talk.segments.length} segments to ${outPath}`);
