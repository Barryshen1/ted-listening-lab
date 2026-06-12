import type { Talk } from "../types";

export const seedTalks: Talk[] = [
  {
    id: "sir-ken-robinson-creativity",
    title: "Do schools kill creativity?",
    speaker: "Sir Ken Robinson",
    year: 2006,
    duration: "20:04",
    level: "Intermediate",
    topic: "Education",
    tedUrl: "https://www.ted.com/talks/sir_ken_robinson_do_schools_kill_creativity",
    youtubeId: "iG9CE55wbtY",
    attribution:
      "Video streamed from the official TED YouTube/TED page. Copyright TED Conferences; use subject to TED's Creative Commons BY-NC-ND policy.",
    notice:
      "Starter exercise text is a short, non-official practice scaffold. Import an authorized transcript/VTT for exact sentence-level study.",
    segments: [
      {
        id: "skr-1",
        start: 0,
        end: 22,
        text: "Warm up: listen for how the speaker opens with humor before moving into the main idea.",
        translation: "热身：听出演讲者如何先用幽默开场，再进入核心观点。",
      },
      {
        id: "skr-2",
        start: 22,
        end: 49,
        text: "Focus on the contrast between creativity, education, and the future.",
        translation: "重点听 creativity、education 和 future 之间的对比关系。",
      },
      {
        id: "skr-3",
        start: 49,
        end: 84,
        text: "Shadow the rhythm: short setup, pause, then a punch line or observation.",
        translation: "跟读节奏：短铺垫、停顿，然后给出笑点或观察。",
      },
      {
        id: "skr-4",
        start: 84,
        end: 126,
        text: "Listen for examples that make an abstract education argument concrete.",
        translation: "注意听他如何用例子把抽象的教育观点讲具体。",
      },
    ],
  },
  {
    id: "amy-cuddy-body-language",
    title: "Your body language may shape who you are",
    speaker: "Amy Cuddy",
    year: 2012,
    duration: "21:03",
    level: "Advanced",
    topic: "Psychology",
    tedUrl: "https://www.ted.com/talks/amy_cuddy_your_body_language_may_shape_who_you_are",
    youtubeId: "Ks-_Mh1QhMc",
    attribution:
      "Video streamed from the official TED YouTube/TED page. Copyright TED Conferences; use subject to TED's Creative Commons BY-NC-ND policy.",
    notice:
      "Starter exercise text is a short, non-official practice scaffold. Import an authorized transcript/VTT for exact sentence-level study.",
    segments: [
      {
        id: "ac-1",
        start: 0,
        end: 35,
        text: "Before reading, listen once for the speaker's question and the audience setup.",
        translation: "先不看原文，听出演讲者提出的问题和给观众设置的场景。",
      },
      {
        id: "ac-2",
        start: 35,
        end: 76,
        text: "Now focus on key words about posture, confidence, and how people judge each other.",
        translation: "现在重点听 posture、confidence 以及人们如何互相判断。",
      },
      {
        id: "ac-3",
        start: 76,
        end: 118,
        text: "Repeat the segment at a slower speed and mark phrases you can reuse in speaking.",
        translation: "用较慢速度重复这一段，标出你口语里能复用的表达。",
      },
      {
        id: "ac-4",
        start: 118,
        end: 165,
        text: "Turn off the Chinese translation and summarize the claim in one English sentence.",
        translation: "关闭中文翻译，用一句英文总结这一段的主张。",
      },
    ],
  },
];
