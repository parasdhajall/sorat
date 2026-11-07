import kite from "@/assets/kite.jpg";
import umbrella from "@/assets/umbrella.jpg";
import ball from "@/assets/ball.jpg";
import sun from "@/assets/sun.jpg";
import rose from "@/assets/rose.jpg";
import diya from "@/assets/diya.jpg";
import butterfly from "@/assets/butterfly.jpg";
import sparrow from "@/assets/sparrow.jpg";
import rabbit from "@/assets/rabbit.jpg";
import top from "@/assets/top.jpg";
import bucket from "@/assets/bucket.jpg";
import cow from "@/assets/cow.jpg";
import { getSynchronizedRoundState, getDeterministicRoundWinner } from "./realtime";

export interface CardDef {
  index: number;
  name: string;
  englishName: string;
  symbol: string;
  img: string;
}

export const CARDS: CardDef[] = [
  { index: 0, name: "पतंग", englishName: "PATANG", symbol: "🪁", img: kite },
  { index: 1, name: "छत्री", englishName: "CHHATRI", symbol: "☂️", img: umbrella },
  { index: 2, name: "बॉल", englishName: "BALL", symbol: "⚽", img: ball },
  { index: 3, name: "सूर्य", englishName: "SURYA", symbol: "☀️", img: sun },
  { index: 4, name: "गुलाब", englishName: "GULAB", symbol: "🌹", img: rose },
  { index: 5, name: "दिवा", englishName: "DIWA", symbol: "🪔", img: diya },
  { index: 6, name: "फुलपाखरू", englishName: "PHULPAKHARU", symbol: "🦋", img: butterfly },
  { index: 7, name: "चिमणी", englishName: "CHIMANI", symbol: "🐦", img: sparrow },
  { index: 8, name: "ससा", englishName: "SASA", symbol: "🐰", img: rabbit },
  { index: 9, name: "भोवरा", englishName: "BHOVARA", symbol: "🪀", img: top },
  { index: 10, name: "बादली", englishName: "BADLI", symbol: "🪣", img: bucket },
  { index: 11, name: "गाय", englishName: "GAAY", symbol: "🐄", img: cow },
];

export const CARD_ROMAN_MAP: Record<string, string> = {
  "पतंग": "PATANG",
  "छत्री": "CHHATRI",
  "बॉल": "BALL",
  "सूर्य": "SURYA",
  "गुलाब": "GULAB",
  "दिवा": "DIWA",
  "फुलपाखरू": "PHULPAKHARU",
  "चिमणी": "CHIMANI",
  "ससा": "SASA",
  "भोवरा": "BHOVARA",
  "बादली": "BADLI",
  "गाय": "GAAY",
};

export const CARD_SYMBOL_MAP: Record<string, string> = {
  "पतंग": "🪁",
  "छत्री": "☂️",
  "बॉल": "⚽",
  "सूर्य": "☀️",
  "गुलाब": "🌹",
  "दिवा": "🪔",
  "फुलपाखरू": "🦋",
  "चिमणी": "🐦",
  "ससा": "🐰",
  "भोवरा": "🪀",
  "बादली": "🪣",
  "गाय": "🐄",
  "PATANG": "🪁",
  "CHHATRI": "☂️",
  "BALL": "⚽",
  "SURYA": "☀️",
  "GULAB": "🌹",
  "DIWA": "🪔",
  "PHULPAKHARU": "🦋",
  "CHIMANI": "🐦",
  "SASA": "🐰",
  "BHOVARA": "🪀",
  "BADLI": "🪣",
  "GAAY": "🐄",
};

export function getCardSymbol(name: string): string {
  if (!name) return "🎯";
  for (const [k, sym] of Object.entries(CARD_SYMBOL_MAP)) {
    if (name.includes(k)) return sym;
  }
  return "🎯";
}

export function getCardPureRoman(name: string): string {
  if (!name) return "CARD";
  for (const [hindi, roman] of Object.entries(CARD_ROMAN_MAP)) {
    if (name.includes(hindi)) {
      return roman;
    }
  }
  // If already english
  const clean = name.replace(/[^\x20-\x7E]/g, "").trim();
  return clean || "CARD";
}

export function getCardDisplayName(name: string): string {
  if (!name) return "CARD";
  const sym = getCardSymbol(name);
  for (const [hindi, roman] of Object.entries(CARD_ROMAN_MAP)) {
    if (name.includes(hindi)) {
      return `${sym} ${roman} (${hindi})`;
    }
  }
  return `${sym} ${name}`;
}

export function getCardByIndex(idx: number): CardDef {
  const c = CARDS[idx] ?? CARDS[0];
  if (!c) throw new Error("CARDS array empty");
  return c;
}

export interface RoundHistoryItem {
  roundNumber: number;
  roundId: string;
  cardIndex: number;
  card: CardDef;
  timeStr: string;
}

export function getPastRoundsHistory(count: number = 40): RoundHistoryItem[] {
  const sync = getSynchronizedRoundState();
  const currentRound = sync.roundNumber;
  const history: RoundHistoryItem[] = [];

  let savedHistory: Record<number, number> = {};
  if (typeof window !== "undefined") {
    try {
      const raw = localStorage.getItem("sorat_round_winners_history");
      if (raw) savedHistory = JSON.parse(raw);
    } catch {}
  }

  // Include current round if it has reached result phase
  const startOffset = sync.phase === "result" ? 0 : 1;

  for (let i = startOffset; i < startOffset + count; i++) {
    const rNum = currentRound - i;
    if (rNum <= 0) break;

    const winIdx = savedHistory[rNum] ?? getDeterministicRoundWinner(rNum);
    const card = getCardByIndex(winIdx);

    const mins = Math.max(0, rNum - 1);
    const hours = Math.floor(mins / 60) % 24;
    const remMins = mins % 60;
    const h12 = hours % 12 || 12;
    const ampm = hours < 12 ? "AM" : "PM";
    const timeStr = `${String(h12).padStart(2, "0")}:${String(remMins).padStart(2, "0")} ${ampm}`;

    history.push({
      roundNumber: rNum,
      roundId: `#${String(rNum).padStart(4, "0")}`,
      cardIndex: winIdx,
      card,
      timeStr,
    });
  }

  return history;
}

export function getRecordedRoundWinner(roundNumber: number): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem("sorat_round_winners_history");
    if (raw) {
      const map = JSON.parse(raw);
      if (typeof map[roundNumber] === "number") {
        return map[roundNumber];
      }
    }
  } catch {}
  return null;
}

export function recordRoundWinnerHistory(roundNumber: number, winnerCardIndex: number): void {
  if (typeof window === "undefined") return;
  try {
    const raw = localStorage.getItem("sorat_round_winners_history");
    const map = raw ? JSON.parse(raw) : {};
    map[roundNumber] = winnerCardIndex;
    localStorage.setItem("sorat_round_winners_history", JSON.stringify(map));
  } catch {}
}

