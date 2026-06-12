export type Segment = {
  id: string;
  start: number;
  end: number;
  text: string;
  translation?: string;
};

export type Talk = {
  id: string;
  title: string;
  speaker: string;
  year: number;
  duration: string;
  level: "Beginner" | "Intermediate" | "Advanced";
  topic: string;
  tedUrl: string;
  youtubeId: string;
  attribution: string;
  notice: string;
  segments: Segment[];
};

export type ImportedTalk = Talk & {
  importedAt: string;
};
