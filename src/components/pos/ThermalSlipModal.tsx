import React, { useState } from "react";
import { ThermalTicket } from "@/lib/ticketStore";
import { executeDirectPrint, isDirectPrinterConnected } from "@/lib/thermalPrinter";
import { getCardDisplayName } from "@/lib/cards";
import { PrinterStatusBadge } from "./PrinterStatusBadge";

interface ThermalSlipModalProps {
  ticket: ThermalTicket | null;
  isOpen: boolean;
  onClose: () => void;
  onReprint?: () => void;
}

export function ThermalSlipModal({
  ticket,
  isOpen,
  onClose,
}: ThermalSlipModalProps) {
  const [printStatus, setPrintStatus] = useState<string | null>(null);

  if (!isOpen || !ticket) return null;

  const handlePrint = async () => {
    const paperWidth = ((typeof window !== "undefined" && localStorage.getItem("sorat_printer_width")) as any) || "58mm";
    setPrintStatus("Printing...");
    const res = await executeDirectPrint(ticket, paperWidth);
    if (res.method === "direct_bluetooth") {
      setPrintStatus("✓ Direct Slip Printed via Bluetooth!");
    } else if (res.method === "rawbt") {
      setPrintStatus("✓ Sent to Thermal Printer (RawBT)!");
    } else {
      setPrintStatus(null);
    }
  };

  return (
    <>
      {/* ============================================================== */}
      {/* ON-SCREEN MODAL PREVIEW                                        */}
      {/* ============================================================== */}
      <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 no-print">
        <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-4 shadow-2xl space-y-3 animate-in fade-in zoom-in-95">
          <div className="flex items-center justify-between border-b border-border/60 pb-2">
            <div className="flex items-center gap-2">
              <span className="text-xl">🖨️</span>
              <div>
                <h3 className="font-display text-sm font-black text-foreground">
                  Bet Slip Generated (पर्ची)
                </h3>
                <span className="text-[10px] text-muted-foreground block">
                  Ticket #{ticket.ticketId}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <PrinterStatusBadge showTextOnMobile={false} />
              <button
                type="button"
                onClick={onClose}
                className="text-muted-foreground hover:text-foreground text-sm p-1 rounded-lg hover:bg-muted"
              >
                ✕
              </button>
            </div>
          </div>

          {/* Realistic Paper Thermal Receipt Card */}
          <div className="bg-white text-black p-3.5 rounded-xl border border-zinc-300 font-mono text-[11px] leading-tight space-y-2 shadow-inner select-all">
            <div className="text-center border-b border-dashed border-zinc-400 pb-2">
              <div className="font-black text-sm tracking-wider">SORAT LIVE ARENA</div>
            </div>

            <div className="space-y-1 text-[10px] pt-1">
              <div className="flex justify-between">
                <span className="text-zinc-600">Ticket No:</span>
                <span className="font-bold">{ticket.ticketId}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-600">Date & Time:</span>
                <span>{ticket.dateStr} {ticket.timeStr}</span>
              </div>
              <div className="flex justify-between font-bold">
                <span className="text-zinc-600">Round No:</span>
                <span className="bg-zinc-200 px-1 rounded">{ticket.roundId}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-600">Customer:</span>
                <span className="font-bold">{ticket.customerName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-600">Counter:</span>
                <span>{ticket.agentName}</span>
              </div>
            </div>

            {/* Table of Bet Items */}
            <div className="border-t border-b border-dashed border-zinc-400 py-1.5 my-1.5 space-y-1">
              <div className="flex justify-between font-black text-[10px] text-zinc-700">
                <span>PICTURE / CARD</span>
                <span>BET (₹)</span>
              </div>
              {ticket.items.map((item, i) => (
                <div key={i} className="flex justify-between font-bold text-[11px]">
                  <span>{i + 1}. {getCardDisplayName(item.cardName)}</span>
                  <span>₹{item.amount}</span>
                </div>
              ))}
            </div>

            {/* Totals */}
            <div className="space-y-1 text-[11px]">
              <div className="flex justify-between font-black text-xs">
                <span>TOTAL STAKE:</span>
                <span>₹{ticket.totalAmount}</span>
              </div>
            </div>

            {/* Barcode & Verification */}
            <div className="text-center pt-2 border-t border-dashed border-zinc-400 space-y-0.5">
              <div className="font-mono text-base tracking-[0.25em] font-black">
                ||| | ||||| || ||| ||||
              </div>
              <div className="text-[9px] text-zinc-600 tracking-wider">
                *{ticket.barcode}*
              </div>
            </div>
          </div>

          {printStatus && (
            <div className="rounded-xl bg-emerald-500/15 border border-emerald-500/40 p-2 text-center text-xs font-bold text-emerald-400">
              {printStatus}
            </div>
          )}

          {/* Action Buttons */}
          <div className="space-y-2 pt-1">
            <button
              type="button"
              onClick={handlePrint}
              className="w-full py-2.5 px-4 rounded-xl bg-primary text-primary-foreground font-display text-xs font-black shadow-gold hover:opacity-90 transition active:scale-95 flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <span>🖨️</span>
              <span>{isDirectPrinterConnected() ? "DIRECT PRINT (NO DIALOG)" : "PRINT THERMAL PARCHI"}</span>
            </button>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  if (typeof window !== "undefined") window.print();
                }}
                className="flex-1 py-2 px-3 rounded-xl border border-border bg-card hover:bg-muted text-muted-foreground hover:text-foreground text-[11px] font-bold transition flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <span>📱</span>
                <span>System Print / PDF</span>
              </button>
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl bg-muted text-muted-foreground hover:text-foreground text-xs font-bold transition cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ============================================================== */}
      {/* 58MM / 80MM DIRECT THERMAL PRINTER PRINT TARGET                */}
      {/* Only visible during window.print() execution                   */}
      {/* ============================================================== */}
      <div className="thermal-slip-print-area">
        <div style={{ textAlign: "center", borderBottom: "1px dashed #000", paddingBottom: "4px", marginBottom: "4px" }}>
          <div style={{ fontWeight: 900, fontSize: "14px", letterSpacing: "1px" }}>SORAT LIVE ARENA</div>
        </div>

        <div style={{ fontSize: "10px", lineHeight: 1.3 }}>
          <div>TICKET : {ticket.ticketId}</div>
          <div>DATE   : {ticket.dateStr} {ticket.timeStr}</div>
          <div style={{ fontWeight: 900 }}>ROUND  : {ticket.roundId}</div>
          <div>CLIENT : {ticket.customerName}</div>
          <div>KIOSK  : {ticket.agentName}</div>
        </div>

        <div style={{ borderTop: "1px dashed #000", borderBottom: "1px dashed #000", margin: "5px 0", padding: "4px 0" }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontWeight: "bold", fontSize: "10px" }}>
            <span>PICTURE / CARD</span>
            <span>AMOUNT (Rs)</span>
          </div>
          {ticket.items.map((item, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", fontWeight: "bold" }}>
              <span>{i + 1}. {getCardDisplayName(item.cardName)}</span>
              <span>Rs {item.amount}</span>
            </div>
          ))}
        </div>

        <div style={{ fontSize: "11px", fontWeight: "bold" }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", fontWeight: 900 }}>
            <span>TOTAL BET:</span>
            <span>Rs {ticket.totalAmount}</span>
          </div>
        </div>

        <div style={{ textAlign: "center", borderTop: "1px dashed #000", marginTop: "6px", paddingTop: "5px" }}>
          <div style={{ letterSpacing: "3px", fontWeight: 900, fontSize: "14px" }}>
            ||| | ||||| || |||
          </div>
          <div style={{ fontSize: "9px" }}>*{ticket.barcode}*</div>
        </div>
      </div>
    </>
  );
}

