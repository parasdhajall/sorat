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
  img: string;
}

export const CARDS: CardDef[] = [
  { index: 0, name: "पतंग", img: kite },
  { index: 1, name: "छत्री", img: umbrella },
  { index: 2, name: "बॉल", img: ball },
  { index: 3, name: "सूर्य", img: sun },
  { index: 4, name: "गुलाब", img: rose },
  { index: 5, name: "दिवा", img: diya },
  { index: 6, name: "फुलपाखरू", img: butterfly },
  { index: 7, name: "चिमणी", img: sparrow },
  { index: 8, name: "ससा", img: rabbit },
  { index: 9, name: "भोवरा", img: top },
  { index: 10, name: "बादली", img: bucket },
  { index: 11, name: "गाय", img: cow },
];

export function getCardByIndex(idx: number): CardDef {
  return CARDS[idx] || CARDS[0];
}

