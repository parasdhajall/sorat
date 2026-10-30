import React, { useState } from "react";
import {
  connectBluetoothDirect,
  isDirectPrinterConnected,
  getActivePrinterName,
} from "@/lib/thermalPrinter";

interface PrinterSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onTestPrint: () => void;
}

export function PrinterSettingsModal({
  isOpen,
  onClose,
  onTestPrint,
}: PrinterSettingsModalProps) {
  const [printerName, setPrinterName] = useState<string>(() => getActivePrinterName());

  const [paperWidth, setPaperWidth] = useState<"58mm" | "80mm">(() => {
    if (typeof window !== "undefined") {
      return (localStorage.getItem("sorat_printer_width") as any) || "58mm";
    }
    return "58mm";
  });

  const [autoPrint, setAutoPrint] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("sorat_auto_print") !== "false";
    }
    return true;
  });

  const [isScanning, setIsScanning] = useState(false);
  const [scanMessage, setScanMessage] = useState<string | null>(null);
  const [activeTabGuide, setActiveTabGuide] = useState<"bluetooth" | "kiosk">("bluetooth");

  if (!isOpen) return null;

  const handleScanBluetooth = async () => {
    setScanMessage(null);
    setIsScanning(true);

    try {
      const res = await connectBluetoothDirect();
      if (res.success) {
        setPrinterName(res.deviceName);
        setScanMessage(`✓ Connected directly to "${res.deviceName}"! Ab bina print preview dialog ke direct print aayega.`);
      } else {
        setScanMessage(res.error || "Bluetooth printer connect nahi ho saka. Phone Bluetooth Settings check karein.");
      }
    } catch (err: any) {
      setScanMessage(`ℹ️ Error: ${err.message}`);
    } finally {
      setIsScanning(false);
    }
  };

  const handleSaveSettings = () => {
    localStorage.setItem("sorat_printer_name", printerName);
    localStorage.setItem("sorat_printer_width", paperWidth);
    localStorage.setItem("sorat_auto_print", String(autoPrint));
    onClose();
  };

  const isDirect = isDirectPrinterConnected();

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 select-none">
      <div className="w-full max-w-sm rounded-3xl border border-amber-500/40 bg-zinc-900/95 p-4 shadow-2xl backdrop-blur-md space-y-3.5 max-h-[92vh] overflow-y-auto">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 pb-2.5">
          <div className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-xl bg-gradient-gold grid place-items-center text-zinc-950 font-black text-lg shadow-gold">
              🖨️
            </div>
            <div>
              <h3 className="font-display text-sm font-black text-zinc-100 leading-tight">
                Direct Thermal Print Setup
              </h3>
              <span className="text-[10px] text-zinc-400 block leading-tight">
                Zero-Dialog 1-Click POS Printing
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* Printer Status Badge */}
        <div className={`rounded-2xl border p-3 flex items-center justify-between ${
          isDirect
            ? "border-emerald-500 bg-emerald-500/15"
            : "border-amber-500/40 bg-amber-500/10"
        }`}>
          <div className="flex items-center gap-2.5">
            <span className={`h-3 w-3 rounded-full ${isDirect ? "bg-emerald-400" : "bg-amber-400"} animate-pulse`} />
            <div>
              <span className={`text-xs font-black block leading-tight ${isDirect ? "text-emerald-300" : "text-amber-300"}`}>
                {printerName || "POS-58 Thermal"}
              </span>
              <span className="text-[10px] text-zinc-400 font-mono block leading-tight">
                {isDirect ? "✓ Direct BLE ESC/POS (Zero-Dialog)" : "System / Bluetooth Ready"}
              </span>
            </div>
          </div>
          <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase font-mono ${
            isDirect ? "bg-emerald-500/30 text-emerald-300" : "bg-amber-500/30 text-amber-300"
          }`}>
            {isDirect ? "DIRECT ACTIVE" : "READY"}
          </span>
        </div>

        {/* Scan & Connect Bluetooth Button */}
        <div className="space-y-2">
          <button
            type="button"
            onClick={handleScanBluetooth}
            disabled={isScanning}
            className="w-full py-3 rounded-2xl bg-gradient-gold text-zinc-950 font-black text-xs uppercase tracking-wide shadow-gold hover:brightness-110 active:scale-95 transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
          >
            <span>🔌</span>
            <span>{isScanning ? "Connecting Bluetooth..." : "CONNECT DIRECT BLUETOOTH PRINTER"}</span>
          </button>

          {scanMessage && (
            <div className="rounded-xl bg-zinc-950 border border-zinc-800 p-2.5 text-[11px] text-amber-300 font-medium leading-relaxed">
              {scanMessage}
            </div>
          )}
        </div>

        {/* Paper Size Selector */}
        <div className="space-y-1">
          <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block">
            Paper Roll Width (पर्चे की साइज)
          </label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setPaperWidth("58mm")}
              className={`py-2 px-2.5 rounded-xl border text-xs font-bold transition flex flex-col items-center justify-center ${
                paperWidth === "58mm"
                  ? "border-amber-500 bg-amber-500/15 text-amber-400 font-black shadow-sm"
                  : "border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <span>58mm (2-Inch)</span>
              <span className="text-[9px] text-zinc-500 font-normal">Pocket Bluetooth POS</span>
            </button>

            <button
              type="button"
              onClick={() => setPaperWidth("80mm")}
              className={`py-2 px-2.5 rounded-xl border text-xs font-bold transition flex flex-col items-center justify-center ${
                paperWidth === "80mm"
                  ? "border-amber-500 bg-amber-500/15 text-amber-400 font-black shadow-sm"
                  : "border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <span>80mm (3-Inch)</span>
              <span className="text-[9px] text-zinc-500 font-normal">Counter Heavy POS</span>
            </button>
          </div>
        </div>

        {/* Auto Print Toggle */}
        <div className="flex items-center justify-between rounded-xl bg-zinc-950 border border-zinc-800 p-2.5">
          <div>
            <span className="text-xs font-bold text-zinc-200 block">
              Auto-Print on Bet Punch
            </span>
            <span className="text-[9px] text-zinc-500 block">
              Bet lagate hi bina puche turant parchi print ho jayegi
            </span>
          </div>
          <button
            type="button"
            onClick={() => setAutoPrint(!autoPrint)}
            className={`w-10 h-6 rounded-full transition-colors relative p-0.5 ${
              autoPrint ? "bg-amber-500" : "bg-zinc-800"
            }`}
          >
            <div
              className={`w-5 h-5 rounded-full bg-zinc-950 transition-transform ${
                autoPrint ? "translate-x-4" : "translate-x-0"
              }`}
            />
          </button>
        </div>

        {/* Test Print Slip Button */}
        <button
          type="button"
          onClick={() => {
            handleSaveSettings();
            onTestPrint();
          }}
          className="w-full py-2.5 rounded-xl border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-black text-xs transition flex items-center justify-center gap-1.5 active:scale-95 cursor-pointer shadow-sm"
        >
          <span>🧾</span>
          <span>TEST PRINT ALIGNMENT SLIP</span>
        </button>

        {/* Direct Silent Print Guide (How to bypass print preview dialog) */}
        <div className="rounded-2xl bg-zinc-950 border border-zinc-800 p-3 space-y-2 text-xs">
          <div className="flex items-center justify-between border-b border-zinc-800 pb-1.5">
            <span className="font-bold text-amber-400 text-[10px] uppercase tracking-wider">
              ⚡ Bina Print Preview Dialog Ke Direct Print:
            </span>
            <div className="flex gap-1 text-[9px]">
              <button
                type="button"
                onClick={() => setActiveTabGuide("bluetooth")}
                className={`px-1.5 py-0.5 rounded ${activeTabGuide === "bluetooth" ? "bg-amber-500 text-zinc-950 font-bold" : "text-zinc-500"}`}
              >
                Bluetooth
              </button>
              <button
                type="button"
                onClick={() => setActiveTabGuide("kiosk")}
                className={`px-1.5 py-0.5 rounded ${activeTabGuide === "kiosk" ? "bg-amber-500 text-zinc-950 font-bold" : "text-zinc-500"}`}
              >
                PC Chrome Silent
              </button>
            </div>
          </div>

          {activeTabGuide === "bluetooth" ? (
            <div className="text-[11px] text-zinc-400 space-y-1 leading-relaxed">
              <p>1. Upar <strong>"CONNECT DIRECT BLUETOOTH PRINTER"</strong> dabayein aur apna POS-58 printer select karein.</p>
              <p>2. Direct connection bante hi bet punch karte hi parchi <strong>seedhe machine se bahar aayegi</strong>, browser ka popup dialog nahi aayega!</p>
            </div>
          ) : (
            <div className="text-[11px] text-zinc-400 space-y-1.5 leading-relaxed">
              <p className="text-zinc-300 font-bold">🖥️ PC / Laptop par Silent 1-Click Print (Chrome Kiosk Mode):</p>
              <p>1. Windows Desktop par Chrome shortcut par <strong>Right-Click → Properties</strong> karein.</p>
              <p>2. <strong>Target</strong> box ke aage ek space dekar yeh paste karein: <br />
                <code className="text-amber-400 bg-zinc-900 px-1 py-0.5 rounded font-mono font-bold text-[10px]">--kiosk-printing</code>
              </p>
              <p>3. Chrome ko restart karein. Ab Punch Bet dabate hi bina kisi dialog ke <strong>0.1 second me direct print</strong> nikal aayega!</p>
            </div>
          )}
        </div>

        {/* Action Button */}
        <button
          type="button"
          onClick={handleSaveSettings}
          className="w-full py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-bold text-xs transition cursor-pointer"
        >
          Done & Close
        </button>

      </div>
    </div>
  );
}
