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

export interface CardDef {
  index: number;
  name: string;
  englishName: string;
  img: string;
}

export const CARDS: CardDef[] = [
  { index: 0, name: "पतंग", englishName: "PATANG", img: kite },
  { index: 1, name: "छत्री", englishName: "CHHATRI", img: umbrella },
  { index: 2, name: "बॉल", englishName: "BALL", img: ball },
  { index: 3, name: "सूर्य", englishName: "SURYA", img: sun },
  { index: 4, name: "गुलाब", englishName: "GULAB", img: rose },
  { index: 5, name: "दिवा", englishName: "DIWA", img: diya },
  { index: 6, name: "फुलपाखरू", englishName: "PHULPAKHARU", img: butterfly },
  { index: 7, name: "चिमणी", englishName: "CHIMANI", img: sparrow },
  { index: 8, name: "ससा", englishName: "SASA", img: rabbit },
  { index: 9, name: "भोवरा", englishName: "BHOVARA", img: top },
  { index: 10, name: "बादली", englishName: "BADLI", img: bucket },
  { index: 11, name: "गाय", englishName: "GAAY", img: cow },
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
  for (const [hindi, roman] of Object.entries(CARD_ROMAN_MAP)) {
    if (name.includes(hindi)) {
      return `${roman} (${hindi})`;
    }
  }
  return name;
}

export function getCardByIndex(idx: number): CardDef {
  return CARDS[idx] || CARDS[0];
}

